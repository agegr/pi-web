import type { SessionStatsInfo } from "./pi-types";
import type { AssistantMessage, SessionContext } from "./types";

export const INITIAL_SESSION_CONTEXT_MESSAGES = 60;
export const SESSION_CONTEXT_PAGE_MESSAGES = 120;
export const MAX_SESSION_CONTEXT_PAGE_MESSAGES = 240;

export interface SessionContextPage {
  startIndex: number;
  endIndex: number;
  totalMessages: number;
  hasEarlier: boolean;
}

export type SessionContextStats = Pick<
  SessionStatsInfo,
  | "userMessages"
  | "assistantMessages"
  | "toolCalls"
  | "toolResults"
  | "totalMessages"
  | "tokens"
  | "cost"
>;

export class SessionContextPageRequestError extends Error {}

export interface SessionContextPageRequest {
  tail?: number;
  before?: number;
  limit?: number;
}

function boundedInteger(value: number | undefined, fallback: number): number {
  if (!Number.isSafeInteger(value) || value === undefined || value <= 0) return fallback;
  return Math.min(value, MAX_SESSION_CONTEXT_PAGE_MESSAGES);
}

export function paginateSessionContext(
  context: SessionContext,
  request: SessionContextPageRequest,
): { context: SessionContext; page: SessionContextPage } {
  const totalMessages = context.messages.length;
  let endIndex = totalMessages;
  let limit = boundedInteger(request.tail, INITIAL_SESSION_CONTEXT_MESSAGES);
  if (request.before !== undefined) {
    endIndex = Number.isSafeInteger(request.before)
      ? Math.max(0, Math.min(request.before, totalMessages))
      : totalMessages;
    limit = boundedInteger(request.limit, SESSION_CONTEXT_PAGE_MESSAGES);
  }
  const startIndex = Math.max(0, endIndex - limit);
  return {
    context: {
      ...context,
      messages: context.messages.slice(startIndex, endIndex),
      entryIds: context.entryIds.slice(startIndex, endIndex),
      oldestEntryId: startIndex < endIndex ? context.entryIds[startIndex] ?? null : null,
      hasMore: startIndex > 0,
    },
    page: {
      startIndex,
      endIndex,
      totalMessages,
      hasEarlier: startIndex > 0,
    },
  };
}

export function parseSessionContextPageRequest(
  searchParams: URLSearchParams,
): SessionContextPageRequest | null {
  const hasTail = searchParams.has("tail");
  const hasBefore = searchParams.has("before");
  const hasLimit = searchParams.has("limit");
  if (!hasTail && !hasBefore && !hasLimit) return null;

  const parse = (name: string, allowZero: boolean): number | undefined => {
    const raw = searchParams.get(name);
    if (raw === null) return undefined;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
      throw new SessionContextPageRequestError(`Invalid ${name}`);
    }
    return value;
  };
  const before = parse("before", true);
  const tail = parse("tail", false);
  const limit = parse("limit", false);
  if (limit !== undefined && before === undefined) {
    throw new SessionContextPageRequestError("limit requires before");
  }
  return before !== undefined ? { before, limit } : { tail };
}

const contextStatsCache = new WeakMap<SessionContext, SessionContextStats>();

export function computeSessionInputHistory(context: SessionContext): string[] {
  const seen = new Set<string>();
  const history: string[] = [];
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];
    if (message.role !== "user") continue;
    const text = typeof message.content === "string"
      ? message.content.trim()
      : message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    history.push(text);
    if (history.length >= 50) break;
  }
  return history.reverse();
}

export function computeSessionContextStats(context: SessionContext): SessionContextStats {
  const cached = contextStatsCache.get(context);
  if (cached) return cached;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let cost = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  let toolResults = 0;
  let toolCalls = 0;
  for (const message of context.messages) {
    if (message.role === "user") userMessages += 1;
    if (message.role === "toolResult") toolResults += 1;
    if (message.role !== "assistant") continue;
    assistantMessages += 1;
    const assistant = message as AssistantMessage;
    toolCalls += assistant.content.filter((block) => block.type === "toolCall").length;
    const usage = assistant.usage;
    if (!usage) continue;
    tokens.input += usage.input ?? 0;
    tokens.output += usage.output ?? 0;
    tokens.cacheRead += usage.cacheRead ?? 0;
    tokens.cacheWrite += usage.cacheWrite ?? 0;
    cost += usage.cost?.total ?? 0;
  }
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  const stats = {
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalMessages: context.messages.length,
    tokens,
    cost,
  };
  contextStatsCache.set(context, stats);
  return stats;
}
