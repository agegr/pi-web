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

test("marks the unchanged lines left out between hunks, from their headers", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const files = parseUnifiedPatch(`--- a/demo.ts
+++ b/demo.ts
@@ -3,3 +3,3 @@
 a
-b
+B
 c
@@ -20,3 +20,4 @@
 x
+y
 z
 w
@@ -23,2 +24,2 @@
-p
+P
 q
--- a/two.ts
+++ b/two.ts
@@ -50,1 +50,1 @@
-m
+M
`);

  const kinds = (file) => file.rows
    .filter((row) => row.type !== "hunk")
    .map((row) => (row.type === "gap" ? `gap ${row.count}` : "line"));
  // None before the first hunk (lines 1-2 are not shown either), none between
  // the contiguous second and third hunks, none carried into the next file.
  assert.deepEqual(kinds(files[0]), ["line", "line", "line", "gap 14", "line", "line", "line", "line", "line", "line"]);
  assert.deepEqual(kinds(files[1]), ["line"]);
});

test("counts gaps around hunks with an empty side", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  // --unified=0: "-5,0 +6,2" inserts after old line 5, "-9,2 +10,0" deletes
  // after new line 10.
  const files = parseUnifiedPatch(`--- a/demo.ts
+++ b/demo.ts
@@ -2 +2 @@
-a
+A
@@ -5,0 +6,2 @@
+n1
+n2
@@ -9,2 +10,0 @@
-d1
-d2
@@ -13 +13 @@
-e
+E
`);

  assert.deepEqual(files[0].rows.filter((row) => row.type === "gap"), [
    { type: "gap", count: 3 },
    { type: "gap", count: 3 },
    { type: "gap", count: 2 },
  ]);
});

test("labels a gap's count in the UI language", async () => {
  const { diffGapLabel } = await loadSubject();
  const t = (key, params) => `${key}${params ? JSON.stringify(params) : ""}`;

  assert.equal(diffGapLabel(1, t), "diff.unchangedLine");
  assert.equal(diffGapLabel(7, t), 'diff.unchangedLines{"count":7}');
});
