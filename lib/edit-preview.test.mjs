import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  EDIT_PREVIEW_MAX_LINE_CHARS,
  EDIT_PREVIEW_MAX_ROWS,
  editPreviewEdits,
  editPreviewFile,
} = await jiti.import("./edit-preview.ts");

/** Rows as short strings: "ctx a", "-a +b", "gap 3", "gap ?". */
function shape(file) {
  return file.rows.map((row) => {
    if (row.type === "gap") return `gap ${row.count ?? "?"}`;
    if (row.type === "hunk") return `hunk ${row.text}`;
    if (row.left.type === "context") return `ctx ${row.left.text}`;
    const left = row.left.type === "removed" ? `-${row.left.text}` : "";
    const right = row.right.type === "added" ? `+${row.right.text}` : "";
    return [left, right].filter(Boolean).join(" ");
  });
}

test("editPreviewEdits reads edits as pi's prepareEditArguments does", () => {
  const edit = { oldText: "a", newText: "b" };
  assert.deepEqual(editPreviewEdits({ path: "f", edits: [edit] }), [edit]);
  assert.deepEqual(editPreviewEdits({ path: "f", edits: JSON.stringify([edit]) }), [edit]);
  assert.deepEqual(editPreviewEdits({ path: "f", edits: JSON.stringify(edit) }), [edit]);
  assert.deepEqual(editPreviewEdits({ path: "f", edits: edit }), [edit]);
  assert.deepEqual(editPreviewEdits({ path: "f", oldText: "x", newText: "y" }), [{ oldText: "x", newText: "y" }]);
  assert.deepEqual(
    editPreviewEdits({ path: "f", edits: [edit], oldText: "x", newText: "y" }),
    [edit, { oldText: "x", newText: "y" }],
  );
});

test("editPreviewEdits refuses input with no complete edit", () => {
  assert.equal(editPreviewEdits(null), null);
  assert.equal(editPreviewEdits("text"), null);
  assert.equal(editPreviewEdits({ path: "f" }), null);
  assert.equal(editPreviewEdits({ path: "f", edits: [] }), null);
  assert.equal(editPreviewEdits({ path: "f", edits: "[not json" }), null);
  assert.equal(editPreviewEdits({ path: "f", edits: [{ oldText: "a" }] }), null);
  assert.equal(editPreviewEdits({ path: "f", edits: [{ oldText: "a", newText: "b" }, { old_str: "c" }] }), null);
  // Another tool's shape (str_replace_editor) is not guessed at.
  assert.equal(editPreviewFile({ path: "f", old_str: "a", new_str: "b" }), null);
});

test("each edit is a hunk: removed lines paired with added ones, gaps between edits", () => {
  const file = editPreviewFile({
    path: "src/a.ts",
    edits: [
      { oldText: "one\ntwo", newText: "uno\ndos\ntres" },
      { oldText: "gone\n", newText: "" },
    ],
  });
  assert.equal(file.newPath, "src/a.ts");
  assert.deepEqual(shape(file), ["-one +uno", "-two +dos", "+tres", "gap ?", "-gone"]);
  for (const row of file.rows) {
    if (row.type === "line") {
      assert.equal(row.left.lineNo, null);
      assert.equal(row.right.lineNo, null);
    }
  }
});

test("lines both texts share at their ends are context, at most 4 next to the change", () => {
  const head = ["h1", "h2", "h3", "h4", "h5", "h6"];
  const tail = ["t1", "t2", "t3", "t4", "t5"];
  const file = editPreviewFile({
    path: "f",
    oldText: [...head, "old", ...tail].join("\n"),
    newText: [...head, "new", ...tail].join("\n"),
  });
  assert.deepEqual(shape(file), [
    "gap 2", "ctx h3", "ctx h4", "ctx h5", "ctx h6",
    "-old +new",
    "ctx t1", "ctx t2", "ctx t3", "ctx t4", "gap 1",
  ]);
});

test("a gap ending one edit and the gap before the next stay one row", () => {
  const file = editPreviewFile({
    path: "f",
    edits: [
      { oldText: "a\nb\nc\nd\ne\nf\nx", newText: "a\nb\nc\nd\ne\nf\ny" },
      { oldText: "p\nq\nr\ns\nt\nu", newText: "P\nq\nr\ns\nt\nu" },
    ],
  });
  assert.deepEqual(shape(file), [
    "gap 2", "ctx c", "ctx d", "ctx e", "ctx f", "-x +y",
    "gap ?",
    "-p +P", "ctx q", "ctx r", "ctx s", "ctx t", "gap 1",
  ]);
});

test("huge texts are capped in rows and line length", () => {
  const many = Array.from({ length: EDIT_PREVIEW_MAX_ROWS * 3 }, (_, i) => `line ${i}`).join("\n");
  const file = editPreviewFile({ path: "f", edits: [{ oldText: many, newText: "x" }, { oldText: "y", newText: "z" }] });
  const lines = file.rows.filter((row) => row.type === "line");
  assert.equal(lines.length, EDIT_PREVIEW_MAX_ROWS);
  assert.deepEqual(file.rows.at(-1), { type: "gap", count: null });

  const long = "x".repeat(EDIT_PREVIEW_MAX_LINE_CHARS * 10);
  const wide = editPreviewFile({ path: "f", oldText: "a", newText: long });
  assert.equal(wide.rows[0].right.text.length, EDIT_PREVIEW_MAX_LINE_CHARS + 1);
  assert.ok(wide.rows[0].right.text.endsWith("…"));

  const surrogate = "x".repeat(EDIT_PREVIEW_MAX_LINE_CHARS - 1) + "😀" + "y";
  const cut = editPreviewFile({ path: "f", oldText: "a", newText: surrogate }).rows[0].right.text;
  assert.equal(cut, "x".repeat(EDIT_PREVIEW_MAX_LINE_CHARS - 1) + "…");
});

test("a line break added or removed at the end is a change, not a shared line", () => {
  assert.deepEqual(shape(editPreviewFile({ path: "f", oldText: "foo();\n", newText: "foo();" })), ["-foo(); +foo();"]);
  assert.deepEqual(shape(editPreviewFile({ path: "f", oldText: "a\nfoo();", newText: "a\nfoo();\n" })), ["ctx a", "-foo(); +foo();"]);
  // The line that keeps its break is still shared; only the new last line is added.
  assert.deepEqual(shape(editPreviewFile({ path: "f", oldText: "foo\n", newText: "foo\nbar" })), ["ctx foo", "+bar"]);
  // Both ending in a break, or neither: the last line is shared.
  assert.deepEqual(shape(editPreviewFile({ path: "f", oldText: "x\nend\n", newText: "y\nend\n" })), ["-x +y", "ctx end"]);
});

test("CRLF texts split into the same lines as LF ones", () => {
  const file = editPreviewFile({ path: "f", oldText: "a\r\nb\r\n", newText: "a\r\nc\r\n" });
  assert.deepEqual(shape(file), ["ctx a", "-b +c"]);
});
