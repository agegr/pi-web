/**
 * Geometry of the source view's virtualized line list
 * (components/FileViewer.tsx). The view keeps every line in the loaded text but
 * only puts the ones around the viewport in the DOM, so a 100k-line file scrolls
 * like a 100-line one. Highlighting is tokenized per block with a context
 * lead-in, so Prism never parses the whole file at once and no line is left
 * uncolored.
 */

/** The code line's box: `FILE_CODE_STYLE`'s 13px on a 1.6 leading. */
export const SOURCE_LINE_HEIGHT = 20.8;

/** Rows rendered above and below the viewport, so a fast scroll does not show a gap. */
export const SOURCE_OVERSCAN_LINES = 20;

/**
 * Lines handed to Prism as one piece. A block is highlighted once and kept for
 * as long as it is on screen; scrolling within it reuses the tokens.
 */
export const SOURCE_HIGHLIGHT_BLOCK = 200;

/**
 * Preceding lines Prism also sees, so a block that starts inside a multi-line
 * construct (a comment, a template literal) is still tokenized as being inside
 * it. Such lines are tokenized but not rendered.
 */
export const SOURCE_HIGHLIGHT_CONTEXT = 200;

/** Lines `[start, end)` the viewer should render. */
export interface LineWindow {
  start: number;
  end: number;
}

/** One Prism unit: `[start, end)` rendered, `contextStart` onward tokenized. */
export interface HighlightBlock {
  start: number;
  end: number;
  contextStart: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * `offsets[i]` is the top of line `i` (0-based) and `offsets[totalLines]` the
 * list's full height. A height the caller does not know yet falls back to
 * `estimate`; the caller replaces estimates with measured rows as they render.
 */
export function buildLineOffsets(
  totalLines: number,
  heightOf: (index: number) => number | undefined,
  estimate: number,
): Float64Array {
  const total = Math.max(0, Math.floor(totalLines));
  const fallback = Number.isFinite(estimate) && estimate > 0 ? estimate : SOURCE_LINE_HEIGHT;
  const offsets = new Float64Array(total + 1);
  for (let index = 0; index < total; index += 1) {
    const measured = heightOf(index);
    const height = measured !== undefined && Number.isFinite(measured) && measured > 0 ? measured : fallback;
    offsets[index + 1] = offsets[index] + height;
  }
  return offsets;
}

/** The line whose box contains `y` (or the last one, past the end). */
export function lineAtOffset(offsets: Float64Array, y: number): number {
  const total = offsets.length - 1;
  if (total <= 0) return 0;
  if (y <= 0) return 0;
  if (y >= offsets[total]) return total - 1;
  let low = 0;
  let high = total - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (offsets[mid] <= y) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** The lines to render for a viewport, with overscan. */
export function visibleLineRange(
  offsets: Float64Array,
  scrollTop: number,
  viewportHeight: number,
  overscan: number = SOURCE_OVERSCAN_LINES,
): LineWindow {
  const total = offsets.length - 1;
  if (total <= 0) return { start: 0, end: 0 };
  const top = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;
  const start = clamp(lineAtOffset(offsets, top) - overscan, 0, total);
  const end = clamp(lineAtOffset(offsets, top + height) + 1 + overscan, start, total);
  return { start, end };
}

/** Blocks covering the rendered lines, each with its own tokenization context. */
export function highlightBlocks(
  totalLines: number,
  start: number,
  end: number,
  blockSize: number = SOURCE_HIGHLIGHT_BLOCK,
  contextSize: number = SOURCE_HIGHLIGHT_CONTEXT,
): HighlightBlock[] {
  const total = Math.max(0, Math.floor(totalLines));
  const size = Math.max(1, Math.floor(blockSize));
  const from = clamp(Math.floor(start), 0, total);
  const to = clamp(Math.floor(end), from, total);
  if (to <= from) return [];
  const blocks: HighlightBlock[] = [];
  const firstBlock = Math.floor(from / size);
  const lastBlock = Math.floor((to - 1) / size);
  for (let index = firstBlock; index <= lastBlock; index += 1) {
    const blockStart = index * size;
    blocks.push({
      start: blockStart,
      end: Math.min(total, blockStart + size),
      contextStart: Math.max(0, blockStart - Math.max(0, Math.floor(contextSize))),
    });
  }
  return blocks;
}

/**
 * The blank space above and below the rendered blocks. It is the first block's
 * own offset, not the window's: a block starts on its boundary, which can sit up
 * to one block above the viewport, and using the window's offset would push every
 * rendered row a block too far down.
 */
export function blockSpacerHeights(
  offsets: Float64Array,
  blocks: readonly HighlightBlock[],
): { top: number; bottom: number } {
  if (blocks.length === 0) return { top: 0, bottom: 0 };
  const total = offsets[offsets.length - 1] ?? 0;
  return {
    top: offsets[blocks[0].start] ?? 0,
    bottom: Math.max(0, total - (offsets[blocks[blocks.length - 1].end] ?? 0)),
  };
}

/** Where to scroll so line `line` sits at the top (or middle) of the viewport. */
export function scrollTopForLine(
  offsets: Float64Array,
  line: number,
  viewportHeight: number,
  align: "start" | "center" = "center",
): number {
  const total = offsets.length - 1;
  if (total <= 0) return 0;
  const index = clamp(Math.floor(line), 0, total - 1);
  const top = offsets[index];
  if (align === "start") return Math.max(0, top - 4);
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;
  return Math.max(0, top - Math.max(0, (height - SOURCE_LINE_HEIGHT) / 2));
}
