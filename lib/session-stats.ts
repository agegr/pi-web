import type { AgentUsage, SessionEntry } from "./types";

export interface SessionFileStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
}

/**
 * Aggregate usage across ALL entries in a session file.
 *
 * Mirrors the SDK's `AgentSession.getSessionStats()`: besides assistant
 * (and tool-result) messages, this also counts usage recorded on compaction
 * and branch-summary entries. Compaction only appends a summary entry — the
 * summarized history stays in the file — so these totals grow monotonically
 * for the life of the session. Totals computed over the active context alone
 * (the compaction-aware message list) shrink whenever old history is
 * summarized away, which is what made the UI token/cost counters appear to be
 * reset after compaction.
 */
export function computeSessionStats(entries: SessionEntry[]): SessionFileStats {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let cost = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  let toolResults = 0;
  let toolCalls = 0;
  let totalMessages = 0;

  const addUsage = (usage?: AgentUsage) => {
    if (!usage) return;
    tokens.input += usage.input ?? 0;
    tokens.output += usage.output ?? 0;
    tokens.cacheRead += usage.cacheRead ?? 0;
    tokens.cacheWrite += usage.cacheWrite ?? 0;
    cost += usage.cost?.total ?? 0;
  };

  for (const entry of entries) {
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      addUsage(entry.usage);
      continue;
    }
    if (entry.type !== "message") continue;
    const message = entry.message;
    totalMessages += 1;
    if (message.role === "user") {
      userMessages += 1;
    } else if (message.role === "toolResult") {
      toolResults += 1;
      addUsage(message.usage);
    } else if (message.role === "assistant") {
      assistantMessages += 1;
      toolCalls += message.content.filter((c) => c.type === "toolCall").length;
      addUsage(message.usage);
    }
  }

  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return { userMessages, assistantMessages, toolCalls, toolResults, totalMessages, tokens, cost };
}
