import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createJiti } from "jiti";

// The handler is copied out of AppShell the way AppShell.side-tabs.test.mjs does:
// the component needs a browser to mount, and the rule under test is the three
// branches it takes, not its markup.
const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const start = source.indexOf("  const handleSelectSideChat = useCallback(");
assert.ok(start !== -1);
// End at the handler's own dependency array: a neighbouring comment is not ours
// to depend on, and the next handler starts after that array.
const rest = source.slice(start);
const depsAt = rest.search(/\n  \}, \[/);
assert.ok(depsAt > 0);
const end = start + rest.indexOf("]);", depsAt) + 3;
assert.ok(end > start);
const handler = stripTypeScriptTypes(source.slice(start, end));

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { sideChatHit } = await jiti.import("../lib/session-search-hit.ts");
const { appendSideTab, restoreSideTabs, sideTabsKey } = await jiti.import("./side-tab-state.ts");

const sessions = [
  { id: "main-a", name: "Deploy notes" },
  { id: "main-b", name: "Other work" },
  { id: "side-a", name: "Cache sizing", created: "2026-01-03", relation: { kind: "side", parentSessionId: "main-a" } },
];

function run({ openParent, catalog = sessions, hit = sessions[2] } = {}) {
  const store = new Map();
  const calls = { opened: [], selected: [], refreshed: 0, catalog };
  const context = vm.createContext({
    useCallback: (callback) => callback,
    sessionCatalog: catalog,
    sideTabOwnerRef: { current: openParent ?? null },
    translate: (key) => (key === "agentSwitcher.sideChat" ? "Side chat" : key),
    sideChatHit,
    appendSideTab,
    sideTabsKey,
    handleOpenSubagentTab: (sessionId, label, side) => calls.opened.push({ sessionId, label, side }),
    handleSelectSession: (session) => calls.selected.push(session.id),
    setRefreshKey: (update) => { calls.refreshed += update(0); },
    setSessionCatalog: (update) => { calls.catalog = typeof update === "function" ? update(calls.catalog) : update; },
    window: { sessionStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) } },
  });
  vm.runInContext(`${handler}\nhandleSelectSideChat`, context)(hit);
  return { calls, store };
}

test("picking a side chat hit opens the parent and queues the side chat's tab", () => {
  const { calls, store } = run({ openParent: "main-b" });
  assert.deepEqual(calls.selected, ["main-a"]);
  assert.deepEqual(calls.opened, []);
  const saved = JSON.parse(store.get(sideTabsKey("main-a")));
  assert.deepEqual(saved.tabs, [{ sessionId: "side-a", label: "Cache sizing", side: true }]);
  assert.equal(saved.activeId, "agent:side-a");
  assert.equal(saved.open, true);
});

test("picking it while its parent is open opens the tab in that panel", () => {
  const { calls, store } = run({ openParent: "main-a" });
  assert.deepEqual(calls.opened, [{ sessionId: "side-a", label: "Cache sizing", side: true }]);
  assert.deepEqual(calls.selected, []);
  assert.equal(store.size, 0);
});

test("a hit whose parent is not listed asks for a fresh list instead of selecting the side chat", () => {
  const { calls } = run({ openParent: null, catalog: [sessions[2]] });
  assert.deepEqual(calls.selected, []);
  assert.deepEqual(calls.opened, []);
  assert.equal(calls.refreshed, 1);
});

test("a hit for an ordinary session is not handled here", () => {
  const { calls } = run({ hit: sessions[0] });
  assert.deepEqual(calls.selected, []);
  assert.deepEqual(calls.opened, []);
  assert.equal(calls.refreshed, 0);
});

test("a side chat this page's list has not seen yet is added before its tab is queued", () => {
  // The search can read a catalogue newer than the page: without the side chat
  // in the list, the tab restore would drop the tab this pick queues.
  const fresh = { id: "side-new", name: "Side chat", firstMessage: "q", created: "2026-01-04", relation: { kind: "side", parentSessionId: "main-a" } };
  const { calls, store } = run({ openParent: "main-b", catalog: [sessions[0], sessions[1]], hit: fresh });
  assert.deepEqual(calls.selected, ["main-a"]);
  assert.equal(calls.refreshed, 1);
  // The handler builds its array in the vm's realm: read it back through this one.
  assert.deepEqual([...calls.catalog].map((session) => session.id), ["side-new", "main-a", "main-b"]);
  // Counted among its parent's side chats, as the row it was picked from counts it.
  assert.deepEqual(JSON.parse(store.get(sideTabsKey("main-a"))).tabs, [{ sessionId: "side-new", label: "Side chat 1", side: true }]);
  // The queued tab survives the restore that follows the parent's arrival.
  assert.deepEqual(restoreSideTabs(store.get(sideTabsKey("main-a")), "main-a", [...calls.catalog]).tabs, [
    { sessionId: "side-new", label: "Side chat 1", side: true },
  ]);
});
