import test from "node:test";
import assert from "node:assert/strict";
import {
  openPane,
  openNewSessionTab,
  NEW_SESSION_TAB_ID,
  closePane,
  focusPane,
  setCompletionBadge,
  clearBadgeOnFocus,
  coalesceCompletionSound,
  paneWidth,
  paneHeaderLabel,
  visiblePaneCapacity,
  MIN_PANE_WIDTH,
  isPlainClick,
  resolveBackgroundTasksSessionId,
} from "./pane-state.ts";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { projectDisplayNameForPath } = await jiti.import("./project-groups.ts");

function tab(sid, label = sid, hasBadge = false, projectName = "proj") {
  return { sessionId: sid, label, projectName, hasBadge };
}

test("paneHeaderLabel attributes panes as project · session (pi#25)", () => {
  assert.equal(paneHeaderLabel(tab("s1", "Chat about tabs")), "proj · Chat about tabs");
  assert.equal(
    paneHeaderLabel({ sessionId: "x", label: "My chat", projectName: "pi-web", hasBadge: false }),
    "pi-web · My chat",
  );
});

test("paneHeaderLabel renders the sentinel as New · project (pi#25)", () => {
  const sentinel = { sessionId: NEW_SESSION_TAB_ID, label: "新建", projectName: "pi-web", hasBadge: false };
  assert.equal(paneHeaderLabel(sentinel), "新建 · pi-web");
  const english = { ...sentinel, label: "New" };
  assert.equal(paneHeaderLabel(english), "New · pi-web",
    "the sentinel's localized short word comes from its label, not a hardcode");
});

test("visiblePaneCapacity floors the area and clamps to at least one pane", () => {
  assert.equal(visiblePaneCapacity(1280, MIN_PANE_WIDTH), 2);
  assert.equal(visiblePaneCapacity(1080, MIN_PANE_WIDTH), 2);
  assert.equal(visiblePaneCapacity(1560, MIN_PANE_WIDTH), 3);
  assert.equal(visiblePaneCapacity(900, MIN_PANE_WIDTH), 1);
  assert.equal(visiblePaneCapacity(300, MIN_PANE_WIDTH), 1, "floor(300/520)=0 clamps up to 1");
  assert.equal(visiblePaneCapacity(0, MIN_PANE_WIDTH), 1, "a non-positive area still holds one pane");
  assert.equal(visiblePaneCapacity(Number.NaN, MIN_PANE_WIDTH), 1);
  assert.equal(visiblePaneCapacity(1280, 0), Number.MAX_SAFE_INTEGER,
    "a degenerate floor removes the capacity bound (sizing falls back to the equal split)");
});

test("visiblePaneCapacity is the single source of truth paneWidth sizes by", () => {
  // floor(1560/520) = 3 (pi#27): exactly 3 panes fit, a 4th overflows.
  assert.equal(paneWidth(3, 1560, MIN_PANE_WIDTH), 1560 / visiblePaneCapacity(1560, MIN_PANE_WIDTH));
  assert.equal(paneWidth(4, 1560, MIN_PANE_WIDTH), MIN_PANE_WIDTH);
});

test("projectDisplayNameForPath returns the project root basename, never empty", () => {
  assert.equal(projectDisplayNameForPath("/home/me/code/pi-web"), "pi-web");
  assert.equal(projectDisplayNameForPath("/home/me/code/pi-web/"), "pi-web",
    "trailing slashes are ignored");
  assert.equal(projectDisplayNameForPath("C:\\work\\pi-web"), "pi-web", "Windows separators split too");
  assert.equal(projectDisplayNameForPath("C:\\work\\pi-web\\"), "pi-web");
  assert.equal(projectDisplayNameForPath(""), "?", "empty roots fall back to ?");
  assert.equal(projectDisplayNameForPath(null), "?", "null roots fall back to ?");
  assert.equal(projectDisplayNameForPath(undefined), "?", "undefined roots fall back to ?");
  assert.equal(projectDisplayNameForPath("/"), "?", "a bare root falls back to ?");
});

test("openPane stamps projectName at creation (pi#25)", () => {
  const result = openPane([], "s1", "Chat", "osp-ws");
  assert.equal(result.length, 1);
  assert.equal(result[0].projectName, "osp-ws");
});

test("openNewSessionTab stamps the sentinel with its project", () => {
  const { tabs } = openNewSessionTab([], "新建", "osp-ws");
  assert.equal(tabs[0].sessionId, NEW_SESSION_TAB_ID);
  assert.equal(tabs[0].projectName, "osp-ws");
  assert.equal(paneHeaderLabel(tabs[0]), "新建 · osp-ws");
  const again = openNewSessionTab(tabs, "新建", "other");
  assert.ok(again.existed, "the sentinel is never duplicated");
  assert.equal(again.tabs.length, 1);
});

