import {
  Agent,
  type AgentMessage,
  type AgentOptions,
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

// Per-message caps. A title needs what the user asked for (every user turn,
// including mid-session pivots) and what came out of it (the last reply); the
// replies in between only need their opening line. Tool calls and results are
// dropped outright: they dominate the token count and say nothing about intent.
const USER_CHARS = 800;
const ASSISTANT_CHARS = 300;
const LAST_ASSISTANT_CHARS = 600;
const SUMMARY_CHARS = 600;
// Total budget across all messages. Without it the transcript still grows with
// the session, and a long session ends up costing more than replaying a cached
// prefix would have.
const TRANSCRIPT_CHARS = 6000;
// Share of the budget reserved for the opening turns. A session often states
// its goal early and then drifts into routine follow-ups, so spending the whole
// budget on the newest turns can title a session after its last chore.
const TRANSCRIPT_HEAD_CHARS = Math.round(TRANSCRIPT_CHARS * 0.4);

const TITLE_SYSTEM_PROMPT =
  "You name chat sessions from a transcript. Reply with the title only.";

const ELISION = "[…]";

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

/**
 * Naming is a short classification task, so thinking only adds latency and
 * tokens: use the cheapest level the model actually supports. Gemini rejects
 * "minimal" and its SDK emits that level when thinking is disabled, so it
 * skips to the next supported level instead.
 */
export function resolveTitleThinkingLevel(model: Model<Api>): ThinkingLevel {
  if (!model.reasoning) return "off";
  // getSupportedThinkingLevels lists levels in ascending cost order.
  const supported = getSupportedThinkingLevels(model);
  const rejectsMinimal = model.api === "google-generative-ai" || /gemini/i.test(model.id);
  const usable = rejectsMinimal ? supported.filter((level) => level !== "off" && level !== "minimal") : supported;
  return usable[0] ?? supported[0] ?? "off";
}

/**
 * Build a throwaway Agent that shares the source's transport and credentials
 * but nothing of its context: no system prompt, no tools, no history. The
 * transcript goes in as a single user turn, so the request is the same size
 * whichever model answers it and never depends on a prompt cache.
 */
export function buildSessionTitleAgentOptions(
  source: Agent,
  model: Model<Api> = source.state.model,
): AgentOptions {
  return {
    initialState: {
      systemPrompt: TITLE_SYSTEM_PROMPT,
      model,
      thinkingLevel: resolveTitleThinkingLevel(model),
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
      typeof block === "object" && block !== null && (block as { type?: string }).type === "text")
    .map((block) => block.text)
    .join("\n");
}

function clip(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length <= max ? text : `${characters.slice(0, max).join("")}…`;
}

/**
 * A title needs the goal the session opened with and the outcome it reached.
 * The middle is what makes a long session expensive, so keep both ends and drop
 * it. Cost and latency then stop tracking session length.
 */
function boundTranscript(lines: string[]): string {
  const joined = lines.join("\n\n");
  if (joined.length <= TRANSCRIPT_CHARS || lines.length < 2) return joined;

  const head: string[] = [];
  let used = ELISION.length + 4;
  let next = 0;
  // The first line always survives, however long the session is.
  for (; next < lines.length; next++) {
    const size = used + lines[next].length + 2;
    if (head.length > 0 && size > TRANSCRIPT_HEAD_CHARS) break;
    head.push(lines[next]);
    used = size;
  }

  const tail: string[] = [];
  for (let i = lines.length - 1; i >= next; i--) {
    const size = used + lines[i].length + 2;
    if (size > TRANSCRIPT_CHARS) break;
    tail.unshift(lines[i]);
    used = size;
  }

  // Everything fit after all: the budget only looked tight because of joins.
  if (next + tail.length >= lines.length) return joined;
  return [...head, ELISION, ...tail].join("\n\n");
}

/** Flatten the session into the plain-text transcript the title model reads. */
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
  return boundTranscript(lines);
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
  const messages = agent.state.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
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

export interface GenerateSessionTitleOptions {
  /** "provider/model-id" from settings, or "inherit" to name with the session's own model. */
  model?: string;
}

/**
 * A configured model that cannot be resolved must fail loudly. Falling back to
 * the session's own model would silently spend the request the user chose the
 * dedicated model to avoid. Refresh first, as set_model does, so a model added
 * while this session's runtime was already alive is still found.
 */
async function resolveTitleModel(source: AgentSession, spec: string): Promise<Model<Api>> {
  const slash = spec.indexOf("/");
  if (slash <= 0) throw new Error(`Invalid session title model: ${spec}`);
  const provider = spec.slice(0, slash);
  const modelId = spec.slice(slash + 1);
  const runtime = source.modelRuntime;
  let model = runtime.getModel(provider, modelId);
  if (!model) {
    await runtime.refresh({ allowNetwork: false });
    model = runtime.getModel(provider, modelId);
  }
  if (!model) throw new Error(`Session title model not found: ${spec}`);
  return model;
}

export async function generateSessionTitle(
  source: AgentSession,
  options?: GenerateSessionTitleOptions,
): Promise<GeneratedSessionTitle> {
  const sourceAgent = source.agent;
  // Snapshot whatever the session holds right now. The transcript is plain
  // text the title model reads once, so a turn still in flight only means the
  // newest reply is missing from it; there is nothing to wait for.
  const messages = [...sourceAgent.state.messages];
  if (!messages.some((message) => message.role === "user" || message.role === "compactionSummary")) {
    throw new Error("The session has no user messages to name");
  }

  const model = options?.model && options.model !== "inherit"
    ? await resolveTitleModel(source, options.model)
    : undefined;
  const temporaryAgent = new Agent(buildSessionTitleAgentOptions(sourceAgent, model));
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
