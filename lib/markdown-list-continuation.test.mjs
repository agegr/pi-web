import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getMarkdownListContinuation } = await createJiti(import.meta.url).import("./markdown-list-continuation.ts");

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
