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

test("file explorer starts collapsed and remembers explicit toggles", () => {
  assert.match(sidebar, /const \[explorerOpen, setExplorerOpen\] = useState\(false\)/);
  assert.match(sidebar, /setExplorerOpen\(loadExplorerOpen\(\)\)/);
  assert.match(sidebar, /saveExplorerOpen\(next\)/);
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

test("preserves desktop session context menus and dirty-worktree force confirmation", () => {
  assert.match(sidebar, /dispatchSessionRowContextMenu\(\{/);
  assert.match(sidebar, /window\.confirm\(t\("sidebar\.forceRemoveCheckout"\)\)/);
  assert.match(sidebar, /removeWorktree\(path, true\)/);
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
