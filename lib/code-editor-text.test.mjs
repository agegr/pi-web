import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { EditorSelection, EditorState, Text } from "@codemirror/state";

const jiti = createJiti(import.meta.url);
const { minimalReplacement, selectedLineRange } = await jiti.import("./code-editor-text.ts");

const doc = (text) => Text.of(text.split("\n"));

function apply(current, next) {
  const change = minimalReplacement(doc(current), doc(next));
  if (!change) return current;
  const state = EditorState.create({ doc: current }).update({ changes: change }).state;
  return { text: state.doc.toString(), change };
}

test("replaces only the span that differs", () => {
  assert.equal(minimalReplacement(doc("same\ntext"), doc("same\ntext")), null);
  const edited = apply("one\ntwo\nthree", "one\n2\nthree");
  assert.equal(edited.text, "one\n2\nthree");
  assert.deepEqual([edited.change.from, edited.change.to], [4, 7]);
  assert.equal(apply("abc", "abcdef").text, "abcdef");
  assert.equal(apply("abcdef", "def").text, "def");
  assert.equal(apply("aaa", "aa").text, "aa");
  assert.equal(apply("", "new\nfile").text, "new\nfile");
});

test("reports the selected lines, leaving out a line the selection only touches", () => {
  const state = (anchor, head) => EditorState.create({
    doc: "one\ntwo\nthree\nfour",
    selection: EditorSelection.single(anchor, head),
  });
  assert.equal(selectedLineRange(state(5, 5)), null);
  assert.deepEqual(selectedLineRange(state(4, 7)), { startLine: 2, endLine: 2 });
  assert.deepEqual(selectedLineRange(state(0, 8)), { startLine: 1, endLine: 2 });
  assert.deepEqual(selectedLineRange(state(0, 9)), { startLine: 1, endLine: 3 });
  assert.deepEqual(selectedLineRange(state(9, 2)), { startLine: 1, endLine: 3 });
});
