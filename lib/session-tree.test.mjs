import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildSessionTree } = await createJiti(import.meta.url).import("./session-tree.ts");

function session(id, modified, relation) {
  return {
    path: `/tmp/${id}.jsonl`,
    id,
    cwd: "/tmp",
    created: modified,
    modified,
    messageCount: 1,
    firstMessage: id,
    ...(relation ? { relation } : {}),
  };
}

test("only subagents nest while forks remain independent roots", () => {
  const roots = buildSessionTree([
    session("parent", "2026-01-01T00:00:00.000Z"),
    session("fork", "2026-01-03T00:00:00.000Z", { kind: "fork", originSessionId: "parent" }),
    session("child", "2026-01-02T00:00:00.000Z", {
      kind: "subagent",
      parentSessionId: "parent",
      profile: "Explore",
      description: "Inspect",
    }),
  ]);

  assert.deepEqual(roots.map((node) => node.session.id), ["fork", "parent"]);
  assert.deepEqual(roots[1].children.map((node) => node.session.id), ["child"]);
});

test("orphaned subagents become roots and every level is sorted newest first", () => {
  const roots = buildSessionTree([
    session("parent", "2026-01-01T00:00:00.000Z"),
    session("older", "2026-01-02T00:00:00.000Z", { kind: "subagent", parentSessionId: "parent", profile: "A", description: "A" }),
    session("newer", "2026-01-03T00:00:00.000Z", { kind: "subagent", parentSessionId: "parent", profile: "B", description: "B" }),
    session("orphan", "2026-01-04T00:00:00.000Z", { kind: "subagent", parentSessionId: "missing", profile: "C", description: "C" }),
  ]);

  assert.deepEqual(roots.map((node) => node.session.id), ["orphan", "parent"]);
  assert.deepEqual(roots[1].children.map((node) => node.session.id), ["newer", "older"]);
});

test("cyclic relation metadata cannot hide sessions or recurse forever", () => {
  const roots = buildSessionTree([
    session("a", "2026-01-01T00:00:00.000Z", { kind: "subagent", parentSessionId: "b", profile: "A", description: "A" }),
    session("b", "2026-01-02T00:00:00.000Z", { kind: "subagent", parentSessionId: "a", profile: "B", description: "B" }),
  ]);

  assert.deepEqual(roots.map((node) => node.session.id), ["b", "a"]);
  assert.deepEqual(roots.map((node) => node.children.length), [0, 0]);
});

test("deep subagent trees are sorted without recursive traversal", () => {
  const sessions = [session("root", "2026-01-01T00:00:00.000Z")];
  for (let index = 1; index <= 1500; index += 1) {
    sessions.push(session(`child-${index}`, `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`, {
      kind: "subagent",
      parentSessionId: index === 1 ? "root" : `child-${index - 1}`,
      profile: "general-purpose",
      description: "Nested",
    }));
  }
  const roots = buildSessionTree(sessions);
  let node = roots[0];
  let depth = 0;
  while (node.children[0]) {
    depth += 1;
    node = node.children[0];
  }
  assert.equal(depth, 1500);
});
