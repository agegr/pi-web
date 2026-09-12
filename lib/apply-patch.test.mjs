import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  applyPatchPreviewToFiles,
  extractApplyPatchPaths,
  getApplyPatchInputText,
  parseApplyPatchInput,
} = await jiti.import("./apply-patch.ts");

test("extractApplyPatchPaths lists every file operation in order, deduped", () => {
  const patch = [
    "*** Begin Patch",
    "*** Add File: a.ts",
    "+x",
    "*** Update File: b.ts",
    "-y",
    "+z",
    "*** Delete File: a.ts",
    "*** End Patch",
  ].join("\n");
  assert.deepEqual(extractApplyPatchPaths(patch), ["a.ts", "b.ts"]);
});

test("getApplyPatchInputText prefers the structured input field", () => {
  assert.equal(getApplyPatchInputText({ input: "patch" }, '{"input": "raw'), "patch");
  assert.equal(getApplyPatchInputText(undefined, "raw"), "raw");
  assert.equal(getApplyPatchInputText(null), "");
});

test("parseApplyPatchInput handles add, delete, and update with move in one call", () => {
  const patch = [
    "*** Begin Patch",
    "*** Add File: a.ts",
    "+hello",
    "*** Delete File: b.ts",
    "-old one",
    "*** Update File: c.ts",
    "*** Move to: d.ts",
    "@@ marker text is ignored",
    " ctx",
    "-x",
    "+y",
    "*** End Patch",
  ].join("\n");

  const files = parseApplyPatchInput(patch);
  assert.equal(files.length, 3);

  const [add, del, update] = files;
  assert.deepEqual(add, {
    oldPath: undefined,
    newPath: "a.ts",
    rows: [{ type: "line", left: { lineNo: null, text: "", type: "empty" }, right: { lineNo: null, text: "hello", type: "added" } }],
  });
  assert.equal(del.oldPath, "b.ts");
  assert.equal(del.newPath, undefined);
  assert.equal(update.oldPath, "c.ts");
  assert.equal(update.newPath, "d.ts");
  assert.deepEqual(
    update.rows.map((row) => [row.left.type, row.right.type]),
    [["context", "context"], ["removed", "added"]],
  );
});

test("parseApplyPatchInput tolerates truncated streaming input and rejects non-patches", () => {
  const partial = "*** Begin Patch\n*** Update File: e.ts\n@@\n-a\n+b\n*** Update File: f.ts\n@@\n-";
  const files = parseApplyPatchInput(partial);
  assert.equal(files.length, 2);
  assert.equal(files[0].oldPath, "e.ts");

  assert.equal(parseApplyPatchInput(""), null);
  assert.equal(parseApplyPatchInput('{"input": "not a patch'), null);
});

test("applyPatchPreviewToFiles converts the extension result preview with real line numbers", () => {
  const preview = {
    added: 1,
    removed: 1,
    files: [
      {
        filePath: "src/app.ts",
        operation: "update",
        diff: '   1 keep\n-  10 old line\n+  10 new line\n   11 tail',
      },
      { filePath: "new.ts", operation: "add", diff: "+  1 first" },
      { filePath: "gone.ts", operation: "delete", diff: "-  1 bye" },
    ],
  };

  const files = applyPatchPreviewToFiles(preview);
  assert.equal(files.length, 3);

  const [update, add, del] = files;
  assert.equal(update.oldPath, "src/app.ts");
  assert.deepEqual(
    update.rows.map((row) => [row.left.lineNo, row.left.type, row.right.type, row.right.lineNo]),
    [[1, "context", "context", 1], [10, "removed", "added", 10], [11, "context", "context", 11]],
  );
  assert.equal(update.rows[1].left.text, "old line");
  assert.equal(update.rows[1].right.text, "new line");

  assert.equal(add.oldPath, undefined);
  assert.equal(add.newPath, "new.ts");

  assert.equal(del.oldPath, "gone.ts");
  assert.equal(del.newPath, undefined);
});

test("applyPatchPreviewToFiles keeps move targets and rejects malformed previews", () => {
  const files = applyPatchPreviewToFiles({
    files: [{ filePath: "old.ts", movePath: "renamed.ts", operation: "update", diff: "  1 same" }],
  });
  assert.equal(files[0].newPath, "renamed.ts");

  assert.equal(applyPatchPreviewToFiles(null), null);
  assert.equal(applyPatchPreviewToFiles({}), null);
  assert.equal(applyPatchPreviewToFiles({ files: ["nope"] }), null);
});
