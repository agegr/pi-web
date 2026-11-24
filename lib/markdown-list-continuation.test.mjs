import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getMarkdownListContinuation, getMarkdownListIndentEdit } = await createJiti(import.meta.url).import("./markdown-list-continuation.ts");

// "|" marks the caret. Returns the text and caret after the line break, or null
// when the textarea should insert a plain newline.
function breakLine(input) {
  const caret = input.indexOf("|");
  const value = input.slice(0, caret) + input.slice(caret + 1);
  const edit = getMarkdownListContinuation(value, caret, caret);
  if (!edit) return null;
  const next = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
  const nextCaret = edit.start + edit.text.length;
  return next.slice(0, nextCaret) + "|" + next.slice(nextCaret);
}

// "|" marks the caret. Returns the text and caret after Tab, or null when the
// textarea should keep its native focus move.
function pressTab(input, direction = "indent") {
  const caret = input.indexOf("|");
  const value = input.slice(0, caret) + input.slice(caret + 1);
  const edit = getMarkdownListIndentEdit(value, caret, caret, direction);
  if (!edit) return null;
  const next = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
  return `${next.slice(0, edit.selectionStart)}|${next.slice(edit.selectionStart)}`;
}

// "[…]" marks a selection; returns the new text with "[" and "]" around it.
function pressTabOnSelection(input, direction) {
  const start = input.indexOf("[");
  const rest = input.slice(0, start) + input.slice(start + 1);
  const end = rest.indexOf("]");
  const value = rest.slice(0, end) + rest.slice(end + 1);
  const edit = getMarkdownListIndentEdit(value, start, end, direction);
  if (!edit) return null;
  const next = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
  return `${next.slice(0, edit.selectionStart)}[${next.slice(edit.selectionStart, edit.selectionEnd)}]${next.slice(edit.selectionEnd)}`;
}

test("continues ordered lists with the next number and the same delimiter", () => {
  assert.equal(breakLine("1. first|"), "1. first\n2. |");
  assert.equal(breakLine("1) first|"), "1) first\n2) |");
  assert.equal(breakLine("9. ninth|"), "9. ninth\n10. |");
  assert.equal(breakLine("09. ninth|"), "09. ninth\n10. |");
  assert.equal(breakLine("1.  wide gap|"), "1.  wide gap\n2.  |");
});

test("continues Chinese enumerations with or without a following space", () => {
  assert.equal(breakLine("1、第一项|"), "1、第一项\n2、|");
  assert.equal(breakLine("1、 第一项|"), "1、 第一项\n2、 |");
  assert.equal(breakLine("2020、2021年都有更新|"), null);
});

test("continues bullet and task lists", () => {
  assert.equal(breakLine("- apple|"), "- apple\n- |");
  assert.equal(breakLine("* apple|"), "* apple\n* |");
  assert.equal(breakLine("+ apple|"), "+ apple\n+ |");
  assert.equal(breakLine("- [x] done|"), "- [x] done\n- [ ] |");
  assert.equal(breakLine("- [ ] todo|"), "- [ ] todo\n- [ ] |");
  assert.equal(breakLine("1. [X] done|"), "1. [X] done\n2. [ ] |");
});

test("keeps nested indentation and only reads the caret's line", () => {
  assert.equal(breakLine("1. parent\n   - child|"), "1. parent\n   - child\n   - |");
  assert.equal(breakLine("- a\n\t2. tabbed|"), "- a\n\t2. tabbed\n\t3. |");
  assert.equal(breakLine("1. one|\n2. two"), "1. one\n2. |\n2. two");
});

test("moves text after the caret into the new item", () => {
  assert.equal(breakLine("1. first|second"), "1. first\n2. |second");
});

test("an empty item ends the list instead of adding another marker", () => {
  assert.equal(breakLine("1. first\n2. |"), "1. first\n|");
  assert.equal(breakLine("- a\n- |"), "- a\n|");
  assert.equal(breakLine("- a\n- [ ] |"), "- a\n|");
  assert.equal(breakLine("- a\n- [ ]|"), "- a\n|");
  assert.equal(breakLine("- a\n  -   |\nnext"), "- a\n|\nnext");
  assert.equal(breakLine("1、第一项\n2、|"), "1、第一项\n|");
});

test("leaves ordinary lines and non-list syntax to the native newline", () => {
  for (const input of [
    "plain text|",
    "-no space|",
    "**bold**|",
    "1.5 meters|",
    "2024.|",
    "---|",
    "* * *|",
    "- - -|",
    "#1. heading|",
    "",
  ]) {
    assert.equal(breakLine(input.includes("|") ? input : "|"), null, input);
  }
});

test("does not continue when the caret is inside the marker or before it", () => {
  assert.equal(breakLine("|1. first"), null);
  assert.equal(breakLine("1.| first"), null);
  assert.equal(breakLine("  |- nested"), null);
});

