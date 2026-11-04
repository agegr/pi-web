import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

function handleSessionDeletedBody() {
  const start = source.indexOf("  const handleSessionDeleted = useCallback");
  const end = source.indexOf("  const handleOpenFile = useCallback", start);
  assert.notEqual(start, -1, "handleSessionDeleted callback not found");
  assert.notEqual(end, -1, "handleOpenFile callback not found after handleSessionDeleted");
  return source.slice(start, end);
}

// Runs the actual callback in a vm sandbox. `capturedSelectedSession` models
// the stale state the closure captured at the delete click; `active` is what
// the render-synced ref holds when the DELETE finally completes.
function runHandleSessionDeleted(capturedSelectedSession, active) {
  const state = {
    setSelectedSession: [],
    setNewSessionCwd: [],
    newSessionDraftId: null,
    sessionKey: 0,
    routerReplaced: null,
    refreshBumped: false,
  };
  const context = vm.createContext({
    crypto: globalThis.crypto,
    window: { location: { pathname: "/", search: "" } },
    router: { replace: (url) => { state.routerReplaced = url; } },
    capturedSelectedSession,
    selectedSession: capturedSelectedSession, // the stale closure value, if the code reads it
    selectedSessionRef: { current: active },
    activeNewSessionDraftKeyRef: { current: null },
    invalidateWorkspaceRestore() {},
    clearTabOpenSession() {},
    setRefreshKey: () => { state.refreshBumped = true; },
    setNewSessionDraftId: (id) => { state.newSessionDraftId = id; },
    setSelectedSession: (value) => { state.setSelectedSession.push(value); },
    setNewSessionCwd: (value) => { state.setNewSessionCwd.push(value); },
    setSessionKey: (fn) => { state.sessionKey = fn(state.sessionKey); },
    setBranchTree() {},
    setBranchActiveLeafId() {},
    setBranchSwitchLocked() {},
    setSystemPrompt() {},
    setSystemTools() {},
    setSystemInfoLoading() {},
    setActiveTopPanel() {},
    useCallback: (callback) => callback,
  });
  vm.runInContext(stripTypeScriptTypes(`${handleSessionDeletedBody()}
    handleSessionDeleted("gone-session");
  `), context);
  return state;
}

test("extension end preserves cleanup warnings and closes only its panel", () => {
  assert.match(source, /onSessionEnded=\{handleSessionEnded\}/);
  const start = source.indexOf("  const handleSessionEnded = useCallback");
  const end = source.indexOf("  // The Agents switcher's Delete", start);
  const state = { notices: [], deleted: [], closed: [] };
  const context = vm.createContext({
    useCallback: (callback) => callback,
    setSessionEndNotices: (update) => { state.notices = update(state.notices); },
    handleSessionDeleted: (id) => state.deleted.push(id),
    handleCloseFileTab: (id) => state.closed.push(id),
  });
  vm.runInContext(stripTypeScriptTypes(`${source.slice(start, end)}
    handleSessionEnded("side-session", [{message: "Cleanup failed", type: "warning"}]);
  `), context);
  assert.deepEqual(JSON.parse(JSON.stringify(state.notices)), [{ message: "Cleanup failed", type: "warning" }]);
  assert.deepEqual(state.deleted, ["side-session"]);
  assert.deepEqual(state.closed, ["agent:side-session"]);
  assert.match(source, /sessionEndNotices\.map[\s\S]*?role="alert"/);
});

test("a delete completing after the user navigated away keeps the new chat", () => {
  const deleting = { id: "gone-session", cwd: "/project-a", projectKey: "/project-a" };
  const navigatedTo = { id: "next-session", cwd: "/project-b", projectKey: "/project-b" };
  const state = runHandleSessionDeleted(deleting, navigatedTo);
  assert.equal(state.refreshBumped, true, "sidebar list still refreshes");
  assert.deepEqual(state.setSelectedSession, [], "selection is untouched");
  assert.deepEqual(state.setNewSessionCwd, [], "no empty composer");
  assert.equal(state.newSessionDraftId, null);
  assert.equal(state.sessionKey, 0, "chat does not remount");
  assert.equal(state.routerReplaced, null, "URL does not move");
});

test("a delete completing while the user is still on it falls back to the empty composer", () => {
  const session = { id: "gone-session", cwd: "/project-a", projectKey: "/project-a" };
  const state = runHandleSessionDeleted(session, session);
  assert.equal(state.refreshBumped, true);
  assert.deepEqual(state.setSelectedSession, [null]);
  assert.deepEqual(state.setNewSessionCwd, ["/project-a"]);
  assert.ok(state.newSessionDraftId);
  assert.equal(state.sessionKey, 1, "chat remounts as a fresh composer");
  assert.equal(state.routerReplaced, `?cwd=${encodeURIComponent("/project-a")}`);
});
