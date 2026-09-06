import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { getSessionListIndices, getVariableSessionListIndices } = await jiti.import("./SessionSidebar.tsx");

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("scrolling keeps the focused session and the viewport mounted without expanding the whole window", () => {
  for (const [scrollTop, focusedIndex] of [[0, 1999], [10000, 0]]) {
    const indices = getSessionListIndices(2000, scrollTop, 335, focusedIndex);
    const firstVisible = Math.floor(scrollTop / 54);
    const lastVisible = Math.ceil((scrollTop + 335) / 54) - 1;
    for (let index = firstVisible; index <= lastVisible; index++) assert.ok(indices.includes(index));
    assert.ok(indices.includes(focusedIndex));
    assert.equal(indices.length, 24);
    assert.equal(new Set(indices).size, indices.length);
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  }
  assert.equal(getSessionListIndices(2000, 0, 335, 3).length, 23);
  const blurred = getSessionListIndices(2000, 10000, 335);
  assert.equal(blurred.length, 23);
  assert.ok(!blurred.includes(0));
});

test("session windows stay valid after a project shrinks and before the viewport is measured", () => {
  assert.deepEqual(getSessionListIndices(5, 80000, 335, 1999), [0, 1, 2, 3, 4]);
  assert.deepEqual(getSessionListIndices(0, 80000, 335, 1999), []);
  assert.equal(getSessionListIndices(2000, 0, 0).length, 28);
});

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("persists recursive session-tree collapse state outside unmounted rows", () => {
  const treeItemSource = source.slice(
    source.indexOf("function SessionTreeItem("),
    source.indexOf("function RunningSessionIndicator"),
  );
  assert.match(source, /setCollapsedSessionIds\(loadCollapsedSessionIds\(\)\)/);
  assert.match(source, /saveCollapsedSessionIds\(next\)/);
  assert.match(treeItemSource, /collapsedSessionIds\.has\(node\.session\.id\)/);
  assert.match(treeItemSource, /onCollapseChange\(node\.session\.id, !collapsed\)/);
  assert.doesNotMatch(treeItemSource, /useState\(false\)/);
});