test("does not continue list-looking lines inside fenced code", () => {
  assert.equal(breakLine("```\n- not a list|"), null);
  assert.equal(breakLine("~~~md\n1. not a list|"), null);
  assert.equal(breakLine("````\n```\n- still code|"), null);
  assert.equal(breakLine("```\ncode\n```\n- list|"), "```\ncode\n```\n- list\n- |");
});

test("leaves selections to the native newline", () => {
  assert.equal(getMarkdownListContinuation("1. first", 3, 8), null);
});

test("Tab nests a list item one level, aligned under the item above", () => {
  assert.equal(pressTab("1. parent\n2. child|"), "1. parent\n   1. child|");
  assert.equal(pressTab("- parent\n- child|"), "- parent\n  - child|");
  assert.equal(pressTab("1) parent\n2) child|"), "1) parent\n   1) child|");
  assert.equal(pressTab("1、父项\n2、子项|"), "1、父项\n  1、子项|");
  assert.equal(pressTab("- a\n- [ ] b|"), "- a\n  - [ ] b|");
  assert.equal(pressTab("- a\n\t- b|"), "- a\n\t\t- b|");
});

test("Tab indents from anywhere in the item, including its marker", () => {
  assert.equal(pressTab("1.| first"), "   1.| first");
  assert.equal(pressTab("|- item"), "  |- item");
});

test("Shift+Tab moves an item back under the item above it", () => {
  assert.equal(pressTab("- a\n  - b\n    - c|", "outdent"), "- a\n  - b\n  - c|");
  assert.equal(pressTab("  - a|", "outdent"), "- a|");
  assert.equal(pressTab("- a|", "outdent"), null);
});

test("indenting an ordered list numbers the nested list from 1", () => {
  assert.equal(pressTab("1. a\n2. b|"), "1. a\n   1. b|");
  assert.equal(pressTab("1. a\n   1. b\n   2. c|"), "1. a\n   1. b\n      1. c|");
  assert.equal(pressTab("09. a\n10. b|"), "09. a\n    01. b|");
  assert.equal(pressTab("- a\n2. b|"), "- a\n  1. b|");
  // A parent whose marker is wider than this item's decides the columns.
  assert.equal(pressTab("1. a\n   - x\n1. b|"), "1. a\n   - x\n   1. b|");
  // Prose above ends the list, so there the item's own marker sets the width.
  assert.equal(pressTab("intro\n2. b|"), "intro\n   1. b|");
});

test("outdenting an ordered list counts on from the list above it", () => {
  assert.equal(pressTab("1. a\n   1. b|", "outdent"), "1. a\n2. b|");
  assert.equal(pressTab("1. a\n   1. b\n   2. c|", "outdent"), "1. a\n   1. b\n2. c|");
  assert.equal(pressTab("9. a\n   9. b|", "outdent"), "9. a\n10. b|");
  assert.equal(pressTab("   - bullet|", "outdent"), "- bullet|");
});

test("Tab edits every list item the selection touches", () => {
  assert.equal(pressTabOnSelection("[1. a\n1. b]", "indent"), "   [1. a\n   1. b]");
  assert.equal(pressTabOnSelection("[1. a\n   1. b]", "outdent"), "[1. a\n2. b]");
  assert.equal(pressTabOnSelection("[2. b\n3. c]", "indent"), "   [1. b\n   2. c]");
});

test("a selection ending at a line start leaves that line alone", () => {
  assert.equal(pressTabOnSelection("[1. a\n1. b]\nplain", "indent"), "   [1. a\n   1. b]\nplain");
});

test("a selection keeps the lines it covered", () => {
  const input = "[1. a\n1. b]";
  const start = input.indexOf("[");
  const rest = input.slice(0, start) + input.slice(start + 1);
  const end = rest.indexOf("]");
  const value = rest.slice(0, end) + rest.slice(end + 1);
  const edit = getMarkdownListIndentEdit(value, start, end, "indent");
  const next = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
  const selected = next.slice(edit.selectionStart, edit.selectionEnd);
  // The indentation grows inside the block; the lines the selection covers do not change.
  assert.deepEqual(
    selected.split("\n").map((line) => line.trimStart()),
    value.slice(start, end).split("\n"),
  );
});

test("Tab leaves everything that is not a list item to the native focus move", () => {
  for (const input of ["plain text|", "1.5 meters|", "2024.|", "---|", "# heading|", "|"]) {
    assert.equal(pressTab(input), null, input);
  }
  assert.equal(pressTabOnSelection("[- a\nplain]", "indent"), null);
});

test("Tab ignores list-looking lines inside fenced code", () => {
  assert.equal(pressTab("```\n- not a list|"), null);
  assert.equal(pressTab("```\ncode\n```\n- list|"), "```\ncode\n```\n  - list|");
});
