import assert from "node:assert/strict";
import test from "node:test";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { MarkdownCodec, markdownBlockLineRange, markdownChanges } from "./markdown-editor.ts";

const rich = '---\r\ntitle: Example\r\n---\r\n\r\n# Heading\r\n\r\nSome **bold** and [local](./note.md).\r\n\r\n```mermaid\r\ngraph TD\r\nA-->B\r\n```\r\n\r\n![photo](./test.png)\r\n\r\n| a | b |\r\n| - | - |\r\n| 1 | 2 |\r\n\r\nText $x$ and <b>HTML</b>.\r\n';

test("opening and serializing preserves all original Markdown, including CRLF and unsupported syntax", () => {
  for (const source of [rich, "", "\n\n", "\uFEFF# Title\n", "Title\n=====\n\n* a\n* b\n", "[link][ref]\n\n[ref]: ./local.md\n"]) {
    const codec = new MarkdownCodec();
    assert.equal(codec.serialize(codec.parse(source)), source);
  }
});

test("editing basic text does not rewrite surrounding complex blocks or their whitespace", () => {
  const codec = new MarkdownCodec();
  const doc = codec.parse(rich);
  let heading = 0;
  doc.forEach((node, offset) => { if (node.type.name === "heading") heading = offset + 1; });
  const state = EditorState.create({ doc });
  const edited = state.apply(state.tr.insertText("Edited ", heading));
  assert.equal(codec.serialize(edited.doc), rich.replace("# Heading", "# Edited Heading"));
});

function applyExternal(codec, state, source) {
  const next = codec.parse(source);
  let tr = state.tr.setMeta("addToHistory", false);
  for (const change of markdownChanges(state.doc, next)) tr = tr.replace(change.from, change.to, next.slice(change.start, change.end));
  tr.setDocAttribute("trailing", next.attrs.trailing);
  const result = state.apply(tr);
  assert.ok(result.doc.eq(next), "patch must reproduce incoming document");
  codec.adopt(result.doc, next);
  assert.equal(codec.serialize(result.doc), source);
  return result;
}

test("disjoint external edits preserve the local cursor between them", () => {
  const codec = new MarkdownCodec();
  const doc = codec.parse("# First\n\nKeep typing here\n\nLast\n");
  let pos = 0;
  doc.forEach((node, offset) => { if (node.textContent === "Keep typing here") pos = offset + 6; });
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
  const next = applyExternal(codec, state, "# First changed\n\nKeep typing here\n\nLast changed\n");
  assert.equal(next.selection.$head.parent.textContent, "Keep typing here");
  assert.equal(next.selection.$head.parentOffset, state.selection.$head.parentOffset);
});

test("external changes support structure, inline formatting, empty files and new Markdown spelling", () => {
  for (const [a, b] of [
    ["# Title\n\nbody\n", "## Title\n\nbody\n"],
    ["one\n\ntwo\n", "one\n\ninsert\n\ntwo\n"],
    ["- a\n- b\n", "- a\n- c\n- d\n"],
    ["body\n", "**body**\n"], ["", rich], [rich, ""],
    ["# Title\n", "Title\n=====\n"], ["a\n", "a\r\n"],
  ]) {
    const codec = new MarkdownCodec();
    applyExternal(codec, EditorState.create({ doc: codec.parse(a) }), b);
  }
});

test("undo removes local typing without undoing an external edit", () => {
  const codec = new MarkdownCodec();
  let state = EditorState.create({ doc: codec.parse("first\n\nlast\n"), plugins: [history()] });
  state = state.apply(state.tr.insertText("local ", 1));
  state = applyExternal(codec, state, "local first\n\nexternal last\n");
  assert.ok(undo(state, (tr) => { state = state.apply(tr); }));
  assert.equal(codec.serialize(state.doc), "first\n\nexternal last\n");
});

test("maps rich-text blocks back to their Markdown line range", () => {
  const source = "# Title\n\nFirst paragraph\ncontinues here\n\nSecond paragraph\n";
  assert.deepEqual(markdownBlockLineRange(source, 1, 1), { startLine: 3, endLine: 4 });
  assert.deepEqual(markdownBlockLineRange(source, 0, 2), { startLine: 1, endLine: 6 });
});
