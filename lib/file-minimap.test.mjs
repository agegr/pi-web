import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  baseLineColor,
  canvasOffsetForFraction,
  computeMinimapGeometry,
  computeMinimapWidth,
  diffLineKindToColor,
  diffSegmentsToMinimapRows,
  fractionForBoxTop,
  fractionForPointer,
  fractionForScrollTop,
  hasMinimapOverflow,
  MINIMAP_LINE_HEIGHT,
  MINIMAP_MAX_CANVAS_FACTOR,
  MINIMAP_MAX_WIDTH,
  MINIMAP_MIN_WIDTH,
  MINIMAP_VIEWPORT_MIN_HEIGHT,
  scrollTopForFraction,
  viewportBoxGeometry,
} = await jiti.import("./file-minimap.ts");

test("fraction <-> scrollTop round-trips across the range", () => {
  const scrollHeight = 10_000;
  const clientHeight = 500;
  for (const scrollTop of [0, 1, 1234.5, scrollHeight - clientHeight - 1, scrollHeight - clientHeight]) {
    const fraction = fractionForScrollTop(scrollTop, scrollHeight, clientHeight);
    assert.ok(Math.abs(scrollTopForFraction(fraction, scrollHeight, clientHeight) - scrollTop) < 1e-9);
  }
});

test("fraction mapping clamps and handles degenerate ranges", () => {
  assert.equal(fractionForScrollTop(100, 500, 500), 0);
  assert.equal(fractionForScrollTop(-50, 1000, 100), 0);
  assert.equal(fractionForScrollTop(Number.NaN, 1000, 100), 0);
  assert.equal(scrollTopForFraction(2, 1000, 100), 900);
  assert.equal(scrollTopForFraction(-1, 1000, 100), 0);
  assert.equal(scrollTopForFraction(0.5, 100, 100), 0);
});

test("overflow visibility threshold", () => {
  assert.equal(hasMinimapOverflow(1000, 500), true);
  assert.equal(hasMinimapOverflow(520, 500), false);
  assert.equal(hasMinimapOverflow(500, 500), false);
});

test("small documents get the natural canvas height at full line height", () => {
  const geometry = computeMinimapGeometry(100, 600);
  assert.equal(geometry.lineHeightPx, MINIMAP_LINE_HEIGHT);
  assert.equal(geometry.canvasHeight, 100 * MINIMAP_LINE_HEIGHT);
  assert.equal(geometry.stripMode, false);
});

test("huge documents cap the canvas and switch to strip mode below 1px lines", () => {
  const containerHeight = 600;
  const maxCanvas = containerHeight * MINIMAP_MAX_CANVAS_FACTOR;

  const capped = computeMinimapGeometry(2_000, containerHeight);
  assert.equal(capped.canvasHeight, 2_000 * MINIMAP_LINE_HEIGHT);
  assert.equal(capped.stripMode, false);

  const dense = computeMinimapGeometry(100_000, containerHeight);
  assert.equal(dense.canvasHeight, maxCanvas);
  assert.equal(dense.lineHeightPx, maxCanvas / 100_000);
  assert.equal(dense.stripMode, true);
});

test("minimap width adapts to the container within clamp bounds", () => {
  assert.equal(computeMinimapWidth(200), MINIMAP_MIN_WIDTH);
  assert.equal(computeMinimapWidth(800), 96);
  assert.equal(computeMinimapWidth(4000), MINIMAP_MAX_WIDTH);
  assert.equal(computeMinimapWidth(0), 96);
});

test("viewport box tracks the scroll fraction and keeps its minimum height", () => {
  const scrollHeight = 10_000;
  const clientHeight = 500;
  const track = 600;
  const expectedHeight = (clientHeight / scrollHeight) * track;

  const top = viewportBoxGeometry(0, scrollHeight, clientHeight, track);
  assert.equal(top.top, 0);
  assert.equal(top.height, expectedHeight);

  const bottom = viewportBoxGeometry(scrollHeight - clientHeight, scrollHeight, clientHeight, track);
  assert.ok(Math.abs(bottom.top - (track - expectedHeight)) < 1e-9);

  // Nearly-fully-visible documents hit the minimum box height.
  const tall = viewportBoxGeometry(0, 610, 600, track);
  assert.equal(tall.height, Math.max(MINIMAP_VIEWPORT_MIN_HEIGHT, (600 / 610) * track));

  const degenerate = viewportBoxGeometry(0, 0, 0, track);
  assert.equal(degenerate.top, 0);
  assert.equal(degenerate.height, track);
});

test("pointer fraction centers the box; box-top fraction matches box geometry", () => {
  const track = 600;
  const boxHeight = 60;
  // Pointer in the middle → box centered → fraction 0.5.
  assert.ok(Math.abs(fractionForPointer(300, track, boxHeight) - 0.5) < 1e-9);
  // Dragging the box to the very bottom must land on fraction 1.
  assert.equal(fractionForBoxTop(track - boxHeight, track, boxHeight), 1);
  assert.equal(fractionForBoxTop(0, track, boxHeight), 0);
  // Box taller than the track never divides by zero.
  assert.equal(fractionForBoxTop(10, 50, 60), 0);
  assert.equal(fractionForPointer(10, 50, 60), 0);
});

test("canvas parallax glues both ends", () => {
  assert.equal(canvasOffsetForFraction(0, 2000, 600), 0);
  assert.equal(canvasOffsetForFraction(1, 2000, 600), -(2000 - 600));
  // Canvas shorter than the container never shifts.
  assert.equal(canvasOffsetForFraction(0.5, 300, 600), 0);
});

test("diff colors distinguish added/removed/unchanged and follow the theme", () => {
  assert.notEqual(diffLineKindToColor("added", true), diffLineKindToColor("removed", true));
  assert.notEqual(diffLineKindToColor("unchanged", true), diffLineKindToColor("unchanged", false));
  assert.equal(diffLineKindToColor("added", true), diffLineKindToColor("added", false));
  assert.notEqual(baseLineColor(true), baseLineColor(false));
});

test("collapsed diff regions map to one minimap row each", () => {
  const rows = diffSegmentsToMinimapRows([
    { hidden: false, lines: [{ type: "unchanged", text: "a" }, { type: "added", text: "b" }] },
    { hidden: true },
    { hidden: false, lines: [{ type: "removed", text: "c" }] },
  ]);
  assert.deepEqual(rows.lines, ["a", "b", "…", "c"]);
  assert.deepEqual(rows.kinds, ["unchanged", "added", "unchanged", "removed"]);

  assert.deepEqual(diffSegmentsToMinimapRows([]), { lines: [], kinds: [] });
});
