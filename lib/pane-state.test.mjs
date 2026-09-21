import test from "node:test";
import assert from "node:assert/strict";
import {
  openPane,
  closePane,
  focusPane,
  setCompletionBadge,
  clearBadgeOnFocus,
  coalesceCompletionSound,
  clampMaxVisiblePanes,
  paneWidth,
  loadMaxVisiblePanes,
  persistMaxVisiblePanes,
  MAX_VISIBLE_PANES_KEY,
  MAX_VISIBLE_PANES_DEFAULT,
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

test("paneWidth maps open-pane count to width fractions (count-adaptive)", () => {
  assert.equal(paneWidth(0, 3), "100%");
  assert.equal(paneWidth(1, 3), "100%");
  assert.equal(paneWidth(2, 3), "50%");
  assert.equal(paneWidth(3, 3), "33.3333%");
});

test("paneWidth never shrinks below 1/N when the pane count exceeds N", () => {
  assert.equal(paneWidth(4, 3), "33.3333%");
  assert.equal(paneWidth(6, 3), "33.3333%");
  assert.equal(paneWidth(9, 4), "25%");
});

test("paneWidth follows a smaller maxVisiblePanes setting", () => {
  assert.equal(paneWidth(2, 2), "50%");
  assert.equal(paneWidth(3, 2), "50%");
  assert.equal(paneWidth(3, 4), "33.3333%");
  assert.equal(paneWidth(4, 4), "25%");
});

test("paneWidth clamps an out-of-range maxVisiblePanes", () => {
  assert.equal(paneWidth(3, 1), "50%", "N below the min clamps up to 2");
  assert.equal(paneWidth(3, 99), "33.3333%", "N above the max clamps down to 4");
});

test("clampMaxVisiblePanes clamps to 2-4 and defaults on invalid input", () => {
  assert.equal(clampMaxVisiblePanes(3), 3);
  assert.equal(clampMaxVisiblePanes(1), 2);
  assert.equal(clampMaxVisiblePanes(5), 4);
  assert.equal(clampMaxVisiblePanes(NaN), 3);
  assert.equal(clampMaxVisiblePanes(Infinity), 3);
});

test("loadMaxVisiblePanes reads and clamps the stored value", () => {
  assert.equal(MAX_VISIBLE_PANES_KEY, "pi-max-visible-panes");
  const of = (v) => ({ getItem: () => v });
  assert.equal(loadMaxVisiblePanes(of("4")), 4);
  assert.equal(loadMaxVisiblePanes(of("2")), 2);
  assert.equal(loadMaxVisiblePanes(of("1")), 2, "out-of-range stored value clamps to 2");
  assert.equal(loadMaxVisiblePanes(of("9")), 4, "out-of-range stored value clamps to 4");
  assert.equal(loadMaxVisiblePanes(of("bogus")), 3, "invalid stored value falls back to 3");
  assert.equal(loadMaxVisiblePanes(of(null)), 3, "absent stored value falls back to 3");
  assert.equal(
    loadMaxVisiblePanes({ getItem: () => { throw new Error("boom"); } }),
    3,
    "storage failure falls back to 3",
  );
});

test("persistMaxVisiblePanes round-trips clamped values", () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  assert.equal(persistMaxVisiblePanes(5, storage), 4);
  assert.equal(loadMaxVisiblePanes(storage), 4);
  assert.equal(store.get(MAX_VISIBLE_PANES_KEY), "4");
  persistMaxVisiblePanes(1, storage);
  assert.equal(loadMaxVisiblePanes(storage), 2);
  persistMaxVisiblePanes(3, storage);
  assert.equal(loadMaxVisiblePanes(storage), 3);
  assert.equal(MAX_VISIBLE_PANES_DEFAULT, 3);
});

test("persistMaxVisiblePanes tolerates a throwing storage", () => {
  assert.equal(
    persistMaxVisiblePanes(3, { setItem: () => { throw new Error("boom"); } }),
    3,
  );
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
