import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, "SplitPaneLayout.tsx"), "utf-8");
const paneStateSource = readFileSync(join(dir, "..", "lib", "pane-state.ts"), "utf-8");
const paneHeaderSource = readFileSync(join(dir, "PaneHeader.tsx"), "utf-8");

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

test("SplitPaneLayout derives pixel pane widths from the measured pane area", () => {
  assert.ok(source.includes("paneWidth"), "must use the paneWidth helper");
  assert.ok(source.includes("paneWidth(tabs.length"), "width must derive from the tab count and the measured area");
  assert.ok(source.includes("MIN_PANE_WIDTH"), "must floor panes at MIN_PANE_WIDTH");
  assert.ok(source.includes("ResizeObserver"), "must self-measure the pane area with a ResizeObserver");
  assert.ok(source.includes("setPaneAreaWidth"), "measured area width must feed pane sizing");
  assert.ok(source.includes("${width}px"), "pane width must be a pixel value");
  assert.ok(!source.includes("VisiblePanes"), "the manual visible-pane cap setting must be gone");
  assert.ok(!source.includes("density"), "the density concept must be gone");
  assert.ok(paneStateSource.includes("MIN_PANE_WIDTH = 360"), "pane-state owns the single MIN_PANE_WIDTH constant");
  assert.ok(paneStateSource.includes("Math.max(1, Math.floor(areaWidth / minPaneWidth))"),
    "pane-state clamps capacity to at least one pane");
});

test("PaneHeader caps tab width while the strip stays scrollable", () => {
  assert.ok(paneHeaderSource.includes("maxWidth: 150"), "tab button must carry a max width");
  assert.ok(paneHeaderSource.includes("textOverflow: \"ellipsis\""), "long labels must truncate with an ellipsis");
  assert.ok(paneHeaderSource.includes("title={label}"), "full label must stay available via tooltip");
  assert.ok(source.includes("overflowX: \"auto\""), "tab strip must keep horizontal scrolling for short tabs");
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
