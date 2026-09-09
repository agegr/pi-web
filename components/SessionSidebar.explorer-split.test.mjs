import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const hook = await readFile(new URL("../hooks/useResizablePanel.ts", import.meta.url), "utf8");

test("the explorer split reuses the shared panel resizer", () => {
  assert.match(source, /useResizablePanel\(\{[\s\S]*?cssVariable: "--explorer-height"[\s\S]*?growthDirection: "up"[\s\S]*?storageKey: "pi-explorer-height"/);
  assert.match(source, /\{\.\.\.explorerResizer\.separatorProps\}/);
  // The ceiling is the space the list and explorer share, not the whole sidebar:
  // the header above the list is fixed, so counting it would let the explorer overflow.
  assert.match(source, /const listHeight = listScrollRef\.current\?\.getBoundingClientRect\(\)\.height \?\? 0;/);
  assert.match(source, /Math\.floor\(listHeight \+ explorerHeight\) - SESSION_LIST_MIN_HEIGHT/);
  // The list yields the remaining space, so both panels keep a usable minimum.
  assert.match(source, /height: explorerOpen \? "var\(--explorer-height\)" : undefined/);
  assert.match(source, /flex: "1 1 0", overflowY: "auto", padding: "0", minHeight: SESSION_LIST_MIN_HEIGHT/);
});

test("the resizer drives either axis from one implementation", () => {
  assert.match(hook, /const vertical = growthDirection === "up" \|\| growthDirection === "down"/);
  assert.match(hook, /startPosition: vertical \? event\.clientY : event\.clientX/);
  assert.match(hook, /document\.body\.style\.cursor = vertical \? "row-resize" : "col-resize"/);
  assert.match(hook, /"aria-orientation": vertical \? \("horizontal" as const\) : \("vertical" as const\)/);
  // Horizontal callers keep their original keys and direction.
  assert.match(hook, /growthDirection === "right" \|\| growthDirection === "down" \? 1 : -1/);
  assert.match(hook, /growthDirection === "right" \? "ArrowRight"/);
});
