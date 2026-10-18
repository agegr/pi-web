import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./patch.ts");
}

test("parses paired changes into split diff rows", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const files = parseUnifiedPatch(`--- a/demo.ts
+++ b/demo.ts
@@ -10,3 +10,3 @@
 const keep = true;
-const value = "old";
+const value = "new";
 done();
`);

  assert.equal(files?.length, 1);
  assert.equal(files?.[0].oldPath, "a/demo.ts");
  assert.equal(files?.[0].newPath, "b/demo.ts");
  assert.deepEqual(files?.[0].rows.filter((row) => row.type === "line"), [
    {
      type: "line",
      left: { lineNo: 10, text: "const keep = true;", type: "context" },
      right: { lineNo: 10, text: "const keep = true;", type: "context" },
    },
    {
      type: "line",
      left: { lineNo: 11, text: 'const value = "old";', type: "removed" },
      right: { lineNo: 11, text: 'const value = "new";', type: "added" },
    },
    {
      type: "line",
      left: { lineNo: 12, text: "done();", type: "context" },
      right: { lineNo: 12, text: "done();", type: "context" },
    },
  ]);
});

test("pads one-sided additions and removes timestamp suffixes from file paths", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const files = parseUnifiedPatch(`--- a/demo.ts\t2026-01-01
+++ b/demo.ts\t2026-01-02
@@ -1,1 +1,2 @@
 first
+second
`);

  assert.equal(files?.[0].oldPath, "a/demo.ts");
  assert.equal(files?.[0].newPath, "b/demo.ts");
  assert.deepEqual(files?.[0].rows.at(-1), {
    type: "line",
    left: { lineNo: null, text: "", type: "empty" },
    right: { lineNo: 2, text: "second", type: "added" },
  });
});

test("treats in-hunk lines that look like file headers as content", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  // The added line's content starts with "++ " and the removed line's with
  // "-- ", so the raw diff lines are "+++ ..." and "--- ...". They must be
  // parsed as one file's added/removed content, not as new file headers.
  const files = parseUnifiedPatch(`--- a/notes.md
+++ b/notes.md
@@ -1,2 +1,2 @@
-- old bullet
++ new bullet
 tail
`);

  assert.equal(files?.length, 1);
  assert.equal(files?.[0].newPath, "b/notes.md");
  const lines = files?.[0].rows.filter((row) => row.type === "line");
  assert.deepEqual(lines?.[0], {
    type: "line",
    left: { lineNo: 1, text: "- old bullet", type: "removed" },
    right: { lineNo: 1, text: "+ new bullet", type: "added" },
  });
  assert.deepEqual(lines?.[1], {
    type: "line",
    left: { lineNo: 2, text: "tail", type: "context" },
    right: { lineNo: 2, text: "tail", type: "context" },
  });
});

test("parses multiple files, resuming header detection after each hunk", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const files = parseUnifiedPatch(`--- a/one.ts
+++ b/one.ts
@@ -1 +1 @@
-a
+b
--- a/two.ts
+++ b/two.ts
@@ -1 +1 @@
-c
+d
`);

  assert.equal(files?.length, 2);
  assert.equal(files?.[0].newPath, "b/one.ts");
  assert.equal(files?.[1].newPath, "b/two.ts");
});

test("returns null for text without diff lines", async () => {
  const { parseUnifiedPatch } = await loadSubject();

  assert.equal(parseUnifiedPatch("not a patch"), null);
});

test("a file's rows flatten to one column in patch order", async () => {
  const { parseUnifiedPatch, unifiedDiffLines } = await loadSubject();
  const files = parseUnifiedPatch(`--- a/demo.ts
+++ b/demo.ts
@@ -10,3 +10,4 @@
 const keep = true;
-const value = "old";
+const value = "new";
+const extra = 1;
 done();
`);

  assert.deepEqual(unifiedDiffLines(files[0]), [
    { type: "context", text: "const keep = true;", oldLineNo: 10, newLineNo: 10 },
    { type: "removed", text: 'const value = "old";', oldLineNo: 11, newLineNo: null },
    { type: "added", text: 'const value = "new";', oldLineNo: null, newLineNo: 11 },
    { type: "added", text: "const extra = 1;", oldLineNo: null, newLineNo: 12 },
    { type: "context", text: "done();", oldLineNo: 12, newLineNo: 13 },
  ]);
});

test("a single column drops the hunk headers and the padding of a one-sided change", async () => {
  const { parseUnifiedPatch, unifiedDiffLines } = await loadSubject();
  const files = parseUnifiedPatch(`--- a/demo.ts
+++ b/demo.ts
@@ -1,1 +1,2 @@
 first
+second
@@ -40,1 +41,1 @@
-older
+newer
`);

  const lines = unifiedDiffLines(files[0]);
  assert.deepEqual(lines.map((line) => line.text), ["first", "second", "older", "newer"]);
  assert.deepEqual(lines.map((line) => line.type), ["context", "added", "removed", "added"]);
  // No padded empty row sits where the split view leaves a blank half-row.
  assert.equal(lines.filter((line) => line.text === "").length, 0);
});