test("uses the full pinned card as the drag surface with visible motion feedback", () => {
  assert.match(sessionItemSource, /const canDragPinned = isPinned && depth === 0/);
  assert.match(sessionItemSource, /draggable=\{canDragPinned\}/);
  assert.match(sessionItemSource, /onDragStart=\{canDragPinned \? handlePinnedDragStart : undefined\}/);
  assert.doesNotMatch(sessionItemSource, /<button[\s\S]{0,200}?draggable/);
  assert.match(source, /translateY\(-2px\) scale\(1\.015\)/);
  assert.match(source, /transition: "transform 140ms ease, box-shadow 140ms ease, background 140ms ease"/);
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("exposes the polled running-session set to the shell", () => {
  assert.match(source, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("exposes the loaded session catalog to the shell", () => {
  assert.match(source, /onSessionsChange\?: \(sessions: SessionInfo\[\]\) => void/);
  assert.match(source, /onSessionsChange\?\.\(allSessions\)/);
});

test("subagent completion stays silent and never becomes unread", () => {
  assert.match(source, /completionNotificationSuppressedSessionIds\?: string\[\]/);
  assert.match(
    source,
    /completedWithNotifications = completedInBackground\.filter\([\s\S]*?!previousSuppressedCompletionSessionIdsRef\.current\.has\(id\)[\s\S]*?!knownSubagentIds\.has\(id\)/,
  );
  assert.match(source, /completedWithNotifications\.forEach\(\(id\) => next\.add\(id\)\)/);
  assert.match(source, /if \(completedWithNotifications\.length > 0\) \{\s*onBackgroundTaskDone\?\.\(\)/);
  assert.match(
    source,
    /filter\(\(session\) => session\.relation\?\.kind !== "subagent"\)[\s\S]*?unreadEligibleIds\.has\(id\)/,
  );
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("summarizes running and completed activity across every project", () => {
  assert.match(source, /const workspaceActivity = useMemo\(\(\) => \{/);
  assert.match(source, /for \(const activity of projectActivity\.values\(\)\)/);
  assert.match(source, /<WorkspaceActivitySummary activity=\{workspaceActivity\} \/>/);
  assert.match(source, /sidebar\.backgroundSessionRunning/);
  assert.match(source, /sidebar\.backgroundSessionComplete/);
});

test("formats session timestamps with the active locale", () => {
  assert.match(source, /import \{ formatRelativeTime \} from "@\/lib\/i18n\/format"/);
  assert.match(sessionItemSource, /const \{ locale, t \} = useI18n\(\)/);
  assert.match(sessionItemSource, /formatRelativeTime\(session\.modified, locale\)/);
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});

test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItemSource, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItemSource,
    /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});

test("only manual refresh bypasses the server session-list cache", () => {
  assert.match(source, /force \? "\/api\/sessions\?force=1" : "\/api\/sessions"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /void loadSessions\(isFirst, false\)/);
  assert.match(source, /onClick=\{\(\) => void loadSessions\(false, true\)\}/);
  assert.match(source, /loadSessions\(false, false\);[\s\S]*?onBackgroundTaskDone/);
});

test("manual refresh has priority over background loads and visible completion feedback", () => {
  const loadBlock = source.slice(
    source.indexOf("const loadSessions = useCallback"),
    source.indexOf("const sessionRefreshEffectRef"),
  );
  assert.match(loadBlock, /if \(!force && manualRefreshRequestRef\.current !== null\) return/);
  assert.match(loadBlock, /manualRefreshRequestRef\.current = requestId/);
  assert.match(loadBlock, /setManualRefreshStatus\(succeeded \? "done" : "idle"\)/);
  assert.match(source, /disabled=\{manualRefreshStatus === "loading"\}/);
  assert.match(source, /aria-busy=\{manualRefreshStatus === "loading"\}/);
  assert.match(source, /manualRefreshStatus === "done"/);
});

test("Strict Effects replay does not issue a second session-list request", () => {
  const effectStart = source.indexOf("const sessionRefreshEffectRef = useRef");
  const effectEnd = source.indexOf("// Browser storage is unavailable", effectStart);
  const effect = source.slice(effectStart, effectEnd);
  assert.match(effect, /effect\.initialized && Object\.is\(effect\.refreshKey, refreshKey\)/);
  assert.match(effect, /void loadSessions\(isFirst, false\)/);

  const state = { initialized: false, refreshKey: undefined };
  const calls = [];
  for (const refreshKey of [undefined, undefined]) {
    if (state.initialized && Object.is(state.refreshKey, refreshKey)) continue;
    const isFirst = !state.initialized;
    state.initialized = true;
    state.refreshKey = refreshKey;
    calls.push({ showLoading: isFirst, force: false });
  }
  assert.deepEqual(calls, [{ showLoading: true, force: false }]);
});

test("session-list requests abort predecessors and ignore stale responses", () => {
  assert.match(source, /sessionListControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /if \(requestId !== sessionListRequestRef\.current\) return/);
  assert.match(source, /name !== "AbortError"/);
});

test("a replacement refresh always clears initial loading state", () => {
  const loadBlock = source.slice(
    source.indexOf("const loadSessions = useCallback"),
    source.indexOf("const sessionRefreshEffectRef"),
  );
  assert.match(loadBlock, /if \(requestId === sessionListRequestRef\.current\) \{[\s\S]*setLoading\(false\)/);
  assert.doesNotMatch(loadBlock, /if \(showLoading\) setLoading\(false\)/);
});

test("cross-window version polling reuses the invalidated cache", () => {
  assert.match(source, /data\.sessionListVersion !== sessionListVersionRef\.current[\s\S]*?await loadSessions\(\)/);
  assert.doesNotMatch(source, /sessionRefreshDone|sessionRefreshTimerRef/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  assert.match(sessionItemSource, /\{hovered && !session\.transient && \(/);
});

test("hides subagent rows, aggregates their state, and preserves the visible fork tree", () => {
  assert.match(source, /const families = listSessionFamilies\(sessions\)/);
  assert.match(source, /familySelected = node\.familySessions\.some\(\(session\) => session\.id === selectedSessionId\)/);
  assert.match(source, /familyRunning = node\.familySessions\.some\(\(session\) => runningSessionIds\.has\(session\.id\)\)/);
  assert.match(source, /function SessionTreeItem/);
  assert.match(source, /node\.children\.map\(\(child\)/);
});

test("virtualizes variable-height root subtrees while retaining focused or dragged roots", () => {
  const layouts = [
    { top: 0, height: 54 },
    { top: 54, height: 540 },
    { top: 594, height: 108 },
    { top: 702, height: 54 },
    { top: 756, height: 54 },
    { top: 810, height: 54 },
    { top: 864, height: 54 },
    { top: 918, height: 54 },
    { top: 972, height: 54 },
    { top: 1026, height: 54 },
    { top: 1080, height: 54 },
    { top: 1134, height: 54 },
    { top: 1188, height: 54 },
  ];
  const visible = getVariableSessionListIndices(layouts, 1080, 54, [0]);
  assert.ok(visible.includes(0), "forced root remains mounted");
  assert.ok(visible.includes(10));
  assert.ok(visible.includes(11));
  assert.ok(!visible.includes(1), "distant variable-height subtree stays unmounted");
  assert.deepEqual(visible, [...visible].sort((a, b) => a - b));
  assert.match(source, /visibleSessionTreeRows\(node, collapsedSessionIds\) \* SESSION_LIST_ITEM_HEIGHT/);
  assert.match(source, /getVariableSessionListIndices\([\s\S]*?forcedLayoutIndices/);
});
