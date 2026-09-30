export interface TextareaEdit {
  start: number;
  end: number;
  text: string;
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

function isInsideFencedCode(textBeforeLine: string): boolean {
  let openFence: string | null = null;
  for (const line of textBeforeLine.split("\n")) {
    const fence = CODE_FENCE.exec(line)?.[1];
    if (!fence) continue;
    if (openFence === null) {
      openFence = fence;
    } else if (fence[0] === openFence[0] && fence.length >= openFence.length && line.trim() === fence) {
      openFence = null;
    }
  }
  return openFence !== null;
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
