import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

// Importing the module is a parse smoke test; the windowing semantics moved
// to the pure row model and are covered by lib/sidebar-rows.test.mjs.
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
await jiti.import("./SessionSidebar.tsx");

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const globalStyles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("the session list windows through the unified pinned-group row model", () => {
  assert.match(source, /import \{[\s\S]*buildSidebarRows[\s\S]*\} from "@\/lib\/sidebar-rows";/);
  assert.match(source, /buildSidebarRows\(\{[\s\S]*?expandedKeys: expandedGroupKeys,[\s\S]*?mainFamilies,[\s\S]*?\}\)/);
  assert.match(source, /getWindowedRows\(sidebarRows, listScrollTop, listViewportH, focusedSessionId\)/);
  assert.match(source, /height: sidebarRowsHeight\(sidebarRows\)/);
  // The old fixed-height windowing helper is gone.
  assert.doesNotMatch(source, /getSessionListIndices/);
  // Sessions of pinned projects render only inside their group.
  assert.match(source, /filteredSessions\.filter\(\(session\) => !pinnedKeySet\.has\(workspaceKeyOf\(session\)\)\)/);
});

test("pinned groups are expandable buttons with their own new-session affordance", () => {
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /aria-controls=\{pinnedGroupContentId\(project\.key\)\}/);
  assert.match(source, /t\(expanded \? "sidebar\.pinnedGroupCollapse" : "sidebar\.pinnedGroupExpand", \{ path: project\.root \}\)/);
  assert.match(source, /t\("sidebar\.newSessionTitle", \{ path: project\.root \}\)/);
  assert.match(source, /t\("sidebar\.pinnedGroupNoSessions"\)/);
  // Group [+] reuses the temp-id flow and moves the effective cwd.
  assert.match(source, /const handleNewSessionInProject = useCallback\(\(project: SidebarProject\) => \{[\s\S]*?setSelectedCwd\(project\.root\);[\s\S]*?onNewSession\?\.\(newTempSessionId\(\), project\.root\);/);
  // Group [+] also expands its group so the new session's row is visible
  // (spec R2) — accordion-style, through the shared single-key helper.
  assert.match(
    source,
    /const handleNewSessionInProject = useCallback\(\(project: SidebarProject\) => \{[\s\S]*?expandPinnedGroup\(project\.key\);[\s\S]*?onNewSession\?\.\(newTempSessionId\(\), project\.root\);/,
  );
  // Stale roots disable [+] instead of auto-unpinning.
  assert.match(source, /if \(stalePinnedRoots\.has\(project\.root\)\) return;/);
});

test("pinned-group expansion state persists to localStorage across reloads", () => {
  // Initial state is hydration-safe (empty) and restored after mount.
  assert.match(source, /useState<ReadonlySet<string>>\(\(\) => new Set\(\)\)/);
  assert.match(source, /setSidebarHydrated\(true\);[\s\S]*?setExpandedGroupKeys\(readExpandedGroupKeys\(\)\);/);
  // Pinned groups render only after hydration so SSR and first client render agree.
  assert.match(source, /\(sidebarHydrated \? getPinnedProjects\(\) : \[\]\)/);
  // Toggling writes the full new state back — collapse deletes just the
  // toggled key; expand goes through the accordion helper below.
  assert.match(
    source,
    /const handleToggleGroup = useCallback\(\(key: string\) => \{[\s\S]*?next\.delete\(key\);[\s\S]*?writeExpandedGroupKeys\(next\);[\s\S]*?expandPinnedGroup\(key\);/,
  );
  // The storage key and reader exist with the graceful-degradation shape.
  assert.match(source, /const PINNED_EXPANDED_STORAGE_KEY = "pi-web:sidebar-pinned-expanded";/);
  assert.match(source, /function readExpandedGroupKeys\(\): ReadonlySet<string> \{/);
  assert.match(source, /parsed\.filter\(\(key\): key is string => typeof key === "string"\)/);
  // The accordion helper persists the single-key set through the same
  // writer, so the stored value always describes the one expanded group.
  assert.match(
    source,
    /const expandPinnedGroup = useCallback\(\(key: string\) => \{[\s\S]*?writeExpandedGroupKeys\(next\);[\s\S]*?\}, \[\]\);/,
  );
});

test("expanding a pinned group collapses every other pinned group (accordion)", () => {
  const toggleBlock = source.slice(
    source.indexOf("const handleToggleGroup"),
    source.indexOf("const handleNewSessionInProject"),
  );
  // Expand replaces the whole set with the one key — it never merges with the
  // previous state, so repeated toggles keep at most one group expanded.
  assert.match(
    source,
    /const expandPinnedGroup = useCallback\(\(key: string\) => \{\s*\n\s*const next = new Set\(\[key\]\);/,
  );
  assert.match(toggleBlock, /\}\s*\n\s*expandPinnedGroup\(key\);/);
  assert.doesNotMatch(toggleBlock, /next\.add\(key\)/);
  assert.doesNotMatch(toggleBlock, /new Set\(\[\.\.\.previous/);
});

test("collapsing a pinned group is independent", () => {
  const toggleBlock = source.slice(
    source.indexOf("const handleToggleGroup"),
    source.indexOf("const handleNewSessionInProject"),
  );
  // The collapse branch removes only the toggled key, persists the result,
  // and returns before the expand path can touch any other group.
  assert.match(
    toggleBlock,
    /if \(expandedGroupKeys\.has\(key\)\) \{[\s\S]*?next = new Set\(expandedGroupKeys\);[\s\S]*?next\.delete\(key\);[\s\S]*?writeExpandedGroupKeys\(next\);[\s\S]*?return;/,
  );
});

test("the group [+] affordance expands its group accordion-style", () => {
  const newSessionBlock = source.slice(
    source.indexOf("const handleNewSessionInProject"),
    source.indexOf("const recentProjects"),
  );
  assert.match(newSessionBlock, /setSelectedCwd\(project\.root\);[\s\S]*?expandPinnedGroup\(project\.key\);[\s\S]*?onNewSession\?\./);
  // The affordance no longer hand-rolls expansion state.
  assert.doesNotMatch(newSessionBlock, /setExpandedGroupKeys/);
});

test("selecting a session in another pinned group switches the expanded group", () => {
  // Shared helper: resolve the target project, require it to be pinned, then
  // expand accordion-style.
  assert.match(
    source,
    /const expandPinnedGroupForCwd = useCallback\(\(cwd: string \| null\) => \{[\s\S]*?const project = projectFor\(cwd\);[\s\S]*?if \(!project\) return;[\s\S]*?if \(!pinnedKeySet\.has\(project\.key\)\) return;[\s\S]*?expandPinnedGroup\(project\.key\);[\s\S]*?\}, \[projectFor, pinnedKeySet, expandPinnedGroup\]\);/,
  );
  // Session list and session-search selection go through the same handler.
  const selectBlock = source.slice(
    source.indexOf("const handleSelectSessionFromList"),
    source.indexOf("// Toggle one pinned group"),
  );
  assert.match(selectBlock, /expandPinnedGroupForCwd\(s\.cwd\);/);
  // The dropdown row select and the worktree switch route through it too.
  assert.match(source, /expandPinnedGroupForCwd\(project\.root\);/);
  assert.match(source, /expandPinnedGroupForCwd\(wt\.path\);/);
});

test("the selected project's group auto-expands at load, collapsing the persisted group", () => {
  const autoBlock = source.slice(
    source.indexOf("const autoExpandedGroupRef"),
    source.indexOf("const projectActivity"),
  );
  // One-shot guard and pinned-membership check stay intact.
  assert.match(autoBlock, /if \(autoExpandedGroupRef\.current \|\| !selectedProject\) return;/);
  assert.match(autoBlock, /if \(!pinnedKeySet\.has\(selectedProject\.key\)\) return;/);
  // The auto-expand goes through the accordion helper — the persisted set is
  // replaced, so a different persisted group collapses to the selected one.
  assert.match(autoBlock, /autoExpandedGroupRef\.current = true;[\s\S]*?expandPinnedGroup\(selectedProject\.key\);/);
  assert.doesNotMatch(autoBlock, /setExpandedGroupKeys\(\(previous\)/);
  // The dependency-exclusion comment (one-shot semantics) stays.
  assert.match(autoBlock, /expandedGroupKeys is deliberately excluded/);
});

test("legacy multi-open storage needs no migration: it collapses on the first expand", () => {
  // The read path is unchanged: storage is read as-is at mount, so a legacy
  // multi-key array survives load untouched.
  assert.match(source, /return new Set\(parsed\.filter\(\(key\): key is string => typeof key === "string"\)\);/);
  assert.match(source, /setExpandedGroupKeys\(readExpandedGroupKeys\(\)\);/);
  // The accordion helper is the only expand path and it always stores a
  // single-key set; the design note records the no-migration decision.
  assert.match(source, /legacy multi-key storage written by the pre-accordion version/);
});

test("the workspace dropdown no longer renders a pinned section", () => {
  assert.doesNotMatch(source, /\{t\("sidebar\.pinnedProjects"\)\}/);
  // Recent rows still exclude pinned keys and keep their pin toggle.
  assert.match(source, /recentUnpinnedProjects/);
  assert.match(source, /onTogglePin=\{\(\) => togglePin\(project\.key, project\.root\)\}/);
  // The stale-root check now runs at sidebar mount, not on dropdown open.
  assert.doesNotMatch(source, /if \(!dropdownOpen \|\| !pinnedRootsKey\) return;/);
  assert.match(source, /\}, \[pinnedRootsKey\]\);/);
});

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("persists and exposes a vertical session/explorer resize handle", () => {
  assert.match(source, /axis: "vertical"/);
  assert.match(source, /storageKey: "pi-web:sidebar-session-pane-height"/);
  assert.match(source, /Math\.round\(\(paneHeight \+ explorerHeight\) \/ 2\)/);
  assert.match(source, /ref=\{sessionPaneRef\}[\s\S]*?<SessionSearch/);
  assert.match(source, /data-resize-handle="sidebar-sections"/);
  assert.match(source, /sidebar-section-resize-handle/);
  assert.match(globalStyles, /\.sidebar-section-resize-handle:focus-visible::after/);
  assert.doesNotMatch(globalStyles, /\.sidebar-section-resize-handle:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/);
  assert.match(globalStyles, /\.sidebar-section-resize-handle::after[\s\S]*?background: transparent/);
  assert.match(source, /borderTop: "1px solid var\(--border\)"/);
  assert.match(source, /var\(--sidebar-session-pane-height, 320px\)/);
  assert.match(source, /minHeight: explorerOpen \? EXPLORER_PANE_MIN_HEIGHT : 0/);
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

test("lifecycle refreshes bypass the cache while cross-window polling reuses it", () => {
  assert.match(source, /force \? "\/api\/sessions\?force=1" : "\/api\/sessions"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /loadSessions\(isFirst, !isFirst\)/);
  assert.match(source, /data\.sessionListVersion !== sessionListVersionRef\.current[\s\S]*?await loadSessions\(\)/);
  // The old timer-based auto-refresh is still forbidden; the manual refresh
  // button and the watcher-driven poll are the intended mechanisms.
  assert.doesNotMatch(source, /sessionRefreshDone|sessionRefreshTimerRef/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("the sidebar header offers a manual forced refresh and pull-to-refresh fires once", () => {
  // Refresh button in the header (all form factors) forces a cache-bypassing scan.
  assert.match(source, /title=\{t\("sidebar\.refresh"\)\}/);
  assert.match(source, /aria-label=\{t\("sidebar\.refresh"\)\}/);
  assert.match(source, /onClick=\{\(\) => \{\s*void loadSessions\(false, true\);\s*\}\}/);
  // Pull-to-refresh on the touch list: armed at the top, fired exactly once
  // per gesture past the 64px threshold, disarmed on release.
  assert.match(source, /if \(!el \|\| el\.scrollTop > 0\) return;[\s\S]*?pullFiredRef\.current = false;/);
  assert.match(source, /if \(startY == null \|\| pullFiredRef\.current\) return;/);
  assert.match(source, /if \(deltaY > 64\) \{\s*pullFiredRef\.current = true;\s*void loadSessions\(false, true\);\s*\}/);
});

test("a rising external-write generation on the selected session notifies the app", () => {
  // The poll payload is consumed only for the selected session's write entry.
  assert.match(source, /recentSessionWrites\?: \{ sessionId\?: string; path: string; generation: number \}\[\]/);
  assert.match(source, /write\.sessionId !== undefined && write\.sessionId === selectedId/);
  // First observation of a session only baselines its generation; only a
  // strictly rising generation for the same selected session notifies.
  assert.match(
    source,
    /if \(\s*previous\s*&& previous\.sessionId === selectedId\s*&& selectedWrite\.generation > previous\.generation\s*\) \{[\s\S]*?onExternalSessionChangeRef\.current\?\.\(selectedId\);/,
  );
  assert.match(source, /selectedWriteGenerationRef\.current = \{[\s\S]*?sessionId: selectedId,\s*generation: selectedWrite\.generation,/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  assert.match(sessionItemSource, /\{hovered && !session\.transient && \(/);
});

test("hides subagent rows and aggregates their state into the main session row", () => {
  assert.match(source, /listSessionFamilies\(\s*filteredSessions\.filter\(\(session\) => !pinnedKeySet\.has\(workspaceKeyOf\(session\)\)\)/);
  assert.match(source, /familySessions\.some\(\(session\) => session\.id === selectedSessionId\)/);
  assert.match(source, /familySessions\.some\(\(session\) => runningSessionIds\.has\(session\.id\)\)/);
  assert.doesNotMatch(source, /function SessionTreeItem/);
});
