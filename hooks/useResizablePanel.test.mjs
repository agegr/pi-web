import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useResizablePanel.ts", import.meta.url), "utf8");

test("vertical panels use vertical pointer movement, cursor, keys, and separator orientation", () => {
  assert.match(source, /axis === "vertical" \? event\.clientY : event\.clientX/);
  assert.match(source, /axis === "vertical" \? "row-resize" : "col-resize"/);
  assert.match(source, /axis === "vertical" \? "ArrowDown" : "ArrowRight"/);
  assert.match(source, /axis === "vertical" \? "ArrowUp" : "ArrowLeft"/);
  assert.match(source, /axis === "vertical" \? "horizontal" as const : "vertical" as const/);
});

test("resized values continue to persist and reset through the shared panel contract", () => {
  assert.match(source, /writeStoredWidth\(storageKey, nextWidth\)/);
  assert.match(source, /onDoubleClick: resetWidth/);
  assert.match(source, /event\.key === "Enter"/);
  assert.match(source, /window\.addEventListener\("resize", onResize\)/);
});
