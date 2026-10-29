// Client-safe: the transcript notices pi's TUI shows under `showCacheMissNotices`
// (#1265). The server derives them from the session entries
// (lib/transcript-notices-server.ts) and hangs them on the chat message they
// follow; the chat renders them as one line each.

export type TranscriptNotice =
  /** An assistant response re-billed prompt tokens a cache should have served. */
  | { kind: "cache_miss"; missedTokens: number; missedCost: number; idleMinutes?: number; modelChanged?: boolean }
  /** Billed prompt-cache warming outside model context (`usage` entry, `kind: "cache_warm"`). */
  | { kind: "cache_warm"; cost: number; note?: string }
  /** What a compaction or branch summary billed. */
  | { kind: "summary_cost"; source: "compaction" | "branch_summary"; tokens: number; cost: number }
  /** Anthropic dropped thinking blocks from the request (pi's `thinking_dropped` input transformation). */
  | { kind: "thinking_dropped"; count: number };

/** The property a chat message carries its notices in; never part of pi's message. */
export const TRANSCRIPT_NOTICES_KEY = "transcriptNotices";

export type WithTranscriptNotices<T> = T & { [TRANSCRIPT_NOTICES_KEY]?: TranscriptNotice[] };

/** The notices a chat message carries; empty for one without. */
export function getTranscriptNotices(message: unknown): TranscriptNotice[] {
  if (typeof message !== "object" || message === null) return [];
  const notices = (message as Record<string, unknown>)[TRANSCRIPT_NOTICES_KEY];
  return Array.isArray(notices) ? notices as TranscriptNotice[] : [];
}

/** A copy of `message` carrying `notices`; the message itself when there are none. */
export function withTranscriptNotices<T extends object>(message: T, notices: readonly TranscriptNotice[] | undefined): T {
  if (!notices || notices.length === 0) return message;
  return { ...message, [TRANSCRIPT_NOTICES_KEY]: [...notices] };
}

/** pi's TUI `formatTokens()`: 950, 8.5k, 85k, 1.2M (these notices and a reply's usage line). */
export function formatNoticeTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

/** The TUI's cost suffix: shown from a cent up, two decimals. */
export function formatNoticeCost(cost: number): string | undefined {
  return cost >= 0.01 ? `$${cost.toFixed(2)}` : undefined;
}

/** The TUI's cache-warming cost: six decimals, trailing zeros past the third dropped. */
export function formatCacheWarmCost(cost: number): string {
  return `$${cost.toFixed(6).replace(/(\.\d{3}\d*?)0+$/, "$1")}`;
}

export interface CacheMissSummary {
  count: number;
  missedTokens: number;
  missedCost: number;
}

/** The cache misses of `messages` added up, for a folded Process details header; undefined when none. */
export function summarizeCacheMisses(messages: readonly unknown[]): CacheMissSummary | undefined {
  let summary: CacheMissSummary | undefined;
  for (const message of messages) {
    for (const notice of getTranscriptNotices(message)) {
      if (notice.kind !== "cache_miss") continue;
      summary ??= { count: 0, missedTokens: 0, missedCost: 0 };
      summary.count += 1;
      summary.missedTokens += notice.missedTokens;
      summary.missedCost += notice.missedCost;
    }
  }
  return summary;
}
