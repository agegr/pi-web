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

test("the delete callback guards on the render-synced ref, not captured state", () => {
  const body = handleSessionDeletedBody();
  assert.match(body, /const active = selectedSessionRef\.current;/);
  assert.match(body, /if \(active\?\.id === sessionId\)/);
  assert.doesNotMatch(body, /selectedSession\?\.id === sessionId/);
  assert.match(body, /\}, \[invalidateWorkspaceRestore, router\]\);/);
  assert.match(
    source,
    /const selectedSessionRef = useRef\(selectedSession\);\n  selectedSessionRef\.current = selectedSession;/,
  );
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
