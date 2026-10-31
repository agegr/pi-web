import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  blockSpacerHeights,
  buildLineOffsets,
  highlightBlocks,
  lineAtOffset,
  scrollTopForLine,
  visibleLineRange,
  SOURCE_HIGHLIGHT_BLOCK,
  SOURCE_HIGHLIGHT_CONTEXT,
  SOURCE_LINE_HEIGHT,
  SOURCE_OVERSCAN_LINES,
} = await jiti.import("./source-window.ts");

test("offsets use measured heights and fall back to the estimate", () => {
  const offsets = buildLineOffsets(3, (index) => (index === 1 ? 40 : undefined), 20);
  assert.deepEqual(Array.from(offsets), [0, 20, 60, 80]);
  assert.equal(buildLineOffsets(0, () => undefined, 20).length, 1);
  // A broken measurement must not produce a zero or negative line box.
  assert.deepEqual(Array.from(buildLineOffsets(2, () => Number.NaN, 0)), [0, SOURCE_LINE_HEIGHT, SOURCE_LINE_HEIGHT * 2]);
});

test("lineAtOffset finds the line containing a scroll position", () => {
  const offsets = buildLineOffsets(4, () => 10, 10);
  assert.equal(lineAtOffset(offsets, 0), 0);
  assert.equal(lineAtOffset(offsets, 9.9), 0);
  assert.equal(lineAtOffset(offsets, 10), 1);
  assert.equal(lineAtOffset(offsets, 35), 3);
  assert.equal(lineAtOffset(offsets, 1_000), 3);
  assert.equal(lineAtOffset(new Float64Array([0]), 50), 0);
});

test("visibleLineRange covers the viewport plus overscan and stays in bounds", () => {
  const offsets = buildLineOffsets(1_000, () => 20, 20);
  const range = visibleLineRange(offsets, 2_000, 400, SOURCE_OVERSCAN_LINES);
  assert.deepEqual(range, { start: 100 - SOURCE_OVERSCAN_LINES, end: 121 + SOURCE_OVERSCAN_LINES });
  assert.deepEqual(visibleLineRange(offsets, 0, 100, 20), { start: 0, end: 26 });
  assert.deepEqual(visibleLineRange(offsets, 19_990, 400, 20), { start: 1_000 - 21, end: 1_000 });
  assert.deepEqual(visibleLineRange(buildLineOffsets(0, () => 20, 20), 0, 400, 20), { start: 0, end: 0 });
});

test("highlightBlocks covers the window with one context lead-in per block", () => {
  const total = 1_000;
  // A window inside one block: one block, context taken from before it.
  const inside = highlightBlocks(total, 250, 300);
  assert.deepEqual(inside, [{
    start: SOURCE_HIGHLIGHT_BLOCK,
    end: SOURCE_HIGHLIGHT_BLOCK * 2,
    contextStart: 0,
  }]);
  // A window across a boundary needs both blocks, each with its own context.
  const crossing = highlightBlocks(total, 190, 210);
  assert.deepEqual(crossing, [
    { start: 0, end: SOURCE_HIGHLIGHT_BLOCK, contextStart: 0 },
    {
      start: SOURCE_HIGHLIGHT_BLOCK,
      end: SOURCE_HIGHLIGHT_BLOCK * 2,
      contextStart: SOURCE_HIGHLIGHT_BLOCK - SOURCE_HIGHLIGHT_CONTEXT,
    },
  ]);
  // The last block ends at the file's last line, never past it.
  assert.deepEqual(highlightBlocks(50, 0, 50), [{ start: 0, end: 50, contextStart: 0 }]);
  assert.deepEqual(highlightBlocks(total, 500, 500), []);
});

test("the spacer above a block is the block's offset, not the window's", () => {
  const offsets = buildLineOffsets(1_000, () => 20, 20);
  const total = offsets[offsets.length - 1];
  // The window starts at 250, but its block starts at 200: the rows render from
  // 201, so the space above them is line 200's offset, or they sit 50 rows low.
  const blocks = highlightBlocks(1_000, 250, 300);
  assert.deepEqual(blockSpacerHeights(offsets, blocks), {
    top: 200 * 20,
    bottom: total - 400 * 20,
  });
  assert.deepEqual(blockSpacerHeights(offsets, []), { top: 0, bottom: 0 });
});

test("scrollTopForLine puts the line at the top or the middle", () => {
  const offsets = buildLineOffsets(100, () => 20, 20);
  assert.equal(scrollTopForLine(offsets, 10, 400, "start"), 196);
  assert.equal(scrollTopForLine(offsets, 10, 400), Math.max(0, 200 - (400 - SOURCE_LINE_HEIGHT) / 2));
  assert.equal(scrollTopForLine(offsets, 0, 400), 0);
  assert.equal(scrollTopForLine(offsets, 10_000, 400, "start"), 1_976);
  assert.equal(scrollTopForLine(buildLineOffsets(0, () => 20, 20), 3, 400), 0);
});
