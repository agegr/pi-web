import {
  Agent,
  type AgentMessage,
  type AgentOptions,
} from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

const TITLE_TIMEOUT_MS = 90_000;
const MAX_TITLE_LENGTH = 80;

// These are per-message code-point caps, not a total transcript budget.
// Retain every user turn so middle-of-session changes of goal remain visible.
const USER_CHARS = 800;
const ASSISTANT_CHARS = 300;
const LAST_ASSISTANT_CHARS = 600;
const SUMMARY_CHARS = 600;
const TITLE_SYSTEM_PROMPT =
  "You name chat sessions from a transcript. Reply with the title only.";

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

/** Build a temporary Agent with a separate title prompt and no tools or history. */
export function buildSessionTitleAgentOptions(source: Agent): AgentOptions {
  const state = source.state;
  return {
    initialState: {
      systemPrompt: TITLE_SYSTEM_PROMPT,
      model: state.model,
      thinkingLevel: state.thinkingLevel,
      tools: [],
      messages: [],
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

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } =>
      typeof block === "object" && block !== null && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function clip(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length <= max ? text : `${characters.slice(0, max).join("")}…`;
}

/** Flatten user/assistant text and compaction summaries without tool traffic. */
export function buildTitleTranscript(messages: AgentMessage[]): string {
  let lastAssistant: AgentMessage | undefined;
  for (const message of messages) {
    if (message.role === "assistant" && textOf(message.content).trim()) lastAssistant = message;
  }

  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === "compactionSummary") {
      lines.push(`[Earlier summary] ${clip(message.summary.trim(), SUMMARY_CHARS)}`);
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = textOf(message.content).trim();
    if (!text) continue;
    if (message.role === "user") {
      lines.push(`User: ${clip(text, USER_CHARS)}`);
    } else {
      lines.push(`Assistant: ${clip(text, message === lastAssistant ? LAST_ASSISTANT_CHARS : ASSISTANT_CHARS)}`);
    }
  }
  return lines.join("\n\n");
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

function getAssistantResult(agent: Agent): GeneratedSessionTitle {
  const generatedMessages = agent.state.messages;
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

export async function generateSessionTitle(source: AgentSession): Promise<GeneratedSessionTitle> {
  const sourceAgent = source.agent;
  await sourceAgent.waitForIdle();

  const messages = sourceAgent.state.messages;
  if (!messages.some(
    (message) => message.role === "user" || message.role === "compactionSummary",
  )) {
    throw new Error("The session has no user messages to name");
  }

  const temporaryAgent = new Agent(buildSessionTitleAgentOptions(sourceAgent));
  const runPromise = temporaryAgent.prompt(`${buildTitleTranscript(messages)}\n\n${TITLE_PROMPT}`);
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

  return getAssistantResult(temporaryAgent);
}
