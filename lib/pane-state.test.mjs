import test from "node:test";
import assert from "node:assert/strict";
import {
  openPane,
  closePane,
  focusPane,
  setCompletionBadge,
  clearBadgeOnFocus,
  coalesceCompletionSound,
  paneWidth,
  MIN_PANE_WIDTH,
  isPlainClick,
} from "./pane-state.ts";

function tab(sid, label = sid, hasBadge = false) {
  return { sessionId: sid, label, hasBadge };
}

test("openPane adds a new tab unbounded", () => {
  const tabs = [];
  for (let i = 1; i <= 10; i++) {
    const next = openPane(tabs, `s${i}`, `Session ${i}`);
    tabs.length = 0;
    tabs.push(...next);
  }
  assert.equal(tabs.length, 10);
});

test("openPane never duplicates an existing session", () => {
  const initial = [tab("a"), tab("b")];
  const result = openPane(initial, "a", "Session A");
  assert.equal(result.length, 2);
  assert.equal(result[0].sessionId, "a");
});

test("closePane removes the tab even while running", () => {
  const tabs = [tab("a"), tab("b"), tab("c")];
  const result = closePane(tabs, "b");
  assert.equal(result.length, 2);
  assert.ok(!result.some((t) => t.sessionId === "b"));
});

test("closePane on empty leaves empty", () => {
  assert.deepEqual(closePane([], "x"), []);
});

test("focusPane returns the sessionId when it exists", () => {
  const tabs = [tab("a"), tab("b")];
  assert.equal(focusPane(tabs, "a", "b"), "b");
});

test("focusPane keeps the current focus when the target does not exist", () => {
  const tabs = [tab("a")];
  assert.equal(focusPane(tabs, "a", "zz"), "a");
});

test("setCompletionBadge marks only the target", () => {
  const tabs = [tab("a"), tab("b")];
  const result = setCompletionBadge(tabs, "b");
  assert.equal(result[0].hasBadge, false);
  assert.equal(result[1].hasBadge, true);
});

test("clearBadgeOnFocus resets only the target", () => {
  const tabs = [tab("a", "a", true), tab("b", "b", true)];
  const result = clearBadgeOnFocus(tabs, "a");
  assert.equal(result[0].hasBadge, false);
  assert.equal(result[1].hasBadge, true);
});

test("paneWidth splits the pane area equally while every pane fits", () => {
  assert.equal(paneWidth(0, 1280, MIN_PANE_WIDTH), 1280);
  assert.equal(paneWidth(1, 1280, MIN_PANE_WIDTH), 1280, "a single pane fills the whole area");
  assert.equal(paneWidth(2, 1280, MIN_PANE_WIDTH), 640);
  // 3 panes on a 1280px area: floor(1280/360) = 3, so all three fit.
  assert.equal(paneWidth(3, 1280, MIN_PANE_WIDTH), 1280 / 3);
});

test("paneWidth floors every pane to MIN_PANE_WIDTH beyond the area's capacity", () => {
  // floor(1080/360) = 3, so a fourth pane overflows.
  assert.equal(paneWidth(4, 1080, MIN_PANE_WIDTH), MIN_PANE_WIDTH);
  assert.equal(paneWidth(5, 1280, MIN_PANE_WIDTH), MIN_PANE_WIDTH, "5 panes on 1280px hit the floor");
});

test("paneWidth never produces zero-width panes on a too-narrow area", () => {
  // floor(300/360) = 0 clamps up to 1: two panes cannot fit, so each gets
  // the full MIN_PANE_WIDTH and the pane area scrolls.
  assert.equal(paneWidth(2, 300, MIN_PANE_WIDTH), MIN_PANE_WIDTH);
  assert.equal(paneWidth(3, 200, MIN_PANE_WIDTH), MIN_PANE_WIDTH);
});

test("paneWidth guards a degenerate minPaneWidth", () => {
  assert.equal(paneWidth(3, 1200, 0), 400, "a zero floor falls back to the equal split");
  assert.equal(paneWidth(3, 1200, Number.NaN), 400, "a non-finite floor falls back to the equal split");
});

test("coalesceCompletionSound returns true after the window", () => {
  const now = 1000;
  assert.ok(coalesceCompletionSound(400, now, 500));
  assert.ok(!coalesceCompletionSound(600, now, 500));
});

test("isPlainClick discriminates drag-selection", () => {
  assert.ok(isPlainClick(false));
  assert.ok(!isPlainClick(true));
});
