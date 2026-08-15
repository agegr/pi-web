import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { activeSessionRoots, attachSessionRelations, isReservedSubagentSessionName } = await jiti.import("./session-relations.ts");

function session(id, name, parentSessionId) {
  return {
    path: `/tmp/${id}.jsonl`, id, cwd: "/tmp", name,
    created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1, firstMessage: id, parentSessionId,
  };
}

test("isReservedSubagentSessionName recognizes only the reserved subagent format", () => {
  assert.equal(isReservedSubagentSessionName("subagent-worker-317e1ca0-1"), true);
  assert.equal(isReservedSubagentSessionName("subagent-reviewer-76fa6d64-6031-4824-8a88-1282c22d9afa-2"), true);
  assert.equal(isReservedSubagentSessionName("Main task"), false);
  assert.equal(isReservedSubagentSessionName("subagent-worker-not-a-run"), false);
});

test("classifies standard subagent sessions and resolves their primary root", () => {
  const related = attachSessionRelations([
    session("root", "Main task"),
    session("worker", "subagent-worker-317e1ca0-1", "root"),
    session("reviewer", "subagent-reviewer-76fa6d64-6031-4824-8a88-1282c22d9afa-2", "worker"),
  ]);

  assert.equal(related[0].sessionRole, "primary");
  assert.deepEqual(related[1], {
    ...session("worker", "subagent-worker-317e1ca0-1", "root"),
    sessionRole: "subagent", rootSessionId: "root", subagentAgent: "worker",
    subagentRunId: "317e1ca0", subagentIndex: 0,
  });
  assert.equal(related[2].sessionRole, "subagent");
  assert.equal(related[2].rootSessionId, "root");
  assert.equal(related[2].subagentIndex, 1);
});

test("keeps ordinary forks visible and hides orphaned official subagent sessions", () => {
  const related = attachSessionRelations([
    session("root", "Main task"),
    session("fork", "Alternative approach", "root"),
    session("orphan", "subagent-worker-317e1ca0-1"),
    session("similar", "subagent-worker-custom"),
  ]);

  assert.equal(related[1].sessionRole, "fork");
  assert.equal(related[2].sessionRole, "subagent");
  assert.equal(related[2].rootSessionId, undefined);
  assert.equal(related[3].sessionRole, "primary");
});

test("collapses concurrent workers into one running root until the last worker finishes", () => {
  const related = attachSessionRelations([
    session("root", "Main task"),
    session("worker-1", "subagent-worker-317e1ca0-1", "root"),
    session("worker-2", "subagent-reviewer-317e1ca0-2", "root"),
  ]);

  assert.deepEqual([...activeSessionRoots(related, ["worker-1", "worker-2"]).roots], ["root"]);
  assert.deepEqual([...activeSessionRoots(related, ["worker-2"]).roots], ["root"]);
  assert.deepEqual([...activeSessionRoots(related, []).roots], []);
});

test("keeps the prior root active while a newly reported worker is unresolved", () => {
  const related = attachSessionRelations([session("root", "Main task")]);
  const state = activeSessionRoots(related, ["not-loaded-yet"], ["root"]);

  assert.equal(state.unresolved, true);
  assert.deepEqual([...state.roots], ["root"]);
});
