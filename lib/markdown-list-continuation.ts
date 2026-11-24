export interface TextareaEdit {
  start: number;
  end: number;
  text: string;
}

/** A Tab edit, with the selection it leaves in the edited value. */
export interface TextareaIndentEdit extends TextareaEdit {
  selectionStart: number;
  selectionEnd: number;
}

interface ListItemPrefix {
  indent: string;
  marker: string;
  number: string | null;
  delimiter: string;
  spacing: string;
  task: boolean;
  length: number;
}

const BULLET_ITEM = /^([ \t]*)([-*+])([ \t]+)(\[[ xX]\](?:[ \t]+|$))?/;
const ORDERED_ITEM = /^([ \t]*)(\d{1,9})([.)])([ \t]+)(\[[ xX]\](?:[ \t]+|$))?/;
// "1、" is the usual way to number lines in Chinese text and is often typed without a space.
// Short numbers keep enumerations such as "2020、2021年" out of the list.
const CJK_ORDERED_ITEM = /^([ \t]*)(\d{1,3})(、)([ \t]*)/;
const THEMATIC_BREAK = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const CODE_FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;

function parseListItemPrefix(line: string): ListItemPrefix | null {
  if (THEMATIC_BREAK.test(line)) return null;
  const bullet = BULLET_ITEM.exec(line);
  if (bullet) {
    return {
      indent: bullet[1],
      marker: bullet[2],
      number: null,
      delimiter: "",
      spacing: bullet[3],
      task: bullet[4] !== undefined,
      length: bullet[0].length,
    };
  }
  const ordered = ORDERED_ITEM.exec(line) ?? CJK_ORDERED_ITEM.exec(line);
  if (!ordered) return null;
  return {
    indent: ordered[1],
    marker: "",
    number: ordered[2],
    delimiter: ordered[3],
    spacing: ordered[4],
    task: ordered[5] !== undefined,
    length: ordered[0].length,
  };
}

function advanceFence(openFence: string | null, line: string): string | null {
  const fence = CODE_FENCE.exec(line)?.[1];
  if (!fence) return openFence;
  if (openFence === null) return fence;
  if (fence[0] === openFence[0] && fence.length >= openFence.length && line.trim() === fence) return null;
  return openFence;
}

function isInsideFencedCode(textBeforeLine: string): boolean {
  return textBeforeLine.split("\n").reduce<string | null>(advanceFence, null) !== null;
}

// Whether each line of a document is inside a fenced code block.
function fencedCodeLines(lines: string[]): boolean[] {
  const inside: boolean[] = [];
  let openFence: string | null = null;
  for (const line of lines) {
    inside.push(openFence !== null);
    openFence = advanceFence(openFence, line);
  }
  return inside;
}

function nextListItemPrefix(item: ListItemPrefix): string {
  const marker = item.number === null
    ? item.marker
    : `${String(Number(item.number) + 1).padStart(item.number.length, "0")}${item.delimiter}`;
  return `${item.indent}${marker}${item.spacing}${item.task ? "[ ] " : ""}`;
}

/**
 * Returns the edit a line break should make in a Markdown list item: start the
 * next item, or clear an empty item so the list ends. Returns null when the
 * line break should be inserted unchanged.
 */
export function getMarkdownListContinuation(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): TextareaEdit | null {
  if (selectionStart !== selectionEnd) return null;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const newlineIndex = value.indexOf("\n", selectionStart);
  const lineEnd = newlineIndex === -1 ? value.length : newlineIndex;
  const line = value.slice(lineStart, lineEnd);
  const item = parseListItemPrefix(line);
  if (!item || selectionStart - lineStart < item.length) return null;
  if (isInsideFencedCode(value.slice(0, lineStart))) return null;
  if (line.slice(item.length).trim() === "") {
    return { start: lineStart, end: lineEnd, text: "" };
  }
  return { start: selectionStart, end: selectionStart, text: `\n${nextListItemPrefix(item)}` };
}

// Columns an item's marker takes before its text starts: the content column a
// nested list has to reach.
function markerWidth(item: ListItemPrefix): number {
  return item.marker.length
    + (item.number ? item.number.length + item.delimiter.length : 0)
    + item.spacing.length;
}

// The item a block nests under: the closest list item above it at its own level.
// Items nested deeper belong to a sibling's subtree, and prose ends the list, so
// above that the block indents by its own marker.
function nestingParent(
  lines: string[],
  blockFirst: number,
  first: ListItemPrefix,
  inCode: boolean[],
): ListItemPrefix | null {
  for (let i = blockFirst - 1; i >= 0; i--) {
    if (inCode[i]) continue;
    if (lines[i].trim() === "") continue;
    const candidate = parseListItemPrefix(lines[i]);
    if (!candidate) return null;
    if (candidate.indent.length <= first.indent.length) return candidate;
  }
  return null;
}

// Zero padding follows the number the user wrote, so "09." counts on as "10.".
function formatListItemNumber(number: number, width: number): string {
  return String(number).padStart(width, "0");
}

// Where an item moves back out to: the indentation of the closest item above it
// that is indented less, or the margin when there is none. Null when the item is
// already at the margin.
function outdentIndent(
  lines: string[],
  index: number,
  item: ListItemPrefix,
  inCode: boolean[],
): string | null {
  if (!item.indent) return null;
  for (let i = index - 1; i >= 0; i--) {
    if (inCode[i]) continue;
    const ancestor = parseListItemPrefix(lines[i]);
    if (ancestor && ancestor.indent.length < item.indent.length) return ancestor.indent;
  }
  return "";
}

