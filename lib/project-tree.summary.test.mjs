import assert from "node:assert/strict";
import test from "node:test";

const { toSummaryTree } = await import("./project-tree.ts");

const msg = (id, parentId, content) => ({
  type: "message",
  id,
  parentId,
  timestamp: "2026-01-01T00:00:00.000Z",
  message: { role: "user", content },
});
const node = (entry, children = []) => ({ entry, children });

test("summary tree keeps navigation fields and bounded previews only", () => {
  const secret = "A".repeat(2 * 1024 * 1024);
  const projected = [
    node(msg("u1", null, "第一问"), [
      {
        ...node(msg("u2", "u1", [{ type: "image", data: secret, mimeType: "image/png" }]), [
          node(msg("a2", "u2", "答二")),
        ]),
        compressedEntryIds: ["u2"],
        branchPreview: { role: "user", text: "分支预览" },
      },
      node(msg("u2b", "u1", "分支二")),
    ]),
  ];

  const summary = toSummaryTree(projected);
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(secret), false, "image payload must not leak");
  assert.equal(serialized.includes("第一问"), false, "body text must not leak");
  assert.equal(serialized.includes("分支预览"), true, "bounded preview is kept");

  const root = summary[0];
  assert.deepEqual(root.entry, {
    id: "u1",
    parentId: null,
    type: "message",
    timestamp: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(root.children[0].branchPreview, { role: "user", text: "分支预览" });
  assert.deepEqual(root.children[0].compressedEntryIds, ["u2"]);
  assert.equal(root.children[0].children[0].entry.id, "a2");
  assert.equal(root.children[0].children[0].entry.parentId, "u2");
  assert.equal(root.children[1].entry.id, "u2b");
});

test("summary tree serializes small even for deep trees", () => {
  // A pathological 3000-level chain. Production projection compresses linear
  // chains before this runs, but the summary walker itself must not recurse:
  // neither its own stack nor the server's JSON.stringify budget can assume
  // bounded depth.
  let deep = node(msg("leaf", "n2998", "deep"));
  for (let i = 2998; i >= 0; i--) deep = node(msg(`n${i}`, i ? `n${i - 1}` : null, `body ${i}`), [deep]);
  const summary = toSummaryTree([deep]);

  // Iterative walk: every node carries only navigation fields, and per-node
  // serialization stays tiny (sum avoids JSON.stringify's own recursion limit
  // on deeply nested structures).
  let count = 0;
  let bytes = 0;
  const stack = [...summary];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;;
    count += 1;
    assert.equal("message" in current, false);
    assert.deepEqual(Object.keys(current.entry).sort(), ["id", "parentId", "timestamp", "type"]);
    // Serialize a shallow copy: stringify on the node itself would recurse
    // through children and hit the same depth limit we are testing against.
    const { children, ...shallow } = current;
    bytes += JSON.stringify({ ...shallow, children: children.length }).length;
    stack.push(...children);
  }
  assert.equal(count, 3000);
  assert.ok(bytes < 1000_000, `summary too large: ${bytes} bytes`);
});
