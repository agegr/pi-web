import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  baseLineColor,
  beginMinimapDrag,
  canvasOffsetForFraction,
  computeMinimapGeometry,
  computeMinimapWidth,
  diffLineKindToColor,
  diffSegmentsToMinimapRows,
  fractionForBoxTop,
  fractionForPointer,
  fractionForScrollTop,
  hasMinimapOverflow,
  MINIMAP_DEFAULT_WIDTH,
  MINIMAP_DRAG_THRESHOLD_PX,
  MINIMAP_LINE_HEIGHT,
  MINIMAP_MAX_CANVAS_FACTOR,
  scrollTopForFraction,
  shouldEngageMinimapDrag,
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

test("minimap width stays fixed at the default width", () => {
  assert.equal(computeMinimapWidth(), MINIMAP_DEFAULT_WIDTH);
  assert.equal(computeMinimapWidth(), computeMinimapWidth());
});

test("viewport box tracks the scroll fraction and keeps its minimum height", () => {
  const scrollHeight = 10_000;
  const clientHeight = 500;
  const track = 600;
  // Canvas taller than the container: the strip itself is the track, but the
  // box height is measured against the canvas.
  const canvas = track * 2;
  const expectedHeight = (clientHeight / scrollHeight) * canvas;

  const top = viewportBoxGeometry(0, scrollHeight, clientHeight, track, canvas);
  assert.equal(top.top, 0);
  assert.equal(top.height, expectedHeight);

  const bottom = viewportBoxGeometry(scrollHeight - clientHeight, scrollHeight, clientHeight, track, canvas);
  assert.ok(Math.abs(bottom.top - (track - expectedHeight)) < 1e-9);

  // A visible thumbnail taller than the strip is clamped to fill the track.
  const tall = viewportBoxGeometry(0, 610, 600, track, canvas);
  assert.equal(tall.height, track);
  assert.equal(tall.top, 0);

  const degenerate = viewportBoxGeometry(0, 0, 0, track, canvas);
  assert.equal(degenerate.top, 0);
  assert.equal(degenerate.height, track);
});

test("viewport box exactly overlays the visible lines' thumbnail", () => {
  const scrollHeight = 10_000;
  const clientHeight = 500;
  const container = 600;
  const canvas = 1200;
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const scrollTop = fraction * (scrollHeight - clientHeight);
    const box = viewportBoxGeometry(scrollTop, scrollHeight, clientHeight, container, canvas);
    // The canvas position of the first visible line, corrected by the same
    // parallax shift applied to the canvas element, is the box top.
    const firstVisibleCanvasY = (scrollTop / scrollHeight) * canvas;
    const shift = canvasOffsetForFraction(fraction, canvas, container);
    assert.ok(Math.abs(box.top - (firstVisibleCanvasY + shift)) < 1e-9);
    // The box height is the visible range mapped onto the canvas.
    assert.ok(Math.abs(box.height - (clientHeight / scrollHeight) * canvas) < 1e-9);
  }
});

test("viewport box is confined to the canvas for short documents", () => {
  // A 65-line file that barely overflows: canvas is far shorter than the strip.
  const containerHeight = 1245;
  const canvas = 65 * MINIMAP_LINE_HEIGHT; // 130
  const clientHeight = 1200;
  const scrollHeight = 1235;
  const expectedHeight = (clientHeight / scrollHeight) * canvas;

  const top = viewportBoxGeometry(0, scrollHeight, clientHeight, containerHeight, canvas);
  assert.equal(top.top, 0);
  assert.ok(Math.abs(top.height - expectedHeight) < 1e-9);

  const bottom = viewportBoxGeometry(scrollHeight - clientHeight, scrollHeight, clientHeight, containerHeight, canvas);
  assert.ok(Math.abs(bottom.top - (canvas - expectedHeight)) < 1e-9);

  // Dragging: box tops below the canvas clamp to fraction 1, pointer positions
  // in the empty strip below the thumbnail likewise clamp to the end.
  assert.equal(fractionForBoxTop(canvas - expectedHeight, containerHeight, expectedHeight, canvas), 1);
  assert.equal(fractionForBoxTop(800, containerHeight, expectedHeight, canvas), 1);
  assert.equal(fractionForPointer(1100, containerHeight, expectedHeight, canvas), 1);
  assert.equal(fractionForPointer(0, containerHeight, expectedHeight, canvas), 0);

  // A tiny track never produces a negative box top.
  const tiny = viewportBoxGeometry(1, 100, 50, 10, 4);
  assert.ok(tiny.height <= 4);
  assert.ok(tiny.top >= 0);
});

test("pointer fraction centers the box; box-top fraction matches box geometry", () => {
  const track = 600;
  const canvas = track * 2;
  const boxHeight = 60;
  // Pointer in the middle → box centered → fraction 0.5.
  assert.ok(Math.abs(fractionForPointer(300, track, boxHeight, canvas) - 0.5) < 1e-9);
  // Dragging the box to the very bottom must land on fraction 1.
  assert.equal(fractionForBoxTop(track - boxHeight, track, boxHeight, canvas), 1);
  assert.equal(fractionForBoxTop(0, track, boxHeight, canvas), 0);
  // Box taller than the track never divides by zero.
  assert.equal(fractionForBoxTop(10, 50, 60, 100), 0);
  assert.equal(fractionForPointer(10, 50, 60, 100), 0);
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

test("box grabs engage the drag immediately, track presses stay disengaged", () => {
  const box = { top: 100, height: 60 };

  const onBox = beginMinimapDrag(true, 130, box);
  assert.equal(onBox.engaged, true);
  assert.equal(onBox.grabOffset, 30);
  assert.equal(onBox.startPointerY, 130);
  assert.equal(shouldEngageMinimapDrag(onBox, 130), true);

  const onTrack = beginMinimapDrag(false, 400, box);
  assert.equal(onTrack.engaged, false);
  assert.equal(onTrack.grabOffset, 30);
  assert.equal(onTrack.startPointerY, 400);
});

test("track presses engage only past the drag threshold, in either direction", () => {
  const drag = beginMinimapDrag(false, 400, { top: 0, height: 60 });
  const below = MINIMAP_DRAG_THRESHOLD_PX - 0.5;
  assert.equal(shouldEngageMinimapDrag(drag, 400 + below), false);
  assert.equal(shouldEngageMinimapDrag(drag, 400 - below), false);
  assert.equal(shouldEngageMinimapDrag(drag, 400 + MINIMAP_DRAG_THRESHOLD_PX), true);
  assert.equal(shouldEngageMinimapDrag(drag, 400 - MINIMAP_DRAG_THRESHOLD_PX), true);
  // Once engaged, later positions stay engaged regardless of distance.
  assert.equal(shouldEngageMinimapDrag({ ...drag, engaged: true }, 400), true);
});
