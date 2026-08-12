import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
