import test from "node:test";
import assert from "node:assert/strict";
import {
  openPane,
  closePane,
  focusPane,
  setCompletionBadge,
  clearBadgeOnFocus,
  coalesceCompletionSound,
  densityWidth,
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

test("densityWidth maps correctly", () => {
  assert.equal(densityWidth("default"), "33.3333%");
  assert.equal(densityWidth("compact"), "25%");
});

test("densityWidth falls back for unknown density", () => {
  assert.equal(densityWidth("bogus"), "33.3333%");
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
