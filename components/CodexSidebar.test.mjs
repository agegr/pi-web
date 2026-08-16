import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { filterProjectSessions } = await jiti.import("../lib/codex-sidebar-search.ts");

const sidebar = await readFile(new URL("./CodexSidebar.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("./SettingsPage.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("AppShell renders the Codex project sidebar instead of the legacy sidebar", () => {
  assert.match(shell, /import \{ CodexSidebar \} from "\.\/CodexSidebar"/);
  assert.match(shell, /<CodexSidebar/);
  assert.doesNotMatch(shell, /<SessionSidebar/);
});

test("brand header keeps refresh separate from workspace controls", () => {
  assert.match(sidebar, /onToggleSidebar\?: \(\) => void/);
  assert.match(sidebar, /codex-sidebar-brand-header[\s\S]*?codex-sidebar-brand[\s\S]*?sidebar\.refresh[\s\S]*?codex-sidebar-new-task/);
  assert.match(sidebar, /codex-sidebar-workspace-actions[\s\S]*?sidebar\.searchProjects[\s\S]*?sidebar\.addProject[\s\S]*?sidebar\.hide/);
  assert.match(styles, /\.codex-sidebar-icon-button\s*\{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px;/);
  assert.match(shell, /<CodexSidebar[\s\S]*?onToggleSidebar=\{handleSidebarToggle\}/);
});

test("new task keeps its shortcut accessible without a visible key hint", () => {
  assert.match(sidebar, /aria-keyshortcuts="Control\+Alt\+N"/);
  assert.match(sidebar, /title=\{`\$\{t\("sidebar\.newTask"\)\} \(Ctrl\+Alt\+N\)`\}/);
  assert.doesNotMatch(sidebar, /<kbd>⌃⌥N<\/kbd>/);
});

test("keeps the search field compact until requested", () => {
  assert.match(styles, /\.codex-sidebar-search-wrap\s*\{[\s\S]*?height:\s*32px;[\s\S]*?margin:\s*0 10px 5px;[\s\S]*?flex-shrink:\s*0;/);
  assert.match(styles, /\.codex-sidebar-new-task\s*\{[\s\S]*?height:\s*30px;[\s\S]*?background: var\(--bg-panel\);/);
  assert.match(sidebar, /projectSearchOpen && \(/);
  assert.doesNotMatch(styles, /\.codex-sidebar-search-shortcut/);
  assert.doesNotMatch(sidebar, /<kbd>⌘K<\/kbd>/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.codex-sidebar-search-wrap\s*\{[\s\S]*?height:\s*40px;/);
});

test("project management exposes persistence-backed full actions", () => {
  assert.match(sidebar, /fetch\("\/api\/projects"/);
  assert.match(sidebar, /method: "PATCH"/);
  assert.match(sidebar, /\{ path, update: serializedUpdate \}/);
  assert.match(sidebar, /\{ order: next\.map\(\(project\) => project\.path\) \}/);
  for (const action of ["pin", "moveUp", "moveDown", "renameProject", "archiveProject", "removeProject"]) {
    assert.match(sidebar, new RegExp(`sidebar\\.${action}`));
  }
  assert.match(settings, /sidebar\.restoreProject/);
  assert.doesNotMatch(sidebar, /setShowArchived/);
});

test("project sorting supports drag and keyboard-accessible menu actions", () => {
  assert.match(sidebar, /draggable=\{!renamingProject\}/);
  assert.match(sidebar, /onDrop=\{\(\) => reorderProject\(project\.path\)\}/);
  assert.match(sidebar, /role="menuitem"/);
  assert.match(sidebar, /event\.key !== "Enter" && event\.key !== " "/);
});

test("session delete skips the confirmation dialog and reports errors inline", () => {
  assert.doesNotMatch(sidebar, /deleteConfirmationOpen/);
  assert.match(sidebar, /setDeleteError\(null\); void remove\(\)/);
  assert.match(sidebar, /className="codex-row-error"/);
  assert.match(sidebar, /role="alert"/);
  assert.match(styles, /\.codex-row-error \{[^}]*color: var\(--danger\)|#ef4444|rgba\(239,68,68/);
});

test("keeps the file explorer out of the project sidebar", () => {
  assert.doesNotMatch(sidebar, /<FileExplorer/);
  assert.doesNotMatch(sidebar, /files\.explorer/);
  assert.doesNotMatch(sidebar, /saveExplorerOpen/);
});

test("settings footer is a gear with a label", () => {
  assert.match(shell, /className="codex-sidebar-footer-item"/);
  assert.match(shell, /<Settings size=\{14\}/);
  assert.match(shell, /codex-sidebar-footer-item-label"[^>]*>\{translate\("common\.settings"\)\}<\/span>/);
  assert.match(styles, /\.codex-sidebar-footer-item \{[\s\S]*?width: 100%/);
});

test("sidebar header restores restrained branding above the compact workspace toolbar", () => {
  assert.match(sidebar, /className="codex-sidebar-brand-header"/);
  assert.match(sidebar, /className="codex-sidebar-brand">Pi Web<\/div>/);
  assert.match(sidebar, /<RefreshCw size=\{14\}/);
  assert.match(sidebar, /className="codex-sidebar-new-task"/);
  assert.match(sidebar, /className="codex-sidebar-workspace-toolbar"/);
  assert.match(sidebar, /className="codex-sidebar-search-trigger"/);
  assert.match(styles, /\.codex-sidebar-brand-header \{[\s\S]*?height:\s*40px;/);
  assert.match(styles, /\.codex-sidebar-new-task \{[\s\S]*?background: var\(--bg-panel\)/);
});

test("running projects expose a Codex-style activity spinner", () => {
  assert.match(sidebar, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(sidebar, /const completed = \[\.\.\.previous\]\.filter\(\(id\) => !activeRootIds\.has\(id\)\)/);
  assert.match(sidebar, /const completedInBackground = completed\.filter\(\(id\) => id !== selectedSessionId\)/);
  assert.match(sidebar, /runningCount > 0/);
  assert.match(sidebar, /className="codex-project-running"/);
  assert.match(sidebar, /<LoaderCircle size=\{12\}/);
  assert.match(sidebar, /className="codex-session-running"/);
  assert.match(sidebar, /style=\{\{ animation: "spin 0\.8s linear infinite"/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*?animation: spin 2\.4s linear infinite !important/);
  assert.match(sidebar, /role="status"/);
});

test("preserves desktop session context menus and styled dirty-worktree confirmation", () => {
  assert.match(sidebar, /dispatchSessionRowContextMenu\(\{/);
  assert.match(sidebar, /setPendingConfirmation\(\{ type: "worktree", path \}\)/);
  assert.match(sidebar, /<DialogShell[\s\S]*?sidebar\.forceRemoveCheckout/);
  assert.match(sidebar, /removeWorktree\(path, true\)/);
  assert.doesNotMatch(sidebar, /window\.confirm/);
});

test("session overflow menu portals, dismisses, and archives locally", () => {
  assert.match(sidebar, /readArchivedSessionIds\(\)/);
  assert.match(sidebar, /!archivedIds\.has\(session\.id\)/);
  assert.match(sidebar, /sidebar\.archiveSession/);
  assert.match(sidebar, /codex-project-menu-portal/);
  assert.match(sidebar, /document\.addEventListener\("mousedown", onPointerDown\)/);
  assert.match(sidebar, /document\.addEventListener\("keydown", onKeyDown, true\)/);
  assert.match(settings, /sidebar\.restoreSession/);
  assert.match(settings, /writeArchivedSessionIds\(next\)/);
});

test("desktop sidebar exposes new task, projects, and recent sessions", () => {
  assert.match(sidebar, /className="codex-sidebar-new-task"/);
  assert.match(sidebar, /sidebar\.newTask/);
  assert.match(sidebar, /sidebar\.projects/);
  assert.match(sidebar, /sidebar\.recent/);
  assert.match(sidebar, /buildRecentSessions\(visibleSessions, activeProjects, archivedIds\)/);
  assert.match(sidebar, /recentSessions\.map/);
});

test("project rows expand to list their sessions", () => {
  assert.match(sidebar, /const matchingSessions = filterProjectSessions\(project, filterQuery\)/);
  assert.match(sidebar, /className="codex-project-sessions"/);
  assert.match(sidebar, /matchingSessions\.map/);
  assert.match(sidebar, /<Chevron open=\{open\} \/>/);
});

test("recent session rows preserve activity, selection, and session management", () => {
  assert.match(sidebar, /<SessionRow[\s\S]*?variant="recent"/);
  assert.match(sidebar, /projectLabel=\{projectLabel\}/);
  assert.match(sidebar, /relativeTime=\{formatRelativeTime\(session\.modified, locale\)\}/);
  assert.match(sidebar, /data-selected=\{selected\}/);
  assert.match(sidebar, /dispatchSessionRowContextMenu/);
  assert.match(sidebar, /sidebar\.archiveSession/);
  assert.match(sidebar, /method: "DELETE"/);
  assert.match(sidebar, /setRecentOpen\(\(open\) => !open\)/);
  assert.match(sidebar, /aria-expanded=\{recentOpen\}/);
});

test("sidebar buttons inherit family only so Recent matches Projects type", () => {
  assert.match(styles, /\.codex-sidebar button,\s*\n\.codex-sidebar input \{\s*\n  font-family: inherit;/);
  assert.doesNotMatch(styles, /\.codex-sidebar button,\s*\n\.codex-sidebar input \{[^}]*font:\s*inherit/);
  assert.match(styles, /\.codex-sidebar-workspace-title \{[\s\S]*?font-size: var\(--text-meta\)/);
  assert.match(styles, /\.codex-sidebar-tool-heading \{[\s\S]*?font-size: var\(--text-meta\)/);
});

test("sidebar recomposition preserves worktree switching and creation", () => {
  assert.match(sidebar, /className="codex-worktree-block"/);
  assert.match(sidebar, /\/api\/worktrees/);
  assert.match(sidebar, /createWorktree/);
  assert.match(sidebar, /removeWorktree/);
  assert.match(sidebar, /sidebar\.forceRemoveCheckout/);
});

test("searches sessions and exposes a Codex-style quick switcher", () => {
  assert.match(sidebar, /function sessionTitle\(session: SessionInfo\)/);
  assert.match(sidebar, /visibleSessions\.filter\(\(session\) =>/);
  assert.match(sidebar, /<dialog/);
  assert.match(sidebar, /showModal\(\)/);
  assert.match(sidebar, /event\.key === "k"[\s\S]*?metaKey|event\.key === "k"[\s\S]*?ctrlKey/);
  assert.match(sidebar, /ArrowDown/);
  assert.match(sidebar, /ArrowUp/);
  assert.match(sidebar, /sidebar\.quickSwitcher/);
});

test("project search keeps all sessions while session-only search narrows the rows", () => {
  const project = {
    path: "/work/pi-web",
    pinned: false,
    archived: false,
    removed: false,
    order: 0,
    latestModified: "2026-08-13T00:00:00Z",
    sessions: [
      { id: "one", cwd: "/work/pi-web", firstMessage: "Fix sidebar navigation", modified: "2026-08-13T00:00:00Z" },
      { id: "two", cwd: "/work/pi-web", firstMessage: "Improve model settings", modified: "2026-08-12T00:00:00Z" },
    ],
  };

  assert.equal(filterProjectSessions(project, "pi-web")?.length, 2);
  assert.deepEqual(filterProjectSessions(project, "model")?.map((session) => session.id), ["two"]);
  assert.equal(filterProjectSessions(project, "missing"), null);
  assert.equal(filterProjectSessions({ ...project, archived: true }, "pi-web"), null);
});

test("automatic inventory refreshes are unforced and coalesced", () => {
  assert.match(sidebar, /useEffect\(\(\) => \{ void loadData\(false\); \}, \[loadData, refreshKey\]\)/);
  assert.doesNotMatch(sidebar, /loadData\(refreshKey !== undefined\)/);
  assert.match(sidebar, /loadDataInFlightRef = useRef<Promise<void> \| null>\(null\)/);
  assert.match(sidebar, /loadDataQueuedRef\.current = true/);
  assert.match(sidebar, /while \(loadDataQueuedRef\.current\)/);

  const forcedCalls = sidebar.match(/loadData\(true\)/g) ?? [];
  assert.equal(forcedCalls.length, 1, "only the manual refresh button may force a scan");
  assert.match(sidebar, /sidebar\.refresh[^]*?onClick=\{\(\) => void loadData\(true\)\}/);
});

test("initial running ids establish a baseline without a second inventory request", () => {
  assert.match(sidebar, /previousRunningRef = useRef<Set<string> \| null>\(null\)/);
  assert.match(sidebar, /previousRawRunningRef = useRef<Set<string> \| null>\(null\)/);
  assert.match(sidebar, /if \(previous === null\) \{[\s\S]*?previousRunningRef\.current = activeRootIds;[\s\S]*?return;/);
  assert.match(sidebar, /if \(previous === null\) \{[\s\S]*?previousRawRunningRef\.current = runningIds;[\s\S]*?return;/);
});

test("settings stays outside the initial AppShell module graph", () => {
  assert.doesNotMatch(shell, /import \{ SettingsPage \} from "\.\/SettingsPage"/);
  assert.match(shell, /lazy\(\(\) => import\("\.\/SettingsPage"\)/);
  assert.match(shell, /settingsOpen && \([\s\S]*?<Suspense/);
});
