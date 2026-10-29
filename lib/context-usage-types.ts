/**
 * Client-safe shapes of the Session Info panel's context breakdown (`get_context_breakdown`),
 * ported from pi-context-view's Usage view (MIT). Every token count is an estimate (chars/4,
 * pi's own heuristic) unless a provider reported the reasoning tokens.
 */

/** Invisible reasoning of one assistant message, attached to its first thinking entry. */
export interface ContextInvisibleReasoning {
  /** Invisible-token estimate; a signature-size proxy is never added to a category total. */
  tokens: number;
  /** A provider usage breakdown, or the opaque signature's length at chars/4. */
  basis: "provider-reported" | "signature-proxy";
  /** The message carries an opaque replay signature. */
  encoded: boolean;
}

/** One content entry shown in a category's preview. */
export interface ContextPreviewEntry {
  /** Message time (epoch ms); absent for prompt and tool parts. */
  timestamp?: number;
  /** Header cells, e.g. ["assistant", "read"]. */
  breadcrumb: string[];
  /** Tokens this entry contributes to its category, counted invisible reasoning included. */
  tokens: number;
  /** Visible-text share, set when invisible reasoning is attached. */
  visibleTokens?: number;
  invisibleReasoning?: ContextInvisibleReasoning;
  /** Preview text, cut to the server's cap; signatures never reach it. */
  text: string;
  /** Characters cut off the end of `text`. */
  truncatedChars?: number;
}

/** One estimated category; an aggregate's tokens are the exact sum of its children. */
export interface ContextCategory {
  /** Stable within one breakdown: the legend's key and the map cells' category. */
  id: string;
  label: string;
  tokens: number;
  children?: ContextCategory[];
  /** Leaves only. */
  entries?: ContextPreviewEntry[];
}

export interface ContextBreakdown {
  /** Top-level categories in the order pi assembles a request. */
  categories: ContextCategory[];
  /** Sum of the categories. */
  estimatedTokens: number;
  /** What pi reports (`getContextUsage()`): the last response's usage, not this estimate. */
  reported: { tokens: number | null; contextWindow: number; percent: number | null } | null;
  /** Auto-compaction reserve (`compaction.reserveTokens`); absent while auto-compaction is off. */
  reserveTokens?: number;
  computedAt: number;
}

/** A refusal while compacting: the messages are being replaced. */
export interface ContextBreakdownUnavailable {
  unavailable: "compacting";
}

export type ContextBreakdownResponse = ContextBreakdown | ContextBreakdownUnavailable;

export function isContextBreakdown(value: unknown): value is ContextBreakdown {
  return typeof value === "object" && value !== null && Array.isArray((value as ContextBreakdown).categories);
}

/** A category's preview entries across its breakdown, chronological when all are messages. */
export function collectPreviewEntries(category: ContextCategory): ContextPreviewEntry[] {
  const entries: ContextPreviewEntry[] = [];
  const visit = (node: ContextCategory): void => {
    entries.push(...(node.entries ?? []));
    for (const child of node.children ?? []) visit(child);
  };
  visit(category);
  if (entries.length > 1 && entries.every((entry) => entry.timestamp !== undefined)) {
    entries.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  }
  return entries;
}