// The number an ordered item takes when it moves back out: one past its closest
// sibling above. A bullet there starts a new list and prose ends the old one, so
// both restart the numbering.
function continuingNumber(
  lines: string[],
  index: number,
  indent: number,
  inCode: boolean[],
): number {
  for (let i = index - 1; i >= 0; i--) {
    if (inCode[i]) continue;
    if (lines[i].trim() === "") continue;
    const item = parseListItemPrefix(lines[i]);
    if (!item || item.indent.length < indent) return 1;
    if (item.indent.length > indent) continue;
    return item.number === null ? 1 : Number(item.number) + 1;
  }
  return 1;
}

/**
 * Returns the edit Tab and Shift+Tab should make on the Markdown list items the
 * selection touches: "indent" nests them one level deeper and numbers the nested
 * list from 1, "outdent" moves them back under the item above and counts on from
 * the list there. Every line the selection touches must be a list item, so
 * anywhere else the key keeps its native focus move (null).
 */
export function getMarkdownListIndentEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  direction: "indent" | "outdent",
): TextareaIndentEdit | null {
  const blockStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const lastLineStart = value.lastIndexOf("\n", selectionEnd - 1) + 1;
  const lineBreak = value.indexOf("\n", selectionEnd);
  // A selection that ends at the start of a line does not touch that line.
  let blockEnd = lineBreak === -1 ? value.length : lineBreak;
  if (selectionEnd > selectionStart && lastLineStart === selectionEnd) blockEnd = selectionEnd - 1;

  const blockLines = value.slice(blockStart, blockEnd).split("\n");
  const items = blockLines.map(parseListItemPrefix);
  const first = items[0];
  if (!first) return null;
  const lines = value.split("\n");
  const inCode = fencedCodeLines(lines);
  const blockFirst = value.slice(0, blockStart).split("\n").length - 1;
  if (blockLines.some((_, index) => inCode[blockFirst + index])) return null;
  for (let i = 1; i < blockLines.length; i++) {
    if (blockLines[i].trim() !== "" && !items[i]) return null;
  }

  const parent = nestingParent(lines, blockFirst, first, inCode);
  const width = Math.max(markerWidth(parent ?? first), 2);
  const tabbed = (line: string): boolean => /^[ \t]*\t/.test(line);
  const unit = (parent !== null && tabbed(parent.indent)) || blockLines.some(tabbed)
    ? "\t"
    : " ".repeat(width);
  const indents: (string | null)[] = [];
  const numbers: (number | null)[] = [];
  let counter = 0;
  let previousNumber = 0;
  let edited = false;
  for (let i = 0; i < blockLines.length; i++) {
    const item = items[i];
    if (!item) {
      indents.push(null);
      numbers.push(null);
      counter = 0;
      continue;
    }
    const indent = direction === "indent"
      ? item.indent + unit
      : outdentIndent(lines, blockFirst + i, item, inCode);
    indents.push(indent);
    if (indent !== null) edited = true;
    if (item.number === null) {
      // A bullet breaks the run: an ordered list after it starts at 1 again.
      numbers.push(null);
      counter = 0;
      continue;
    }
    if (direction === "indent") {
      // Renumber the run from 1 while preserving the gaps between its numbers.
      if (counter === 0) {
        counter = 1;
      } else {
        counter += Number(item.number) - previousNumber;
      }
      previousNumber = Number(item.number);
    } else if (indent === null) {
      // The item stays put, but the run after it counts on from its number.
      counter = Number(item.number);
    } else {
      counter = counter === 0
        ? continuingNumber(lines, blockFirst + i, indent.length, inCode)
        : counter + 1;
    }
    numbers.push(counter);
  }
  if (!edited) return null;

  const rewritten = blockLines.map((line, i) => {
    const item = items[i];
    if (!item) return line;
    const indent = indents[i] ?? item.indent;
    const number = numbers[i];
    if (number === null || item.number === null) return `${indent}${line.slice(item.indent.length)}`;
    const renumbered = formatListItemNumber(number, item.number.length);
    return `${indent}${renumbered}${line.slice(item.indent.length + item.number.length)}`;
  });
  const text = rewritten.join("\n");

  // Map the selection onto the rewritten block, so the same lines stay selected.
  const lineOffsets = (block: string[]): number[] => {
    const offsets: number[] = [];
    let offset = blockStart;
    for (const line of block) {
      offsets.push(offset);
      offset += line.length + 1;
    }
    return offsets;
  };
  const oldOffsets = lineOffsets(blockLines);
  const newOffsets = lineOffsets(rewritten);
  const indentShifts = blockLines.map((_, i) => {
    const item = items[i];
    return item ? (indents[i] ?? item.indent).length - item.indent.length : 0;
  });
  const numberShifts = blockLines.map((_, i) => {
    const item = items[i];
    const number = numbers[i];
    if (!item || item.number === null || number === null) return 0;
    return formatListItemNumber(number, item.number.length).length - item.number.length;
  });
  const contentStarts = blockLines.map((_, i) => items[i]?.length ?? 0);
  const map = (position: number): number => {
    if (position >= blockEnd) return blockStart + text.length;
    let index = blockLines.length - 1;
    while (index > 0 && position < oldOffsets[index]) index--;
    const column = position - oldOffsets[index];
    // A renumbered marker can change width; only the text after it moves with it.
    const shift = indentShifts[index] + (column >= contentStarts[index] ? numberShifts[index] : 0);
    return newOffsets[index] + Math.max(column + shift, 0);
  };

  return {
    start: blockStart,
    end: blockEnd,
    text,
    selectionStart: map(selectionStart),
    selectionEnd: map(selectionEnd),
  };
}
