import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { restoreSideTabs, sideTabsKey } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./side-tab-state.ts");

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
