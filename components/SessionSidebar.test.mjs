import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionActionsSource = source.slice(source.indexOf("function useSessionActions"), source.indexOf("function GlobalHistoryItem"));
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionActionsSource,
    /const handleDeleteClick[\s\S]*?if \(event\.shiftKey\) void performDelete\(\);\s*else setConfirmDelete\(true\);/,
  );
});

test("session rows are keyboard navigable without stealing action shortcuts", () => {
  assert.match(sessionItemSource, /role="button"/);
  assert.match(sessionItemSource, /tabIndex=\{confirmDelete \|\| renaming \? -1 : 0\}/);
  assert.match(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.match(sessionItemSource, /aria-current=\{isSelected \? "true" : undefined\}/);
  assert.match(sessionItemSource, /event\.target !== event\.currentTarget/);
});

test("fork controls expose expanded state and management actions stay keyboard reachable", () => {
  assert.match(sessionItemSource, /aria-expanded=\{!collapsed\}/);
  assert.match(sessionItemSource, /aria-label=\{collapsed \? t\("sidebar\.expandForks"\) : t\("sidebar\.collapseForks"\)\}/);
  assert.match(sessionItemSource, /className="session-item-actions"/);
  assert.match(sessionItemSource, /aria-label=\{t\("sidebar\.rename"\)\}/);
  assert.match(sessionItemSource, /aria-label=\{t\("sidebar\.delete"\)\}/);
});

test("mobile drawer has modal semantics and restores keyboard focus", async () => {
  const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(appShellSource, /aria-expanded=\{sidebarOpen\}/);
  assert.match(appShellSource, /role=\{isMobile && sidebarOpen \? "dialog" : undefined\}/);
  assert.match(appShellSource, /aria-modal=\{isMobile && sidebarOpen \? "true" : undefined\}/);
  assert.match(appShellSource, /aria-hidden=\{isMobile && !sidebarOpen \? "true" : undefined\}/);
  assert.match(appShellSource, /focus\(\{ preventScroll: true \}\)/);
  assert.match(appShellSource, /\[role="button"\]:not\(\[tabindex="-1"\]\)/);
  assert.match(appShellSource, /onCloseSidebar=\{\(\) => closeMobileSidebar\(true\)\}/);
  assert.match(source, /className="mobile-sidebar-close"/);
});

test("file explorer collapse is announced to assistive technology", () => {
  assert.match(source, /aria-expanded=\{explorerOpen\}/);
  assert.match(source, /aria-controls="file-explorer-content"/);
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

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
test("defaults to workspace and exposes a non-URL scope tablist", () => {
  assert.match(source, /useState<"workspace" \\| "global">\("workspace"\)/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /data-navigation-scope="global"/);
  assert.match(source, /globalPlaceholder/);
});

test("global scope renders an independently scrollable running section", () => {
  assert.match(source, /function GlobalRunningSessions\(/);
  assert.match(source, /data-global-running-section="true"/);
  assert.match(source, /data-global-running-list="true"/);
  assert.match(source, /flex: open \? "1 1 0" : "0 0 auto"/);
  assert.match(source, /maxHeight: open \? "none" : "min\(38vh, 360px\)"/);
  assert.match(source, /sessions=\{globalRunningSessions\}/);
  assert.match(source, /searchQuery=\{globalSearchQuery\}/);
  assert.match(source, /onSelect=\{handleSelectRunningSession\}/);
  assert.match(source, /onOpenChange=\{handleGlobalRunningOpenChange\}/);
});

test("global running and history sections behave as an accordion", () => {
  assert.match(source, /const \[globalRunningOpen, setGlobalRunningOpen\] = useState\(false\)/);
  assert.match(source, /const \[globalHistoryOpen, setGlobalHistoryOpen\] = useState\(true\)/);
  assert.match(source, /setGlobalHistoryOpen\(false\)/);
  assert.match(source, /setGlobalRunningOpen\(false\)/);
  assert.match(source, /onOpenChange=\{handleGlobalHistoryOpenChange\}/);
});

test("global history is a separate recent, scrollable section", () => {
  assert.match(source, /function GlobalHistorySessions\(/);
  assert.match(source, /buildGlobalHistoryCandidates\(allSessions, runningSessionIds\)/);
  assert.match(source, /data-global-history-section="true"/);
  assert.match(source, /data-global-history-list="true"/);
  assert.match(source, /data-history-session-id=\{session\.id\}/);
  assert.match(source, /session\.projectRoot/);
  assert.match(source, /session\.modified/);
  assert.match(source, /sidebar\.messagesCount/);
  assert.match(source, /onRenamed=\{\(\) => void loadSessions\(false\)\}/);
  assert.match(source, /onDeleted=\{\(id\) =>/);
});

test("global search covers full history and supports incremental earlier loading", () => {
  assert.match(source, /data-global-search="true"/);
  assert.match(source, /matchesGlobalSessionQuery\(session, globalSearchQuery\)/);
  assert.match(source, /globalSearchQuery\s*\?\s*globalHistoryMatches/);
  assert.match(source, /data-global-history-load-more="true"/);
  assert.match(source, /setGlobalHistoryVisibleCount\(\(count\) => count \+ GLOBAL_HISTORY_LIMIT\)/);
  assert.match(source, /data-global-running-no-match="true"/);
  assert.match(source, /data-global-history-no-match="true"/);
  assert.match(source, /sidebar\.noRunning/);
  assert.match(source, /sidebar\.noHistory/);
});

test("running snapshots retain the last known rows when polling fails", () => {
  assert.match(source, /setRunningSessions\(snapshot\)/);
  assert.match(source, /Keep the last known snapshot/);
  assert.match(source, /setRunningError\(/);
  assert.match(source, /runningRetryKey/);
});

test("completed running sessions are promoted into history immediately", () => {
  assert.match(source, /runningSnapshotToSessionInfo\(/);
  assert.match(source, /completedSessionFallbacksRef/);
  assert.match(source, /lastKnownRunningSessionsRef/);
  assert.match(source, /completedInBackground/);
  assert.match(source, /setAllSessions\(/);
});

test("partial running snapshots preserve status and render an unknown fallback", () => {
  assert.match(source, /mergeRunningSessionSnapshots\(/);
  assert.match(source, /runningStatusUnknown/);
  assert.match(source, /historyError/);
});

test("unavailable historical cwds keep the session and mark the explorer unavailable", () => {
  assert.match(source, /cwdAvailable/);
  assert.match(source, /files\.unavailable/);
  assert.match(source, /selectedCwdAvailable/);
});

test("switching sessions does not abort the previous background run", () => {
  const cleanup = source.slice(source.indexOf("const handleSelectSessionFromList"), source.indexOf("const handleNewSession"));
  assert.doesNotMatch(cleanup, /abort/);
});

test("keeps new-session creation lazy and scoped to workspace", async () => {
  assert.doesNotMatch(source, /crypto\.randomUUID\(\)/);
  const workspaceSource = source.slice(
    source.indexOf('{navigationScope === "workspace" ?'),
    source.indexOf('{navigationScope === "global" &&'),
  );
  assert.match(workspaceSource, /onClick=\{handleNewSession\}/);
  const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(chatWindowSource, /draftKey=\{session\?\.id \?\? \(newSessionCwd \? `new:\$\{newSessionCwd\}` : undefined\)\}/);
});