test("openPane adds a new tab unbounded", () => {
  const tabs = [];
  for (let i = 1; i <= 10; i++) {
    const next = openPane(tabs, `s${i}`, `Session ${i}`, "proj");
    tabs.length = 0;
    tabs.push(...next);
  }
  assert.equal(tabs.length, 10);
});

test("openPane never duplicates an existing session", () => {
  const initial = [tab("a"), tab("b")];
  const result = openPane(initial, "a", "Session A", "proj");
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
  assert.equal(paneWidth(0, 1680, MIN_PANE_WIDTH), 1680);
  assert.equal(paneWidth(1, 1680, MIN_PANE_WIDTH), 1680, "a single pane fills the whole area");
  assert.equal(paneWidth(2, 1680, MIN_PANE_WIDTH), 840);
  // 3 panes on a 1680px area: floor(1680/520) = 3, so all three fit (pi#27).
  assert.equal(paneWidth(3, 1680, MIN_PANE_WIDTH), 1680 / 3);
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

// --- Background-tasks panel session derivation (pi#28) ---

function bgArgs(overrides = {}) {
  return {
    splitPaneEnabled: true,
    focusedPaneId: null,
    selectedSessionId: null,
    lastSessionPaneId: null,
    paneTabs: [],
    ...overrides,
  };
}

test("resolveBackgroundTasksSessionId follows the focused session pane in split view", () => {
  // Focus on a session pane wins even when selectedSession is null or stale —
  // the exact pi#28 regression (panel read selectedSession only).
  assert.equal(
    resolveBackgroundTasksSessionId(bgArgs({
      focusedPaneId: "s2",
      selectedSessionId: null,
      paneTabs: [tab("s1"), tab("s2")],
    })),
    "s2",
  );
  assert.equal(
    resolveBackgroundTasksSessionId(bgArgs({
      focusedPaneId: "s2",
      selectedSessionId: "s1", // stale selection from before the pane switch
      paneTabs: [tab("s1"), tab("s2")],
    })),
    "s2",
  );
});

test("resolveBackgroundTasksSessionId keeps the classic layout on selectedSession", () => {
  assert.equal(
    resolveBackgroundTasksSessionId(bgArgs({ splitPaneEnabled: false, selectedSessionId: "s1" })),
    "s1",
  );
  assert.equal(
    resolveBackgroundTasksSessionId(bgArgs({ splitPaneEnabled: false, selectedSessionId: null })),
    null,
  );
  // A stale focusedPaneId must not leak into the classic/mobile layout.
  assert.equal(
    resolveBackgroundTasksSessionId(bgArgs({
      splitPaneEnabled: false,
      focusedPaneId: "s2",
      selectedSessionId: "s1",
    })),
    "s1",
  );
});

test("resolveBackgroundTasksSessionId falls back off the sentinel to the last session pane", () => {
  const tabs = [tab("s1"), { sessionId: NEW_SESSION_TAB_ID, label: "New", projectName: "p", hasBadge: false }];
  // Sentinel focused after focusing s1: keep following s1 (empty state, not
  // "unavailable") while it is still open.
  assert.equal(
    resolveBackgroundTasksSessionId(bgArgs({
      focusedPaneId: NEW_SESSION_TAB_ID,
      lastSessionPaneId: "s1",
      paneTabs: tabs,
    })),
    "s1",
  );
  // No focus yet but session panes are open: follow the first open one.
  assert.equal(
    resolveBackgroundTasksSessionId(bgArgs({ paneTabs: tabs })),
    "s1",
  );
  // The last focused pane was closed: fall to another open session pane.
  assert.equal(
    resolveBackgroundTasksSessionId(bgArgs({
      focusedPaneId: NEW_SESSION_TAB_ID,
      lastSessionPaneId: "s-closed",
      paneTabs: tabs,
    })),
    "s1",
  );
  // Only the sentinel exists and nothing else: unavailable (null) is honest.
  assert.equal(
    resolveBackgroundTasksSessionId(bgArgs({
      focusedPaneId: NEW_SESSION_TAB_ID,
      paneTabs: [tabs[1]],
    })),
    null,
  );
  // Sentinel focused, no open session panes, but a selected session exists
  // (classic fallback): follow it rather than showing unavailable.
  assert.equal(
    resolveBackgroundTasksSessionId(bgArgs({
      focusedPaneId: NEW_SESSION_TAB_ID,
      selectedSessionId: "s9",
      paneTabs: [tabs[1]],
    })),
    "s9",
  );
});
