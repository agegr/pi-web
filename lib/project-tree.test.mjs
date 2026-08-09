import assert from "node:assert/strict";
import test from "node:test";

const { projectTreeForResponse } = await import("./project-tree.ts");

const msg = (id, text) => ({ type: "message", id, parentId: null, timestamp: "t", message: { role: "user", content: text } });
const info = (id) => ({ type: "session_info", id, parentId: null, timestamp: "t", name: "x" });
const node = (entry, children = []) => ({ entry, children });

test("keeps the first message entry of each diverging arm", () => {
  // A1 branches: arm 1 starts with session_info then U2; arm 2 starts with U2b
  const arm1Leaf = node(msg("a2", "答一"));
  const arm1 = node(info("s1"), [node(msg("u2", "分支一的问题"), [arm1Leaf])]);
  const arm2 = node(msg("u2b", "分支二的问题"), [node(msg("a2b", "答二"))]);
  const a1 = node(msg("a1", "答"), [arm1, arm2]);
  const root = node(msg("u1", "第一问"), [a1]);

  const [projectedRoot] = projectTreeForResponse([root]);
  const projectedA1 = projectedRoot.children[0];
  assert.equal(projectedA1.entry.id, "a1");
  // arm 1: s1 compressed away, u2 visible with the question text
  assert.equal(projectedA1.children[0].entry.id, "u2");
  assert.deepEqual(projectedA1.children[0].compressedEntryIds, ["s1"]);
  // arm 2: u2b visible directly
  assert.equal(projectedA1.children[1].entry.id, "u2b");
  // leaves still kept below the arm heads
  assert.equal(projectedA1.children[0].children[0].entry.id, "a2");
  assert.equal(projectedA1.children[1].children[0].entry.id, "a2b");
});

test("linear sessions still project to root + leaf only", () => {
  const root = node(msg("u1", "第一问"), [node(msg("a1", "答"))]);
  const [projected] = projectTreeForResponse([root]);
  assert.equal(projected.entry.id, "u1");
  assert.equal(projected.children.length, 1);
  assert.equal(projected.children[0].entry.id, "a1");
});
