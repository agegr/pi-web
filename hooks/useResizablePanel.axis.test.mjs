import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hookSource = () => readFile(new URL("./useResizablePanel.ts", import.meta.url), "utf8");

test("the resize hook supports a vertical axis without breaking the horizontal one", async () => {
  const source = await hookSource();

  // growthDirection now spans both axes; axis is derived from it.
  assert.match(source, /growthDirection: "left" \| "right" \| "up" \| "down"/);
  assert.match(source, /const axis: "x" \| "y" = growthDirection === "left" \|\| growthDirection === "right" \? "x" : "y"/);
});

test("drag uses the axis coordinate, cursor and grow direction", async () => {
  const source = await hookSource();

  assert.match(source, /startPos: axis === "x" \? event\.clientX : event\.clientY/);
  assert.match(source, /document\.body\.style\.cursor = axis === "x" \? "col-resize" : "row-resize"/);
  // Growing toward right/down follows the pointer; toward left/up opposes it.
  assert.match(source, /growthDirection === "right" \|\| growthDirection === "down" \? 1 : -1/);
  assert.match(source, /const pointerPos = axis === "x" \? event\.clientX : event\.clientY/);
});

test("keyboard and aria adapt to the axis", async () => {
  const source = await hookSource();

  assert.match(source, /growKeys = \{ right: "ArrowRight", left: "ArrowLeft", down: "ArrowDown", up: "ArrowUp" \}/);
  // A width separator is vertical; a height separator is horizontal.
  assert.match(source, /axis === "x" \? "vertical" : "horizontal"/);
});

test("the sidebar wires the Explorer splitter to the vertical hook", async () => {
  const sidebar = await readFile(new URL("../components/SessionSidebar.tsx", import.meta.url), "utf8");

  assert.match(sidebar, /cssVariable: "--explorer-height"/);
  assert.match(sidebar, /growthDirection: "up"/);
  assert.match(sidebar, /storageKey: "pi-explorer-height"/);
  assert.match(sidebar, /panel-resize-handle-horizontal/);
  assert.match(sidebar, /data-resize-handle="explorer"/);
  // The section height is seeded from state and read from the CSS var.
  assert.match(sidebar, /"--explorer-height": `\$\{explorerResizer\.width\}px`/);
  assert.match(sidebar, /height: explorerOpen \? "var\(--explorer-height\)" : undefined/);
});
