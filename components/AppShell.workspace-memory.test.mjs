import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createJiti } from "jiti";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const draftStore = await jiti.import("@/lib/draft-store");

function callbackBody(name, nextName) {
  const start = source.indexOf(`const ${name} = useCallback`);
  const end = source.indexOf(`\n  const ${nextName}`, start);
  assert.notEqual(start, -1, `${name} callback not found`);
  assert.notEqual(end, -1, `${nextName} callback not found after ${name}`);
  return source.slice(start, end);
}

test("a linked session that is gone gets no other session in its place (#1168)", async (t) => {
  const callbacks = [
    callbackBody("restoreWorkspaceContext", "handleCwdChange"),
    callbackBody("handleCwdChange", "handleSelectSession"),
    callbackBody("handleInitialRestoreDone", "handleSessionDeleted"),
  ].join("\n");
  const parkedKeyHelper = source.slice(source.indexOf("function parkedNewSessionDraftKey"), source.indexOf("export function AppShell"));
  const lastOpen = { id: "p1-last", cwd: "/p1", projectKey: "/p1" };
  const otherLastOpen = { id: "p2-last", cwd: "/p2", projectKey: "/p2" };

  for (const [label, linkedId] of [["from the URL", "gone"], ["from this tab's memory", null]]) {
    await t.test(label, () => {
      const urls = [];
      const context = vm.createContext({
        ...draftStore,
        crypto: globalThis.crypto,
        URLSearchParams,
        window: { location: { pathname: "/", search: linkedId ? `?session=${linkedId}` : "" } },
        router: { replace: (url) => urls.push(url) },
        getLastOpenSession: (key) => ({ "/p1": lastOpen.id, "/p2": otherLastOpen.id })[key] ?? null,
        clearLastOpen() {},
        workspaceKeyOf: (value) => value.projectKey ?? value.cwd,
        useCallback: (callback) => callback,
        changeFileWorkspace() {},
        activeNewSessionDraftKeyRef: { current: null },
        activeProjectKeyRef: { current: null },
        workspaceRestoreTokenRef: { current: 0 },
        suppressCwdBumpRef: { current: false },
        skipWorkspaceRestoreRef: { current: false },
        initialLinkedSessionId: linkedId,
        activeCwd: null,
        newSessionCwd: null,
        newSessionDraftId: "initial",
        selectedSession: null,
        sessionCatalog: [lastOpen, otherLastOpen],
        sessionKey: 0,
      });
      context.invalidateWorkspaceRestore = () => context.workspaceRestoreTokenRef.current++;
      for (const [setter] of callbacks.matchAll(/\bset[A-Z]\w*(?=\()/g)) {
        const state = setter[3].toLowerCase() + setter.slice(4);
        context[setter] = (value) => {
          context[state] = typeof value === "function" ? value(context[state]) : value;
        };
      }
      vm.runInContext(stripTypeScriptTypes(`${parkedKeyHelper}\n${callbacks}
        globalThis.navigate = { handleCwdChange, handleInitialRestoreDone };
      `), context);

      // The sidebar's first load: its null cwd, the initial session missing
      // from its list, then the most recent project, then its hydrated key.
      context.navigate.handleCwdChange(null);
      context.navigate.handleInitialRestoreDone();
      context.navigate.handleCwdChange("/p1", "/p1", "/p1");
      context.navigate.handleCwdChange("/p1", "/p1", "/p1-key");
      if (linkedId) {
        assert.equal(context.selectedSession, null, "a fresh composer, not the project's last session");
        assert.equal(context.activeCwd, "/p1");
        assert.ok(!urls.some((url) => url.includes("session=")), `no other session's URL: ${urls.join(", ")}`);
      } else {
        assert.equal(context.selectedSession?.id, lastOpen.id, "a fresh tab's fallback");
        assert.ok(urls.includes(`?session=${lastOpen.id}`));
      }

      // Ordinary project switches keep their restore.
      context.navigate.handleCwdChange("/p2", "/p2", "/p2");
      assert.equal(context.selectedSession?.id, otherLastOpen.id);
      assert.equal(context.skipWorkspaceRestoreRef.current, false);
    });
  }
});

test("New restores the draft after session navigation and workspace auto-restore", async (t) => {
  const callbacks = [
    callbackBody("restoreWorkspaceContext", "handleCwdChange"),
    callbackBody("handleCwdChange", "handleSelectSession"),
    callbackBody("handleSelectSession", "handleNewSession"),
    callbackBody("handleNewSession", "hydrateSelectedSession"),
  ].join("\n");
  const parkedKeyHelper = source.slice(source.indexOf("function parkedNewSessionDraftKey"), source.indexOf("export function AppShell"));
  const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const cleanupStart = hookSource.indexOf("    return () => {", hookSource.indexOf("  // Load session on mount"));
  const cleanupEnd = hookSource.indexOf("    // eslint-disable-next-line", cleanupStart);

  for (const rememberedCwd of ["/draft-project", "/draft-project-worktree"]) {
    await t.test(`remembered session cwd: ${rememberedCwd}`, async () => {
      const cwd = "/draft-project";
      const session = { id: "remembered", cwd: rememberedCwd, projectKey: cwd };
      const response = Promise.withResolvers();
      const context = vm.createContext({
        ...draftStore,
        crypto: globalThis.crypto,
        queueMicrotask,
        requestAnimationFrame: () => {},
        URLSearchParams,
        window: { location: { pathname: "/", search: "" } },
        router: { replace() {} },
        fetch: () => response.promise,
        getLastOpenSession: (key) => key === cwd ? session.id : null,
        clearLastOpen() {},
        workspaceKeyOf: (value) => value.projectKey ?? value.cwd,
        useCallback: (callback) => callback,
        useGlobalKeyboardShortcuts() {},
        activeNewSessionDraftKeyRef: { current: `new:initial:${cwd}` },
        activeProjectKeyRef: { current: cwd },
        workspaceRestoreTokenRef: { current: 0 },
        suppressCwdBumpRef: { current: false },
        skipWorkspaceRestoreRef: { current: false },
        branchLeafChangeFnRef: { current: null },
        liveFollowFrameRef: { current: null },
        bashRecoveryIdRef: { current: 0 },
        chatInputRef: { current: null },
        newSessionBarFocusRef: { current: null },
        cancelEventStreamGrace() {},
        closeEvents() {},
        changeFileWorkspace() {},
        isMobile: false,
        activeCwd: cwd,
        activeFileTabId: null,
        newSessionCwd: cwd,
        newSessionDraftId: "initial",
        selectedSession: null,
        sessionCatalog: [],
        sessionKey: 0,
      });
      context.invalidateWorkspaceRestore = () => context.workspaceRestoreTokenRef.current++;
      for (const [setter] of callbacks.matchAll(/\bset[A-Z]\w*(?=\()/g)) {
        const state = setter[3].toLowerCase() + setter.slice(4);
        context[setter] = (value) => {
          context[state] = typeof value === "function" ? value(context[state]) : value;
        };
      }
      vm.runInContext(stripTypeScriptTypes(`${parkedKeyHelper}\n${callbacks}
        globalThis.navigate = { handleCwdChange, handleSelectSession, handleNewSession };
      `), context);
      // Run the actual hook cleanup with the outgoing mount's captured draft key.
      const makeCleanup = vm.runInContext(stripTypeScriptTypes(`((isNew, newSessionDraftKey) => {
        const sessionHookMountedRef = { current: true };
        const completionGeneration = { current: 0 };
        const newSessionPromotedRef = { current: false };
        const sessionIdRef = { current: null };
        const dataRef = { current: null };
        const messagesRef = { current: [] };
        const entryIdsRef = { current: [] };
        const activeLeafIdRef = { current: null };
        const historyCursorRef = { current: null };
        const hasEarlierMessagesRef = { current: false };
        const getSessionViewSnapshot = () => null;
        const setSessionViewSnapshot = () => false;
        const deleteSessionViewSnapshot = () => {};
        ${hookSource.slice(cleanupStart, cleanupEnd)}
      })`), context);
      let mountedKey = context.sessionKey;
      let cleanup = makeCleanup(true, context.activeNewSessionDraftKeyRef.current);
      async function commit() {
        if (mountedKey !== context.sessionKey) {
          cleanup();
          mountedKey = context.sessionKey;
          const activeCwd = context.newSessionCwd ?? context.activeCwd;
          const key = context.selectedSession ? null : `new:${context.newSessionDraftId}:${activeCwd}`;
          context.activeNewSessionDraftKeyRef.current = key;
          cleanup = makeCleanup(!context.selectedSession, key);
        }
        await new Promise((resolve) => setImmediate(resolve));
      }

      const draft = { value: "unsent project draft", images: [{ data: "aGVsbG8=", mimeType: "image/png" }] };
      draftStore.setDraft(context.activeNewSessionDraftKeyRef.current, draft);
      context.navigate.handleSelectSession({ ...session, cwd });
      await commit();
      context.navigate.handleNewSession("direct-return", cwd);
      await commit();
      assert.deepEqual(draftStore.getDraft(context.activeNewSessionDraftKeyRef.current), draft);
      context.navigate.handleSelectSession({ ...session, cwd });
      await commit();
      context.navigate.handleCwdChange("/other-project", "/other-project", "/other-project");
      await commit();
      context.navigate.handleCwdChange(cwd, cwd, cwd);
      await commit();
      assert.deepEqual(draftStore.getDraft(context.activeNewSessionDraftKeyRef.current), draft);
      response.resolve({ ok: true, json: async () => ({ sessions: [session] }) });
      await new Promise((resolve) => setImmediate(resolve));
      await commit();
      assert.equal(context.selectedSession.id, session.id);
      context.navigate.handleNewSession("after-auto-restore", cwd);
      await commit();
      assert.deepEqual(draftStore.getDraft(context.activeNewSessionDraftKeyRef.current), draft);
      draftStore.clearDraft(context.activeNewSessionDraftKeyRef.current);
    });
  }
});

test("New in another project adopts it up front and parks the composer's draft", () => {
  const callbacks = [
    callbackBody("restoreWorkspaceContext", "handleCwdChange"),
    callbackBody("handleCwdChange", "handleSelectSession"),
    callbackBody("handleSelectSession", "handleNewSession"),
    callbackBody("handleNewSession", "hydrateSelectedSession"),
  ].join("\n");
  const parkedKeyHelper = source.slice(source.indexOf("function parkedNewSessionDraftKey"), source.indexOf("export function AppShell"));
  const fileTab = { id: "file:/p1/notes.md", filePath: "/p1/notes.md" };
  const context = vm.createContext({
    ...draftStore,
    crypto: globalThis.crypto,
    URLSearchParams,
    window: { location: { pathname: "/", search: "" } },
    router: { replace() {} },
    fetch: () => new Promise(() => {}),
    getLastOpenSession: () => null,
    clearLastOpen() {},
    workspaceKeyOf: (value) => value.projectKey ?? value.cwd,
    useCallback: (callback) => callback,
    useGlobalKeyboardShortcuts() {},
    activeNewSessionDraftKeyRef: { current: "new:first:/p1" },
    activeProjectKeyRef: { current: "/p1" },
    workspaceRestoreTokenRef: { current: 0 },
    suppressCwdBumpRef: { current: false },
    skipWorkspaceRestoreRef: { current: false },
    branchLeafChangeFnRef: { current: null },
    chatInputRef: { current: null },
    newSessionBarFocusRef: { current: null },
    requestAnimationFrame: () => {},
    isMobile: false,
    activeCwd: "/p1",
    activeFileTabId: fileTab.id,
    fileTabs: [fileTab],
    rightPanelOpen: true,
    newSessionCwd: "/p1",
    newSessionDraftId: "first",
    selectedSession: null,
    sessionCatalog: [],
    sessionKey: 0,
  });
  context.invalidateWorkspaceRestore = () => context.workspaceRestoreTokenRef.current++;
  for (const [setter] of callbacks.matchAll(/\bset[A-Z]\w*(?=\()/g)) {
    const state = setter[3].toLowerCase() + setter.slice(4);
    context[setter] = (value) => {
      context[state] = typeof value === "function" ? value(context[state]) : value;
    };
  }
  context.changeFileWorkspace = () => {
    context.fileTabs = [];
    context.activeFileTabId = null;
    context.rightPanelOpen = false;
  };
  vm.runInContext(stripTypeScriptTypes(`${parkedKeyHelper}\n${callbacks}
    globalThis.navigate = { handleCwdChange, handleSelectSession, handleNewSession };
  `), context);
  const draft = { value: "half-written in p1", images: [] };
  draftStore.setDraft("new:first:/p1", draft);

  // Ctrl+Alt+N (no key) in the same cwd keeps the project and its file tabs.
  context.navigate.handleNewSession("kb-1", "/p1");
  assert.equal(context.activeProjectKeyRef.current, "/p1");
  assert.deepEqual(context.fileTabs, [fileTab]);
  assert.equal(context.rightPanelOpen, true);
  draftStore.setDraft(context.activeNewSessionDraftKeyRef.current, draft);

  // A group's "+" in another project: adopted before the sidebar reports the cwd.
  const sessionKey = context.sessionKey;
  context.navigate.handleNewSession("p2-new", "/p2", "/p2-key");
  assert.equal(context.activeProjectKeyRef.current, "/p2-key");
  assert.equal(context.fileTabs.length, 0);
  assert.equal(context.activeFileTabId, null);
  assert.equal(context.rightPanelOpen, false);
  assert.equal(context.newSessionCwd, "/p2");
  assert.equal(context.sessionKey, sessionKey + 1);
  assert.deepEqual(draftStore.getDraft("parked-new:/p1"), draft, "the p1 composer's draft is parked, not dropped");

  // The sidebar's report of that cwd is neither a switch nor a second remount.
  context.activeCwd = "/p1";
  context.navigate.handleCwdChange("/p2", "/p2", "/p2-key");
  assert.equal(context.sessionKey, sessionKey + 1);
  assert.equal(context.newSessionCwd, "/p2");
  assert.equal(context.activeCwd, "/p2");
  draftStore.clearDraft("parked-new:/p1");
});

test("the composer's bar moves the fresh composer's draft and model picks instead of parking them", () => {
  const callbacks = [
    callbackBody("restoreWorkspaceContext", "handleCwdChange"),
    callbackBody("handleCwdChange", "handleSelectSession"),
    callbackBody("handleSelectSession", "handleNewSession"),
    callbackBody("handleNewSession", "hydrateSelectedSession"),
  ].join("\n");
  const parkedKeyHelper = source.slice(source.indexOf("function parkedNewSessionDraftKey"), source.indexOf("export function AppShell"));
  const fileTab = { id: "file:/p1/notes.md", filePath: "/p1/notes.md" };
  const choices = { model: { provider: "custom", modelId: "fast" }, thinkingLevel: "high" };
  const context = vm.createContext({
    ...draftStore,
    crypto: globalThis.crypto,
    URLSearchParams,
    window: { location: { pathname: "/", search: "" } },
    router: { replace() {} },
    fetch: () => new Promise(() => {}),
    getLastOpenSession: () => null,
    clearLastOpen() {},
    workspaceKeyOf: (value) => value.projectKey ?? value.cwd,
    useCallback: (callback) => callback,
    useGlobalKeyboardShortcuts() {},
    activeNewSessionDraftKeyRef: { current: "new:first:/p1" },
    activeProjectKeyRef: { current: "/p1" },
    workspaceRestoreTokenRef: { current: 0 },
    suppressCwdBumpRef: { current: false },
    skipWorkspaceRestoreRef: { current: false },
    branchLeafChangeFnRef: { current: null },
    chatInputRef: { current: null },
    newSessionBarFocusRef: { current: null },
    requestAnimationFrame: () => {},
    newSessionChoicesRef: { current: choices },
    carriedNewSessionChoices: null,
    isMobile: false,
    activeCwd: "/p1",
    activeFileTabId: fileTab.id,
    fileTabs: [fileTab],
    rightPanelOpen: true,
    newSessionCwd: "/p1",
    newSessionDraftId: "first",
    selectedSession: null,
    sessionCatalog: [],
    sessionKey: 0,
  });
  context.invalidateWorkspaceRestore = () => context.workspaceRestoreTokenRef.current++;
  for (const [setter] of callbacks.matchAll(/\bset[A-Z]\w*(?=\()/g)) {
    const state = setter[3].toLowerCase() + setter.slice(4);
    context[setter] = (value) => {
      context[state] = typeof value === "function" ? value(context[state]) : value;
    };
  }
  context.changeFileWorkspace = () => {
    context.fileTabs = [];
    context.activeFileTabId = null;
    context.rightPanelOpen = false;
  };
  vm.runInContext(stripTypeScriptTypes(`${parkedKeyHelper}\n${callbacks}
    globalThis.navigate = { handleCwdChange, handleNewSession };
  `), context);
  const draft = { value: "half-written in p1", images: [{ data: "aGVsbG8=", mimeType: "image/png" }] };
  const parkedInP2 = { value: "parked in p2", images: [] };
  draftStore.setDraft("new:first:/p1", draft);
  draftStore.setDraft("parked-new:/p2", parkedInP2);

  // Another project from the bar: the draft and the picks go along, nothing is parked.
  const sessionKey = context.sessionKey;
  context.navigate.handleNewSession("p2-new", "/p2", "/p2-key", { carryComposer: true });
  assert.deepEqual(draftStore.getDraft("new:p2-new:/p2"), draft, "text and images move to the new composer");
  assert.equal(draftStore.getDraft("new:first:/p1"), null);
  assert.equal(draftStore.getDraft("parked-new:/p1"), null, "nothing is left parked in the old cwd");
  assert.deepEqual(draftStore.getDraft("parked-new:/p2"), parkedInP2, "the target's parked draft stays parked, never merged");
  assert.equal(context.carriedNewSessionChoices, choices);
  assert.equal(context.activeNewSessionDraftKeyRef.current, "new:p2-new:/p2");
  assert.equal(context.activeProjectKeyRef.current, "/p2-key");
  assert.equal(context.fileTabs.length, 0);
  assert.equal(context.newSessionCwd, "/p2");
  assert.equal(context.sessionKey, sessionKey + 1);
  // The sidebar's report of that cwd is neither a switch nor a second remount.
  context.navigate.handleCwdChange("/p2", "/p2", "/p2-key");
  assert.equal(context.sessionKey, sessionKey + 1);

  // Nothing typed: the target's parked draft comes back, as it does without the bar.
  draftStore.clearDraft("new:p2-new:/p2");
  context.newSessionDraftId = "p2-new";
  context.navigate.handleNewSession("p2-again", "/p2-worktree", "/p2-key", { carryComposer: true });
  assert.equal(draftStore.getDraft("new:p2-again:/p2-worktree"), null);
  draftStore.setDraft("parked-new:/p3", parkedInP2);
  context.navigate.handleNewSession("p3-new", "/p3", "/p3-key", { carryComposer: true });
  assert.deepEqual(draftStore.getDraft("new:p3-new:/p3"), parkedInP2);

  // A mounted composer moves its own live text (what promoteNewSession uses too).
  const moves = [];
  context.chatInputRef.current = { rekeyDraft: (from, to) => moves.push([from, to]) };
  context.navigate.handleNewSession("p4-new", "/p4", "/p4-key", { carryComposer: true });
  assert.deepEqual(moves, [["new:p3-new:/p3", "new:p4-new:/p4"]]);

  // Without the option (a group's "+") the draft is parked as before, and no picks go along.
  context.chatInputRef.current = null;
  context.carriedNewSessionChoices = null;
  draftStore.setDraft("new:p4-new:/p4", draft);
  context.navigate.handleNewSession("p5-new", "/p5", "/p5-key");
  assert.deepEqual(draftStore.getDraft("parked-new:/p4"), draft);
  assert.equal(draftStore.getDraft("new:p5-new:/p5"), null);
  assert.equal(context.carriedNewSessionChoices, null);
  for (const key of ["parked-new:/p2", "parked-new:/p4", "new:p3-new:/p3"]) draftStore.clearDraft(key);
});

test("the bar of the new composer shows the bar's own move until the sidebar reports it", async () => {
  const { contextForCwd } = await jiti.import("../lib/new-session-context.ts");
  const callbacks = [
    callbackBody("handleSidebarNewSessionContext", "newSessionBarFocusRef"),
    callbackBody("handlePickNewSessionContext", "pickNewSessionContextRef"),
    callbackBody("handleCreateNewSessionWorktree", "handleNewSessionBarFocusDone"),
  ].join("\n");
  const starts = [];
  const context = vm.createContext({
    Error,
    useCallback: (callback) => callback,
    newSessionMoveRef: { current: null },
    newSessionBarFocusRef: { current: null },
    sidebarControlRef: {
      current: {
        startNewSessionIn: (target) => starts.push(target),
        createWorktree: async (_project, branch) => ({ path: `/work/app-worktrees/${branch.replace("/", "-")}` }),
      },
    },
    sidebarNewSessionContext: null,
    selectedSession: null,
    effectiveNewSessionCwd: "/work/app",
  });
  context.setSidebarNewSessionContext = (value) => { context.sidebarNewSessionContext = value; };
  vm.runInContext(stripTypeScriptTypes(`${callbacks}
    globalThis.bar = { handleSidebarNewSessionContext, handlePickNewSessionContext, handleCreateNewSessionWorktree };
  `), context);
  const app = { key: "app-key", root: "/work/app" };
  const main = { path: "/work/app", branch: "main", isMain: true };
  const report = { cwd: "/work/app", project: app, worktrees: [main], currentWorktreePath: main.path, projects: [app] };
  context.bar.handleSidebarNewSessionContext(report);
  const shown = () => contextForCwd(context.sidebarNewSessionContext, context.effectiveNewSessionCwd, context.newSessionMoveRef.current);

  // "New worktree…": the move keeps the branch it was created with, and the
  // first bar after it already lists that worktree as current.
  const created = await context.bar.handleCreateNewSessionWorktree(app, "fix/login");
  context.bar.handlePickNewSessionContext({ cwd: created.path, projectKey: app.key, projectRoot: app.root }, "worktree");
  assert.equal(starts.length, 1);
  assert.equal(starts[0].carryComposer, true);
  assert.equal(context.newSessionBarFocusRef.current, "worktree");
  context.effectiveNewSessionCwd = created.path;
  assert.deepEqual(shown().project, app);
  assert.deepEqual(shown().worktrees.at(-1), { path: created.path, branch: "fix/login", isMain: false });
  assert.equal(shown().currentWorktreePath, created.path);

  // Another cwd's report leaves the move; the report of its cwd ends it.
  context.bar.handleSidebarNewSessionContext(report);
  assert.equal(context.newSessionMoveRef.current?.cwd, created.path);
  const caughtUp = { ...report, cwd: created.path, worktrees: [main, { path: created.path, branch: "fix/login", isMain: false }], currentWorktreePath: created.path };
  context.bar.handleSidebarNewSessionContext(caughtUp);
  assert.equal(context.newSessionMoveRef.current, null);
  assert.equal(shown(), caughtUp);

  // Another project: its identity until the sidebar has resolved it.
  context.bar.handlePickNewSessionContext({ cwd: "/elsewhere/lib", projectKey: "lib-key", projectRoot: "/elsewhere/lib" }, "project");
  assert.equal(JSON.stringify(context.newSessionMoveRef.current), JSON.stringify({ cwd: "/elsewhere/lib", project: { key: "lib-key", root: "/elsewhere/lib" }, branch: null }));

  // Refused moves leave nothing behind.
  context.newSessionMoveRef.current = null;
  context.bar.handlePickNewSessionContext({ cwd: created.path, projectKey: app.key, projectRoot: app.root }, "project");
  context.selectedSession = { id: "open" };
  context.bar.handlePickNewSessionContext({ cwd: "/work/app", projectKey: app.key, projectRoot: app.root }, "worktree");
  assert.equal(context.newSessionMoveRef.current, null);
  assert.equal(starts.length, 2);
});

test("a new session puts the caret in the fresh composer on desktop only (#1313)", () => {
  const callbacks = [
    callbackBody("restoreWorkspaceContext", "handleCwdChange"),
    callbackBody("handleCwdChange", "handleSelectSession"),
    callbackBody("handleSelectSession", "handleNewSession"),
    callbackBody("handleNewSession", "hydrateSelectedSession"),
  ].join("\n");
  const parkedKeyHelper = source.slice(source.indexOf("function parkedNewSessionDraftKey"), source.indexOf("export function AppShell"));
  const frames = [];
  const focused = [];
  const context = vm.createContext({
    ...draftStore,
    crypto: globalThis.crypto,
    URLSearchParams,
    window: { location: { pathname: "/", search: "" } },
    router: { replace() {} },
    fetch: () => new Promise(() => {}),
    getLastOpenSession: () => null,
    clearLastOpen() {},
    workspaceKeyOf: (value) => value.projectKey ?? value.cwd,
    useCallback: (callback) => callback,
    useGlobalKeyboardShortcuts() {},
    activeNewSessionDraftKeyRef: { current: "new:first:/p1" },
    activeProjectKeyRef: { current: "/p1" },
    workspaceRestoreTokenRef: { current: 0 },
    suppressCwdBumpRef: { current: false },
    skipWorkspaceRestoreRef: { current: false },
    branchLeafChangeFnRef: { current: null },
    chatInputRef: { current: { focus: () => focused.push("composer"), rekeyDraft: () => {} } },
    newSessionBarFocusRef: { current: null },
    newSessionChoicesRef: { current: null },
    requestAnimationFrame: (cb) => frames.push(cb),
    document: { activeElement: null },
    isMobile: false,
    activeCwd: "/p1",
    activeFileTabId: null,
    newSessionCwd: "/p1",
    newSessionDraftId: "first",
    selectedSession: null,
    sessionCatalog: [],
    sessionKey: 0,
  });
  context.invalidateWorkspaceRestore = () => context.workspaceRestoreTokenRef.current++;
  for (const [setter] of callbacks.matchAll(/\bset[A-Z]\w*(?=\()/g)) {
    const state = setter[3].toLowerCase() + setter.slice(4);
    context[setter] = (value) => {
      context[state] = typeof value === "function" ? value(context[state]) : value;
    };
  }
  context.changeFileWorkspace = () => {};
  vm.runInContext(stripTypeScriptTypes(`${parkedKeyHelper}\n${callbacks}
    globalThis.navigate = { handleNewSession };
  `), context);

  // Ctrl+Alt+N: the fresh composer takes the caret once it renders.
  context.navigate.handleNewSession("kb-1", "/p1");
  assert.equal(frames.length, 1);
  frames.splice(0).forEach((cb) => cb());
  assert.deepEqual(focused, ["composer"]);

  // A dialog still open over the page (Settings) keeps the focus.
  context.document.activeElement = { closest: (selector) => selector === "[aria-modal='true']" ? {} : null };
  context.navigate.handleNewSession("kb-dialog", "/p1");
  frames.splice(0).forEach((cb) => cb());
  assert.deepEqual(focused, ["composer"]);
  context.document.activeElement = null;

  // The bar's move keeps its control, so no caret request is made for it.
  context.newSessionBarFocusRef.current = "worktree";
  context.navigate.handleNewSession("p2-new", "/p2", "/p2-key", { carryComposer: true });
  assert.equal(frames.length, 0);
  context.newSessionBarFocusRef.current = null;

  // A phone never raises the keyboard uninvited.
  context.isMobile = true;
  context.navigate.handleNewSession("kb-2", "/p1");
  assert.equal(frames.length, 0);
});
