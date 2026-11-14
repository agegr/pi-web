import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { appendSideTab, restoreSideTabs, sideTabsKey } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./side-tab-state.ts");

const sessions = [
  { id: "side-a", projectKey: "/same", relation: { kind: "side", parentSessionId: "main-a" } },
  { id: "side-b", projectKey: "/same", relation: { kind: "side", parentSessionId: "main-b" } },
  { id: "main-a", projectKey: "/same" },
];

test("side tabs return only for their main session, excluding other chats in the same workspace", () => {
  const raw = JSON.stringify({ tabs: [
    { sessionId: "side-a", label: "Question", side: true },
    { sessionId: "side-a", label: "Duplicate", side: true },
    { sessionId: "side-b", label: "Other", side: true },
    { sessionId: "main-a", label: "Main", side: true },
    { sessionId: "deleted", label: "Gone", side: true },
  ], activeId: "agent:side-a", open: true });
  assert.deepEqual(restoreSideTabs(raw, "main-a", sessions), {
    tabs: [{ sessionId: "side-a", label: "Question", side: true }],
    activeId: "agent:side-a", open: true,
  });
  assert.deepEqual(restoreSideTabs(raw, "main-b", sessions), {
    tabs: [{ sessionId: "side-b", label: "Other", side: true }],
    activeId: null, open: true,
  });
  assert.notEqual(sideTabsKey("main-a"), sideTabsKey("main-b"));
});

test("invalid storage or a removed active side tab never opens a ghost tab", () => {
  assert.deepEqual(restoreSideTabs("{", "main-a", sessions), { tabs: [], activeId: null, open: false });
  assert.deepEqual(restoreSideTabs(JSON.stringify({ tabs: [{ sessionId: "side-a", label: "A" }], activeId: "agent:deleted", open: true }), "main-a", []), {
    tabs: [], activeId: null, open: true,
  });
});

test("a side tab saved for a main session that is not shown comes back active with it", () => {
  const raw = appendSideTab(appendSideTab(null, "side-a", "Side chat"), "side-a2", "Side chat");
  const all = [...sessions, { id: "side-a2", projectKey: "/same", relation: { kind: "side", parentSessionId: "main-a" } }];
  assert.deepEqual(restoreSideTabs(raw, "main-a", all), {
    tabs: [{ sessionId: "side-a", label: "Side chat", side: true }, { sessionId: "side-a2", label: "Side chat", side: true }],
    activeId: "agent:side-a2", open: true,
  });
  assert.equal(JSON.parse(appendSideTab("{", "side-a", "Side chat")).tabs.length, 1);
});

test("picking a side chat again replaces its entry instead of adding a second one", () => {
  // A restore keeps the first entry it reads, so a stale duplicate would win:
  // the saved tab has to carry the label the latest pick showed.
  const raw = appendSideTab(appendSideTab(null, "side-a", "Side chat"), "side-a", "Cache sizing");
  assert.deepEqual(JSON.parse(raw), {
    tabs: [{ sessionId: "side-a", label: "Cache sizing", side: true }],
    activeId: "agent:side-a", open: true,
  });
});
