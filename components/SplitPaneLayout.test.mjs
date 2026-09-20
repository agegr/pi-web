import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, "SplitPaneLayout.tsx"), "utf-8");
const paneStateSource = readFileSync(join(dir, "..", "lib", "pane-state.ts"), "utf-8");

test("SplitPaneLayout renders a fixed single-height tab strip", () => {
  assert.ok(source.includes("height: STRIP_HEIGHT"), "tab strip must have a fixed height");
  assert.ok(source.includes("flexShrink: 0"), "tab strip must not shrink");
  assert.ok(source.includes("overflowX: \"auto\""), "tab strip must be horizontally scrollable");
});

test("SplitPaneLayout pane area is a horizontal scroll container", () => {
  assert.ok(source.includes("overflowX: \"auto\""), "pane area must scroll horizontally");
  assert.ok(source.includes("flex: \"none\""), "panes must not flex (fixed width)");
  assert.ok(source.includes("width"), "panes must have a width prop");
});

test("SplitPaneLayout uses densityWidth for equal-width panes", () => {
  assert.ok(source.includes("densityWidth"), "must use the densityWidth helper");
  assert.ok(paneStateSource.includes("33.3333%"), "default density is 1/3");
  assert.ok(paneStateSource.includes("25%"), "compact density is 1/4");
});

test("focus discrimination uses isPlainClick (drag-selection does not steal focus)", () => {
  assert.ok(source.includes("isPlainClick"), "must use the isPlainClick helper");
  assert.ok(source.includes("onPointerUp"), "must check selection at pointerup (blocker 2 fix)");
  assert.ok(source.includes("window.getSelection"), "must check for text selection");
  assert.ok(!source.includes("pointerDownHadSelectionRef"), "must NOT track selection at pointerdown");
});

test("SplitPaneLayout exports scrollPaneIntoView for sidebar routing", () => {
  assert.ok(source.includes("scrollPaneIntoView"), "must expose scrollPaneIntoView");
  assert.ok(source.includes("scrollTo"), "must call container.scrollTo");
  assert.ok(source.includes("useImperativeHandle(ref"), "must pass ref to useImperativeHandle (blocker 1 fix)");
});
