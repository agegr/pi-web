import assert from "node:assert/strict";
import test from "node:test";

const { MAX_PROJECTED_TREE_DEPTH, projectTreeForResponse } = await import("./project-tree.ts");

const msg = (id, role, content) => ({ type: "message", id, parentId: null, timestamp: "t", message: { role, content } });
const info = (id) => ({ type: "session_info", id, parentId: null, timestamp: "t", name: "x" });
const model = (id) => ({ type: "model_change", id, parentId: null, timestamp: "t", provider: "test", modelId: "test" });
const node = (entry, children = []) => ({ entry, children });

function findProjectedNode(nodes, id) {
  const pending = [...nodes];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current.entry.id === id) return current;
    pending.push(...current.children);
  }
  return undefined;
}

test("attaches the first branch message preview to the contracted representative", () => {
  const arm1Leaf = node(msg("a2", "assistant", "答一"));
  const arm1 = node(info("s1"), [node(msg("u2", "user", [
    { type: "text", text: "分支一的问题" },
    { type: "image", data: "base64-secret", mimeType: "image/png" },
  ]), [arm1Leaf])]);
  const arm2 = node(msg("u2b", "user", "分支二的问题"), [node(msg("a2b", "assistant", "答二"))]);
  const a1 = node(msg("a1", "assistant", "答"), [arm1, arm2]);
  const root = node(msg("u1", "user", "第一问"), [a1]);

  const [projectedRoot] = projectTreeForResponse([root]);
  const projectedA1 = projectedRoot.children[0];
  assert.equal(projectedA1.entry.id, "a1");
  assert.equal(projectedA1.children[0].entry.id, "a2");
  assert.deepEqual(projectedA1.children[0].compressedEntryIds, ["s1", "u2"]);
  assert.deepEqual(projectedA1.children[0].branchPreview, { role: "user", text: "分支一的问题" });
  assert.equal(projectedA1.children[1].entry.id, "a2b");
  assert.deepEqual(projectedA1.children[1].compressedEntryIds, ["u2b"]);
  assert.deepEqual(projectedA1.children[1].branchPreview, { role: "user", text: "分支二的问题" });
  assert.equal(JSON.stringify(projectedRoot).includes("base64-secret"), false);
});

test("does not copy thinking or tool payloads from a compressed assistant label source", () => {
  const assistant = node(msg("a1", "assistant", [
    { type: "thinking", thinking: "thinking-secret" },
    { type: "text", text: "可见回答" },
    { type: "toolCall", id: "tc1", name: "read", arguments: { value: "tool-secret" } },
  ]), [node(info("leaf1"))]);
  const sibling = node(msg("u2", "user", "另一个分支"), [node(info("leaf2"))]);
  const projected = projectTreeForResponse([node(info("root"), [assistant, sibling])]);
  const leaf = findProjectedNode(projected, "leaf1");

  assert.deepEqual(leaf.branchPreview, { role: "assistant", text: "可见回答" });
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes("thinking-secret"), false);
  assert.equal(serialized.includes("tool-secret"), false);
});

test("carries previews through non-message roots in multi-root trees", () => {
  const root1 = node(model("m1"), [node(msg("u1", "user", "第一个问题"), [node(msg("a1", "assistant", "回答一"))])]);
  const root2 = node(info("s2"), [node(msg("u2", "user", "第二个问题"), [node(msg("a2", "assistant", "回答二"))])]);
  const projected = projectTreeForResponse([root1, root2]);

  assert.deepEqual(projected[0].children[0].branchPreview, { role: "user", text: "第一个问题" });
  assert.deepEqual(projected[1].children[0].branchPreview, { role: "user", text: "第二个问题" });
  assert.deepEqual(projected[0].children[0].compressedEntryIds, ["u1"]);
  assert.deepEqual(projected[1].children[0].compressedEntryIds, ["u2"]);
});

test("normalizes and bounds preview text and labels image-only messages", () => {
  const longText = `  第一行\n\n第二行 ${"x".repeat(80)}`;
  const textArm = node(msg("u1", "user", longText), [node(info("leaf1"))]);
  const imageArm = node(msg("u2", "user", [{ type: "image", data: "secret-image", mimeType: "image/png" }]), [node(info("leaf2"))]);
  const projected = projectTreeForResponse([node(info("root"), [textArm, imageArm])]);
  const textPreview = findProjectedNode(projected, "leaf1").branchPreview;
  const imagePreview = findProjectedNode(projected, "leaf2").branchPreview;

  assert.equal(textPreview.text.startsWith("第一行 第二行 "), true);
  assert.equal(textPreview.text.length, 41);
  assert.equal(textPreview.text.endsWith("…"), true);
  assert.deepEqual(imagePreview, { role: "user", text: "[image]" });
  assert.equal(JSON.stringify(projected).includes("secret-image"), false);
});

test("does not copy unknown message roles into previews", () => {
  const unknownRole = `unknown-role-${"x".repeat(80)}`;
  const arm = node(msg("m1", unknownRole, "可见内容"), [node(info("leaf1"))]);
  const sibling = node(msg("u2", "user", "另一个分支"), [node(info("leaf2"))]);
  const projected = projectTreeForResponse([node(info("root"), [arm, sibling])]);
  const preview = findProjectedNode(projected, "leaf1").branchPreview;

  assert.deepEqual(preview, { text: "可见内容" });
  assert.equal(JSON.stringify(projected).includes("unknown-role-"), false);
});

test("carries previews through the depth-limit flattening path", () => {
  let deepArm = node(info("prefix"), [node(msg("deep-user", "user", "深层问题"), [node(info("deep-leaf"))])]);
  for (let i = 0; i < MAX_PROJECTED_TREE_DEPTH + 2; i++) {
    deepArm = node(info(`branch-${i}`), [deepArm, node(info(`side-${i}`))]);
  }

  const projected = projectTreeForResponse([deepArm]);
  const leaf = findProjectedNode(projected, "deep-leaf");
  assert.deepEqual(leaf.branchPreview, { role: "user", text: "深层问题" });
  assert.deepEqual(leaf.compressedEntryIds, ["prefix", "deep-user"]);
  assert.equal(findProjectedNode(projected, "deep-user"), undefined);
});

test("linear sessions still project to root + leaf only", () => {
  const root = node(msg("u1", "user", "第一问"), [node(msg("a1", "assistant", "答"))]);
  const [projected] = projectTreeForResponse([root]);
  assert.equal(projected.entry.id, "u1");
  assert.equal(projected.children.length, 1);
  assert.equal(projected.children[0].entry.id, "a1");
});
