import {
  Agent,
  type AgentMessage,
  type AgentOptions,
  type AgentTool,
  type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import {
  getSupportedThinkingLevels,
  type Api,
  type Model,
} from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

const TITLE_TIMEOUT_MS = 90_000;
const MAX_TITLE_LENGTH = 80;

const TITLE_PROMPT = `Create a concise title for this session based on the conversation above.

Requirements:
- Match the primary language used by the user.
- Describe the user's concrete goal or the outcome, not the act of chatting.
- Use 4-12 words for space-separated languages, or 8-24 characters for CJK text when practical.
- Do not call any tools.
- Return only the title as plain text, with no quotes, label, markdown, or explanation.`;

export interface GeneratedSessionTitle {
  title: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

function createShadowTools(tools: AgentTool[]): AgentTool[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async () => {
      throw new Error("Tools cannot be executed while generating a session title");
    },
  }));
}

export interface BuildSessionTitleAgentOptions {
  model?: Model<Api>;
}

/**
 * Naming is a short classification task, so thinking only adds latency and
 * tokens. Gemini rejects "minimal" and its SDK emits that level when thinking
 * is disabled, so ask for the cheapest level it accepts instead.
 */
export function resolveTitleThinkingLevel(model: Model<Api>): ThinkingLevel {
  if (!model.reasoning) return "off";
  if (model.api === "google-generative-ai" || /gemini/i.test(model.id)) return "low";
  const supported = getSupportedThinkingLevels(model);
  if (supported.includes("off")) return "off";
  if (supported.includes("low")) return "low";
  if (supported.includes("minimal")) return "minimal";
  return "off";
}

/**
 * Build a temporary Agent configuration whose provider-facing prefix matches
 * the source Agent. Tool implementations are replaced without changing their
 * names, descriptions, or schemas, so a naming run cannot mutate the project.
 * Thinking is minimized because a title needs no reasoning budget.
 */
export function buildSessionTitleAgentOptions(
  source: Agent,
  options?: BuildSessionTitleAgentOptions,
): AgentOptions {
  const state = source.state;
  const targetModel = options?.model ?? state.model;
  return {
    initialState: {
      systemPrompt: state.systemPrompt,
      model: targetModel,
      thinkingLevel: resolveTitleThinkingLevel(targetModel),
      tools: createShadowTools(state.tools),
      messages: state.messages,
    },
    convertToLlm: source.convertToLlm,
    transformContext: source.transformContext,
    streamFn: source.streamFunction,
    getApiKey: source.getApiKey,
    onPayload: source.onPayload,
    onResponse: source.onResponse,
    steeringMode: source.steeringMode,
    followUpMode: source.followUpMode,
    sessionId: source.sessionId,
    thinkingBudgets: source.thinkingBudgets,
    transport: source.transport,
    maxRetryDelayMs: source.maxRetryDelayMs,
    toolExecution: source.toolExecution,
  };
}

/**
 * A running source session usually ends in the user message currently being
 * answered. Fold the title request into a copy of that message so the title
 * request does not send two consecutive user messages to the provider.
 */
export function appendTitleRequestToTrailingUser(messages: AgentMessage[]): AgentMessage[] {
  const lastMessage = messages.at(-1);
  if (!lastMessage || lastMessage.role !== "user") return messages;

  const content = typeof lastMessage.content === "string"
    ? `${lastMessage.content}\n\n${TITLE_PROMPT}`
    : [...lastMessage.content, { type: "text" as const, text: TITLE_PROMPT }];

  return [
    ...messages.slice(0, -1),
    { ...lastMessage, content },
  ];
}

function stripWrappingQuotes(value: string): string {
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["\u201c", "\u201d"],
    ["\u300c", "\u300d"],
    ["\u300e", "\u300f"],
  ];
  for (const [start, end] of pairs) {
    if (value.startsWith(start) && value.endsWith(end) && value.length > start.length + end.length) {
      return value.slice(start.length, -end.length).trim();
    }
  }
  return value;
}

