import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileMinimap.tsx", import.meta.url), "utf8");

function handlerBlock(name, nextName) {
  const start = source.indexOf(`const ${name} = useCallback(`);
  const end = source.indexOf(`const ${nextName} = useCallback(`, start);
  assert.notEqual(start, -1, `${name} not found`);
  assert.notEqual(end, -1, `${nextName} not found after ${name}`);
  return source.slice(start, end);
}

test("track presses start disengaged so jitter cannot cancel the smooth scroll", () => {
  const block = handlerBlock("handlePointerDown", "handlePointerMove");
  assert.match(block, /dragRef\.current = beginMinimapDrag\(onBox, pointerY, boxGeometry\)/);
  // The smooth scroll for track clicks must survive.
  const smooth = block.indexOf('"smooth"');
  assert.ok(smooth > block.indexOf("beginMinimapDrag"), "smooth scroll missing after drag begin");
});

test("pointermove scrolls instantly only once the drag is engaged", () => {
  const block = handlerBlock("handlePointerMove", "endDrag");
  const engagement = block.indexOf("shouldEngageMinimapDrag(drag, pointerY)");
  const instant = block.indexOf('"auto"');
  assert.ok(engagement >= 0, "engagement check missing");
  assert.ok(instant > engagement, "instant scroll must come after the engagement check");
  assert.match(block, /drag\.engaged = true/);
});
