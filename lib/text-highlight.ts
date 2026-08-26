// Keyword highlight inside an already-rendered chat message.
//
// Uses the CSS Custom Highlight API instead of wrapping text in <mark>: the
// message DOM belongs to React (markdown, code blocks, tool output), and
// splitting its text nodes would invalidate the node references React keeps for
// diffing. Ranges live outside the DOM, so a re-render can invalidate the
// highlight but can never corrupt the content. Where the API is missing the
// feature degrades to "no keyword highlight", and the row flash still works.

import type { MatchSpan, TextMatcher } from "./text-match";

/** Highlight registry name, also used for the injected ::highlight() rule. */
export const CHAT_SEARCH_HIGHLIGHT = "pi-chat-search";
/** Enough to cover a long message without pathological range counts. */
export const MAX_HIGHLIGHTS = 200;

/** Offsets of one text node inside the concatenated text of a subtree. */
export interface NodeSpan {
  start: number;
  end: number;
}

export interface RangePlan {
  startIndex: number;
  startOffset: number;
  endIndex: number;
  endOffset: number;
}

/**
 * Locate the text node containing `offset`.
 *
 * `atEnd` resolves the ambiguity at a node boundary: a match's end offset
 * belongs to the node that ends there, its start offset to the node that
 * begins there.
 */
export function locateOffset(
  spans: readonly NodeSpan[],
  offset: number,
  atEnd = false,
): { index: number; offset: number } | null {
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    const inside = atEnd
      ? offset > span.start && offset <= span.end
      : offset >= span.start && offset < span.end;
    if (inside) return { index, offset: offset - span.start };
  }
  return null;
}

/**
 * Convert match spans over the concatenated text into per-node range plans.
 * A match may span several text nodes (inline markup, syntax-highlighted code),
 * so start and end can land in different nodes. Unmappable spans are dropped.
 */
export function planHighlightRanges(
  spans: readonly NodeSpan[],
  matches: readonly MatchSpan[],
): RangePlan[] {
  const plans: RangePlan[] = [];
  for (const match of matches) {
    if (match.end <= match.start) continue;
    const start = locateOffset(spans, match.start, false);
    const end = locateOffset(spans, match.end, true);
    if (!start || !end) continue;
    plans.push({
      startIndex: start.index,
      startOffset: start.offset,
      endIndex: end.index,
      endOffset: end.offset,
    });
  }
  return plans;
}

/**
 * The ::highlight() rule is injected here instead of living in globals.css for
 * two reasons: the build CSS parser does not recognize the pseudo-element, and
 * the rule must be self-contained. Highlight pseudo-elements resolve custom
 * properties through the highlight inheritance chain, so a `var(--theme-color)`
 * that works on a normal element can silently fail here — an unresolved
 * variable drops only that declaration, which showed up as a keyword that had
 * the underline but no background at all. Literal colors, and an explicit
 * foreground so contrast holds in both themes, remove that failure mode.
 */
function ensureHighlightStyle(name: string): void {
  if (typeof document === "undefined") return;
  const marker = `pi-highlight-${name}`;
  // Reuse and rewrite an existing tag rather than bailing out: a dev tab that
  // survived a rule change would otherwise keep painting the old colors.
  const existing = document.getElementById(marker) as HTMLStyleElement | null;
  const style = existing ?? document.createElement("style");
  style.id = marker;
  style.textContent = `::highlight(${name}) {`
    + " background-color: rgba(250, 204, 21, 0.85);"
    + " color: #111827;"
    + " text-decoration: underline;"
    + " text-decoration-color: rgba(120, 53, 15, 0.55);"
    + " text-decoration-thickness: 2px;"
    + " text-underline-offset: 2px;"
    + " }"
    + ` html.dark ::highlight(${name}) {`
    + " background-color: rgba(250, 204, 21, 0.9);"
    + " text-decoration-color: rgba(120, 53, 15, 0.7);"
    + " }";
  if (!existing) document.head.appendChild(style);
}

interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

interface HighlightCapableCss {
  highlights?: HighlightRegistryLike;
}

type HighlightConstructor = new (...ranges: Range[]) => unknown;

function highlightRegistry(): HighlightRegistryLike | null {
  if (typeof CSS === "undefined") return null;
  return (CSS as unknown as HighlightCapableCss).highlights ?? null;
}

function highlightConstructor(): HighlightConstructor | null {
  const ctor = (globalThis as { Highlight?: HighlightConstructor }).Highlight;
  return typeof ctor === "function" ? ctor : null;
}

/** True when this browser can paint ::highlight() ranges. */
export function supportsTextHighlight(): boolean {
  return Boolean(highlightRegistry() && highlightConstructor());
}

/** Remove a registered highlight. Safe to call repeatedly. */
export function clearTextHighlight(name = CHAT_SEARCH_HIGHLIGHT): void {
  highlightRegistry()?.delete(name);
}

/**
 * Highlight every match of `matcher` inside `root`.
 *
 * Text nodes are concatenated without separators, like find-in-page, so a match
 * split across inline markup still matches. Returns the ranges in document
 * order; the first one is what a caller should scroll to.
 */
export function applyTextHighlight(
  root: HTMLElement,
  matcher: TextMatcher,
  { limit = MAX_HIGHLIGHTS, name = CHAT_SEARCH_HIGHLIGHT } = {},
): Range[] {
  const registry = highlightRegistry();
  const Ctor = highlightConstructor();
  if (!registry || !Ctor) return [];
  ensureHighlightStyle(name);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const spans: NodeSpan[] = [];
  let text = "";
  let node = walker.nextNode();
  while (node) {
    const data = (node as Text).data;
    if (data) {
      spans.push({ start: text.length, end: text.length + data.length });
      nodes.push(node as Text);
      text += data;
    }
    node = walker.nextNode();
  }
  if (!text) {
    registry.delete(name);
    return [];
  }

  const ranges: Range[] = [];
  for (const plan of planHighlightRanges(spans, matcher.find(text, limit))) {
    const range = document.createRange();
    try {
      range.setStart(nodes[plan.startIndex], plan.startOffset);
      range.setEnd(nodes[plan.endIndex], plan.endOffset);
    } catch {
      continue;
    }
    ranges.push(range);
  }

  if (ranges.length === 0) {
    registry.delete(name);
    return [];
  }
  registry.set(name, new Ctor(...ranges));
  return ranges;
}
