import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createJiti } from "jiti";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const start = source.indexOf("  const sideTabOwner = activeSessionFamily?.root.id ?? null;");
const end = source.indexOf("  // sessionStorage is empty during SSR.", start);
assert.ok(start !== -1 && end > start);
const effect = stripTypeScriptTypes(source.slice(start, end));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { restoreSideTabs, sideTabsKey } = await jiti.import("./side-tab-state.ts");
const { sideChatTitle } = await jiti.import("../lib/session-family.ts");

const sessions = [
  { id: "side-a", relation: { kind: "side", parentSessionId: "main-a" } },
  { id: "side-b", relation: { kind: "side", parentSessionId: "main-b" } },
];

test("switching main sessions swaps their side tabs without removing subagent tabs", () => {
  const store = new Map([[sideTabsKey("main-b"), JSON.stringify({ tabs: [{ sessionId: "side-b", label: "B", side: true }], activeId: "agent:side-b", open: true })]]);
  const context = vm.createContext({
    activeSessionFamily: { root: { id: "main-b" } },
    selectedSession: { id: "main-b" },
    sideTabOwnerRef: { current: "main-a" },
    sideTabsReadyRef: { current: true },
    sideTabsSavedOnWorkspaceSwitchRef: { current: false },
    agentTabs: [
      { sessionId: "side-a", label: "A", side: true },
      { sessionId: "child-a", label: "Plan" },
    ],
    activeFileTabId: "agent:side-a",
    rightPanelOpen: true,
    catalogLoaded: true,
    initialSessionRestored: true,
    fileTabs: [], terminalTabs: [], sessionCatalog: sessions,
    restoreSideTabs, sideTabsKey,
    window: { sessionStorage: { getItem: (key) => store.get(key) ?? null } },
    rememberSideTabs(key) {
      store.set(sideTabsKey(key), JSON.stringify({ tabs: context.agentTabs.filter((tab) => tab.side), activeId: context.activeFileTabId, open: context.rightPanelOpen }));
    },
    setAgentTabs(value) { context.agentTabs = typeof value === "function" ? value(context.agentTabs) : value; },
    setActiveFileTabId(value) { context.activeFileTabId = value; },
    setRightPanelOpen(value) { context.rightPanelOpen = value; },
    useEffect(callback) { callback(); },
  });
  const run = () => vm.runInContext(`{ ${effect} }`, context);
  run();
  assert.equal(context.sideTabOwnerRef.current, "main-b");
  assert.deepEqual(Array.from(context.agentTabs, (tab) => tab.sessionId), ["child-a", "side-b"]);
  assert.equal(context.activeFileTabId, "agent:side-b");
  assert.equal(JSON.parse(store.get(sideTabsKey("main-a"))).activeId, "agent:side-a");

  context.activeSessionFamily = { root: { id: "main-a" } };
  context.selectedSession = { id: "main-a" };
  run();
  assert.deepEqual(Array.from(context.agentTabs, (tab) => tab.sessionId), ["child-a", "side-a"]);
  assert.equal(context.activeFileTabId, "agent:side-a");
});

test("two unnamed side tabs match the Agents list regardless of open order", () => {
  const start = source.indexOf("  const handleOpenSubagentTab = useCallback(");
  const end = source.indexOf("  // The agent switcher's side-panel button", start);
  assert.ok(start !== -1 && end > start);
  const context = vm.createContext({
    useCallback: (callback) => callback,
    tabs: [],
    setAgentTabs(update) { context.tabs = update(context.tabs); },
    setActiveFileTabId() {}, setRightPanelOpen() {},
    isMobile: false,
  });
  const family = [
    { id: "side-a", name: "Side chat", created: "2026-01-01", relation: { kind: "side" } },
    { id: "side-b", name: "Side chat", created: "2026-01-02", relation: { kind: "side" } },
  ];
  const open = vm.runInContext(`${stripTypeScriptTypes(source.slice(start, end))}\nhandleOpenSubagentTab`, context);
  open("side-b", sideChatTitle(family[1], "Side chat", family), true);
  open("side-a", sideChatTitle(family[0], "Side chat", family), true);
  assert.deepEqual(Array.from(context.tabs, (tab) => tab.label), ["Side chat 2", "Side chat 1"]);
});

test("a project switch still drops subagent tabs but saves the current side tabs", () => {
  const start = source.indexOf("  const changeFileWorkspace = useCallback(");
  const end = source.indexOf("  // Same @mention format", start);
  assert.ok(start !== -1 && end > start);
  const store = new Map();
  const context = vm.createContext({
    useCallback: (callback) => callback,
    activeFileTabId: "agent:side-a",
    agentTabs: [
      { sessionId: "side-a", label: "A", side: true },
      { sessionId: "child-a", label: "Plan" },
    ],
    fileTabs: [], rightPanelOpen: true,
    fileWorkspaceStatesRef: { current: new Map() },
    fileWorkspaceGenerationRef: { current: 0 },
    sideTabsReadyRef: { current: true },
    sideTabOwnerRef: { current: "main-a" },
    sideTabsSavedOnWorkspaceSwitchRef: { current: false },
    switchFileWorkspace: () => ({ tabs: [], activeTabId: null, open: false }),
    rememberSideTabs(key) { store.set(key, context.agentTabs.filter((tab) => tab.side)); },
    setFileWorkspaceGeneration() {}, setFileTabs() {},
    setAgentTabs(update) { context.agentTabs = update(context.agentTabs); },
    setActiveFileTabId(value) { context.activeFileTabId = value; },
    setRightPanelOpen(value) { context.rightPanelOpen = value; },
  });
  vm.runInContext(`${stripTypeScriptTypes(source.slice(start, end))}\nchangeFileWorkspace("/a", "/b")`, context);
  assert.deepEqual(Array.from(context.agentTabs, (tab) => tab.sessionId), ["side-a"]);
  assert.deepEqual(Array.from(store.get("main-a"), (tab) => tab.sessionId), ["side-a"]);
  assert.equal(context.sideTabsSavedOnWorkspaceSwitchRef.current, true);
});