export function parseGeneratedSessionTitle(raw: string): string {
  let value = raw.trim();
  const fenced = value.match(/^```(?:json|text)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) value = fenced[1].trim();

  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as { title?: unknown };
      if (typeof parsed.title === "string") value = parsed.title.trim();
    } catch {
      // Fall back to plain-text cleanup below.
    }
  }

  value = value.split(/\r?\n/, 1)[0] ?? "";
  value = value.replace(/^(?:session\s+title|title|标题)\s*[:：-]\s*/i, "");
  value = stripWrappingQuotes(value).replace(/\s+/g, " ").trim();
  value = value.replace(/[。.!]+$/u, "").trim();

  if (!/[\p{L}\p{N}]/u.test(value)) {
    throw new Error("The model did not return a usable session title");
  }

  const characters = Array.from(value);
  if (characters.length > MAX_TITLE_LENGTH) {
    value = characters.slice(0, MAX_TITLE_LENGTH).join("").trim();
  }
  return value;
}

function getAssistantResult(agent: Agent, historyLength: number): GeneratedSessionTitle {
  const generatedMessages = agent.state.messages.slice(historyLength);
  for (let i = generatedMessages.length - 1; i >= 0; i--) {
    const message = generatedMessages[i];
    if (message.role !== "assistant") continue;
    if (message.stopReason === "error") {
      throw new Error(message.errorMessage || "The title model request failed");
    }
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!text) continue;
    return {
      title: parseGeneratedSessionTitle(text),
      ...(message.usage ? {
        usage: {
          input: message.usage.input,
          output: message.usage.output,
          cacheRead: message.usage.cacheRead,
          cacheWrite: message.usage.cacheWrite,
          total: message.usage.totalTokens,
        },
      } : {}),
    };
  }
  throw new Error("The model did not return a session title");
}

export function sanitizeTitleMessages(messages: AgentMessage[]): AgentMessage[] {
  const sanitized: AgentMessage[] = [];
  let expectedToolResultIds: Set<string> | undefined;

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];

    if (message.role === "assistant") {
      const followingToolResultIds = new Set<string>();
      for (let resultIndex = index + 1; resultIndex < messages.length; resultIndex++) {
        const resultMessage = messages[resultIndex];
        if (resultMessage.role !== "toolResult") break;
        followingToolResultIds.add(resultMessage.toolCallId);
      }

      expectedToolResultIds = new Set<string>();
      const content = message.content.filter((block) => {
        if (block.type !== "toolCall") return true;
        if (!followingToolResultIds.has(block.id)) return false;
        expectedToolResultIds!.add(block.id);
        return true;
      });

      if (content.length > 0) {
        sanitized.push({ ...message, content });
      }
      continue;
    }

    if (message.role === "toolResult") {
      if (expectedToolResultIds?.delete(message.toolCallId)) {
        sanitized.push(message);
      }
      continue;
    }

    expectedToolResultIds = undefined;
    sanitized.push(message);
  }

  return sanitized;
}

export interface GenerateSessionTitleOptions {
  /** "provider/model-id" from settings, or "inherit" to name with the session's own model. */
  model?: string;
}

export async function generateSessionTitle(
  source: AgentSession,
  options?: GenerateSessionTitleOptions,
): Promise<GeneratedSessionTitle> {
  const sourceAgent = source.agent;
  await sourceAgent.waitForIdle();

  const sanitizedMessages = sanitizeTitleMessages(sourceAgent.state.messages);
  const historyLength = sanitizedMessages.length;
  if (!sanitizedMessages.some(
    (message) => message.role === "user" || message.role === "compactionSummary",
  )) {
    throw new Error("The session has no user messages to name");
  }

  let modelOverride: Model<Api> | undefined;
  if (options?.model && options.model !== "inherit") {
    const slash = options.model.indexOf("/");
    if (slash > 0) {
      modelOverride = source.modelRuntime?.getModel(
        options.model.slice(0, slash),
        options.model.slice(slash + 1),
      );
    }
  }

  const agentOptions = buildSessionTitleAgentOptions(sourceAgent, { model: modelOverride });
  agentOptions.initialState!.messages = sanitizedMessages;
  const continuesFromTrailingUser = sanitizedMessages.at(-1)?.role === "user";
  if (continuesFromTrailingUser) {
    agentOptions.initialState!.messages = appendTitleRequestToTrailingUser(sanitizedMessages);
  }

  const temporaryAgent = new Agent(agentOptions);
  const runPromise = continuesFromTrailingUser
    ? temporaryAgent.continue()
    : temporaryAgent.prompt(TITLE_PROMPT);
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      runPromise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          temporaryAgent.abort();
          reject(new Error("Session title generation timed out"));
        }, TITLE_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    temporaryAgent.abort();
    await runPromise.catch(() => {});
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  return getAssistantResult(temporaryAgent, historyLength);
}
