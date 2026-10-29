/**
 * Client-safe proportional cell model of the Session Info panel's context map, ported from
 * pi-context-view's src/ui/usage-map.ts (MIT). The map lays the estimated categories over the
 * Window (the whole context window) or Fit (estimated occupancy plus headroom) scale; pi's own
 * reported tokens may differ (tokenizer, serialization, caching, the last response's timing).
 */
import type { ContextBreakdown } from "./context-usage-types";

const FIT_SCALE_PERCENT = 115;
const MINIMUM_FIT_SCALE_TOKENS = 10_000;
const FIT_SCALE_SIGNIFICANT_DIGITS = 2;

/** One cell: a category, the auto-compaction reserve, or free space. */
export interface ContextMapCell {
  categoryId?: string;
  fill: "full" | "partial" | "buffer" | "free";
}

export interface ContextMap {
  columns: number;
  rows: number;
  /** Tokens one cell stands for at the active scale. */
  blockTokens: number;
  cells: ContextMapCell[];
}

/**
 * The Fit denominator: estimated occupancy with 15% headroom, rounded up to two significant
 * digits, at least 10k and at most the window. Undefined without a context window.
 */
export function calculateFitMapScale(usage: ContextBreakdown): number | undefined {
  const contextWindow = usage.reported?.contextWindow;
  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;
  const withHeadroom = Math.max(0, usage.estimatedTokens) * FIT_SCALE_PERCENT / 100;
  const rounded = roundUpToSignificantDigits(withHeadroom, FIT_SCALE_SIGNIFICANT_DIGITS);
  return Math.min(contextWindow, Math.max(MINIMUM_FIT_SCALE_TOKENS, rounded));
}

/**
 * Map the top-level categories onto `columns × rows` cells. `scaleTokens` changes only the
 * denominator; the reserve stays anchored to the true window, so Fit leaves it out of range.
 */
export function buildContextMap(
  usage: ContextBreakdown,
  columns: number,
  rows: number,
  scaleTokens?: number,
): ContextMap | undefined {
  const contextWindow = usage.reported?.contextWindow;
  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0 || columns <= 0 || rows <= 0) {
    return undefined;
  }
  const requestedScale = scaleTokens ?? contextWindow;
  if (!Number.isFinite(requestedScale) || requestedScale <= 0) return undefined;
  const mapScale = Math.min(contextWindow, requestedScale);
  const cellCount = Math.floor(columns) * Math.floor(rows);
  const estimatedTotal = usage.estimatedTokens;
  const occupiedCells = clamp(estimatedTotal, 0, mapScale) / mapScale * cellCount;
  const windowOccupancy = clamp(estimatedTotal, 0, contextWindow);
  const bufferTokens = mapScale < contextWindow ? 0 : clamp(usage.reserveTokens ?? 0, 0, contextWindow - windowOccupancy);
  const bufferStart = (contextWindow - bufferTokens) / mapScale * cellCount;

  const segments: Array<{ categoryId: string; start: number; end: number }> = [];
  if (estimatedTotal > 0 && occupiedCells > 0) {
    let cursor = 0;
    for (const category of usage.categories) {
      const size = category.tokens / estimatedTotal * occupiedCells;
      segments.push({ categoryId: category.id, start: cursor, end: cursor + size });
      cursor += size;
    }
  }

  const cells = Array.from({ length: cellCount }, (_, index): ContextMapCell => {
    if (overlap(index, index + 1, 0, occupiedCells) <= 0) {
      // A free cell is reserve when at least half of it lies past the trigger point
      return overlap(index, index + 1, bufferStart, index + 1) >= 0.5 ? { fill: "buffer" } : { fill: "free" };
    }
    let categoryId: string | undefined;
    let best = 0;
    for (const segment of segments) {
      const shared = overlap(index, index + 1, segment.start, segment.end);
      if (shared > best) {
        categoryId = segment.categoryId;
        best = shared;
      }
    }
    return { categoryId, fill: best >= 0.7 ? "full" : "partial" };
  });
  return { columns: Math.floor(columns), rows: Math.floor(rows), blockTokens: mapScale / cellCount, cells };
}

/** Category colors (CSS variables in app/globals.css), cycled in legend order. */
export const CONTEXT_CATEGORY_COLORS = [
  "var(--ctx-1)", "var(--ctx-2)", "var(--ctx-3)", "var(--ctx-4)", "var(--ctx-5)", "var(--ctx-6)",
  "var(--ctx-7)", "var(--ctx-8)", "var(--ctx-9)", "var(--ctx-10)", "var(--ctx-11)", "var(--ctx-12)",
  "var(--ctx-13)",
];

/** Each top-level category id with its color, fixed by id so a refresh keeps them. */
const CATEGORY_COLOR_ORDER = [
  "system-prompt", "context-files", "skills", "built-in-tools", "custom-tools", "mcp-tools",
  "user-messages", "assistant-messages", "assistant-thinking", "tool-calls", "tool-output",
  "extensions", "compacted-data",
];

export function contextCategoryColor(categoryId: string, index: number): string {
  const fixed = CATEGORY_COLOR_ORDER.indexOf(categoryId);
  return CONTEXT_CATEGORY_COLORS[(fixed === -1 ? index : fixed) % CONTEXT_CATEGORY_COLORS.length];
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function roundUpToSignificantDigits(value: number, significantDigits: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const boundary = 10 ** (Math.floor(Math.log10(value)) - significantDigits + 1);
  return Math.ceil(value / boundary) * boundary;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}
