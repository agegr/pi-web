import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { compressChain, selectTopLevelBranches, buildActivePath, hasBranch } = await jiti.import("./BranchNavigator.tsx");

const msg = (id, role, text) => ({ type: "message", id, parentId: null, timestamp: "t", message: { role, content: text } });
const info = (id) => ({ type: "session_info", id, parentId: null, timestamp: "t", name: "x" });
const model = (id) => ({ type: "model_change", id, parentId: null, timestamp: "t", provider: "test", modelId: "test" });
const node = (entry, children = []) => ({ entry, children });

test("compressChain labels a chain by its first message entry", () => {
  const chain = node(msg("u1", "user", "原问题"), [node(msg("a1", "assistant", "回答"))]);
  const { labelEntry, node: rep } = compressChain(chain);
  assert.equal(labelEntry.id, "u1");
  assert.equal(rep.entry.id, "a1");
});

test("compressChain skips non-message entries such as session_info", () => {
  const chain = node(info("s1"), [node(msg("u1", "user", "原始问题"), [node(msg("a1", "assistant", "答"))])]);
  const { labelEntry, node: rep, skipped } = compressChain(chain);
  assert.equal(labelEntry.id, "u1");
  assert.equal(rep.entry.id, "a1");
  assert.equal(skipped, 2);
});

test("compressChain labels a projected chain by its preview but selects its representative", () => {
  const representative = {
    entry: msg("a1", "assistant", "回答"),
    children: [],
    compressedEntryIds: ["u1"],
    branchPreview: { role: "user", text: "原始问题" },
  };
  const chain = node(info("s1"), [representative]);
  const { branchPreview, node: rep, skipped } = compressChain(chain);
  assert.deepEqual(branchPreview, { role: "user", text: "原始问题" });
  assert.equal(rep.entry.id, "a1");
  assert.equal(skipped, 2);
});

test("compressChain falls back to the chain end when no message entry exists", () => {
  const chain = node(info("s1"), [node(info("s2"))]);
  const { labelEntry } = compressChain(chain);
  assert.equal(labelEntry.id, "s2");
});

test("selectTopLevelBranches returns all roots for multi-root trees", () => {
  const r1 = node(msg("u1", "user", "第一问"));
  const r2 = node(msg("u1b", "user", "第一问改"));
  assert.deepEqual(selectTopLevelBranches([r1, r2]).map((n) => n.entry.id), ["u1", "u1b"]);
});

test("selectTopLevelBranches returns children of the first branching node", () => {
  const b1 = node(msg("u2", "user", "分支一"));
  const b2 = node(msg("u2b", "user", "分支二"));
  const root = node(msg("u1", "user", "第一问"), [node(msg("a1", "assistant", "答"), [b1, b2])]);
  assert.deepEqual(selectTopLevelBranches([root]).map((n) => n.entry.id), ["u2", "u2b"]);
});

test("selectTopLevelBranches returns empty for a linear session", () => {
  const root = node(msg("u1", "user", "第一问"), [node(msg("a1", "assistant", "答"))]);
  assert.deepEqual(selectTopLevelBranches([root]), []);
});

test("selectTopLevelBranches works on preview-only server projections", () => {
  const arm1 = {
    entry: msg("a2", "assistant", "答一"),
    children: [],
    compressedEntryIds: ["s1", "u2"],
    branchPreview: { role: "user", text: "分支一" },
  };
  const arm2 = {
    entry: msg("a2b", "assistant", "答二"),
    children: [],
    compressedEntryIds: ["u2b"],
    branchPreview: { role: "user", text: "分支二" },
  };
  const branchPoint = { entry: msg("a1", "assistant", "答"), children: [arm1, arm2] };
  const root = { entry: msg("u1", "user", "第一问"), children: [branchPoint] };
  const topLevel = selectTopLevelBranches([root]);
  assert.deepEqual(topLevel.map((n) => n.entry.id), ["a2", "a2b"]);
  assert.deepEqual(compressChain(topLevel[0]).branchPreview, { role: "user", text: "分支一" });
  assert.equal(compressChain(topLevel[0]).node.entry.id, "a2");
});

test("multi-root metadata chains use their user previews and assistant representatives", () => {
  const r1 = node(model("m1"), [{
    entry: msg("a1", "assistant", "回答一"),
    children: [],
    compressedEntryIds: ["u1"],
    branchPreview: { role: "user", text: "第一问" },
  }]);
  const r2 = node(info("s2"), [{
    entry: msg("a2", "assistant", "回答二"),
    children: [],
    compressedEntryIds: ["u2"],
    branchPreview: { role: "user", text: "第二问" },
  }]);
  const topLevel = selectTopLevelBranches([r1, r2]);
  assert.deepEqual(topLevel.map((n) => compressChain(n).branchPreview.text), ["第一问", "第二问"]);
  assert.deepEqual(topLevel.map((n) => compressChain(n).node.entry.id), ["a1", "a2"]);
});

// --- #509 regression: recursive tree consumption overflowed the stack on a
// linear session (depth == entry count). The iterative rewrite must survive a
// chain far deeper than V8's call-stack limit.

// Build a linear chain of `n` nodes (each child is the previous one).
function linearTree(n) {
  const nodes = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const entry = { type: "message", id: `e${i}`, parentId: prev, timestamp: "t", message: { role: "user", content: `m${i}` } };
    nodes.push({ entry, children: [] });
    if (prev) nodes[nodes.length - 2].children = [nodes[nodes.length - 1]];
    prev = `e${i}`;
  }
  return nodes[0];
}

test("buildActivePath finds the leaf on a 6000-deep linear chain without a stack overflow", () => {
  const root = linearTree(6000);
  const path = buildActivePath([root], "e5999");
  assert.equal(path.size, 6000);
  assert.ok(path.has("e0"));
  assert.ok(path.has("e5999"));
});

test("hasBranch reports false for a linear chain (no branching) and true otherwise", () => {
  assert.equal(hasBranch([linearTree(5000)]), false);
  const root = linearTree(3);
  root.children[0].children[0].children = [
    { entry: { type: "message", id: "b1", parentId: "e2", timestamp: "t", message: { role: "user", content: "x" } }, children: [] },
    { entry: { type: "message", id: "b2", parentId: "e2", timestamp: "t", message: { role: "user", content: "y" } }, children: [] },
  ];
  assert.equal(hasBranch([root]), true);
  assert.equal(hasBranch([root]), true);
});

test("hasBranch reports true for multiple root nodes (a branch from the first message)", () => {
  // Each root has a single child, so no node.children.length > 1 — only the
  // multiple-root shape makes this a branch.
  const r1 = { entry: { type: "message", id: "r1", parentId: null, timestamp: "t", message: { role: "user", content: "a" } }, children: [] };
  const r2 = { entry: { type: "message", id: "r2", parentId: null, timestamp: "t", message: { role: "user", content: "b" } }, children: [] };
  assert.equal(hasBranch([r1, r2]), true);
});
