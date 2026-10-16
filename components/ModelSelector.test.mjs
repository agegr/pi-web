import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { getModelSelectorPosition } = await jiti.import("./ModelSelector.tsx");
const anchor = { top: 720, bottom: 752, left: 20, width: 200 };
const viewport = { top: 0, left: 0, width: 390, height: 844 };

function bounds(position) {
  return {
    left: position.left,
    right: position.left + position.maxWidth,
    top: position.openAbove ? position.top - position.maxHeight : position.top,
    bottom: position.openAbove ? position.top : position.top + position.maxHeight,
  };
}

test("a mobile picker fits above its trigger without relying on layout-viewport bottom", () => {
  const position = getModelSelectorPosition(anchor, viewport, true, "up");
  assert.equal(position.openAbove, true);
  assert.equal(position.top, 714);
  assert.equal(position.left, 8);
  assert.equal(position.maxWidth, 374);
  assert.equal(position.minWidth, 0);
  assert.equal(position.maxHeight, viewport.height * 0.6);
});

test("a keyboard-hidden anchor is clamped inside the shrunken visual viewport", () => {
  const position = getModelSelectorPosition(anchor, { ...viewport, height: 450 }, true, "up");
  assert.deepEqual(bounds(position), { left: 8, right: 382, top: 172, bottom: 442 });
  assert.equal(position.maxHeight, 270);
});

test("panned and zoomed viewports include both offsets in their fixed coordinates", () => {
  const position = getModelSelectorPosition(anchor, { top: 70, left: 20, width: 350, height: 340 }, true, "up");
  assert.deepEqual(bounds(position), { left: 28, right: 362, top: 198, bottom: 402 });
});

test("auto placement and a near-top upward trigger use the space below", () => {
  for (const placement of ["up", "auto"]) {
    const position = getModelSelectorPosition({ ...anchor, top: 10, bottom: 42 }, viewport, false, placement);
    assert.equal(position.openAbove, false);
    assert.equal(position.top, 48);
    assert.equal(position.minWidth, 200);
  }
});

test("desktop fields stay within the right edge even when their trigger is off screen", () => {
  const position = getModelSelectorPosition({ ...anchor, left: 800 }, viewport, false, "auto");
  assert.equal(position.left, 182);
  assert.equal(position.minWidth, 200);
  assert.equal(position.maxWidth, 200);
});

test("tiny viewports never inherit the old overflowing 120px minimum", () => {
  for (const mobile of [true, false]) {
    for (const width of [0, 10, 100, 390]) {
      for (const height of [0, 10, 80, 200]) {
        for (const top of [-200, 0, 50, 720]) {
          const position = getModelSelectorPosition({ ...anchor, top, bottom: top + 32 }, { ...viewport, width, height }, mobile, "up");
          const box = bounds(position);
          assert.ok(position.minWidth >= 0 && position.minWidth <= position.maxWidth);
          assert.ok(position.maxHeight >= 0);
          assert.ok(box.top >= 0 && box.bottom <= height);
          assert.ok(box.left >= 0 && box.right <= width);
        }
      }
    }
  }
});
