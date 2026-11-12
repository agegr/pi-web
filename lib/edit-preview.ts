import type { SplitDiffCell, SplitDiffFile, SplitDiffRow } from "./patch";

/**
 * A diff preview of an `edit` call built from its arguments alone, for the
 * card while the call waits for its result (#1625). pi's TUI does the same in
 * `renderCall` once the arguments are complete (`computeEditsDiff()`), but it
 * reads the file; the browser cannot, so each edit is a hunk of its own
 * without line numbers: its oldText's lines removed, its newText's added.
 * Lines the two texts share at their start and end are context, of which at
 * most EDIT_PREVIEW_CONTEXT_LINES next to the change are shown, as pi's own
 * diff keeps 4 (`generateDiffString()`); the rest is a gap row.
 */

export const EDIT_PREVIEW_CONTEXT_LINES = 4;
/** Line rows the preview draws at most; a gap row stands for the rest. */
export const EDIT_PREVIEW_MAX_ROWS = 1000;
/** UTF-16 units of one line shown; a longer line ends in an ellipsis. */
export const EDIT_PREVIEW_MAX_LINE_CHARS = 4000;

interface EditPair {
  oldText: string;
  newText: string;
}

function isEditPair(value: unknown): value is EditPair {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const edit = value as Record<string, unknown>;
  return typeof edit.oldText === "string" && typeof edit.newText === "string";
}

/**
 * The call's edits as pi's `prepareEditArguments()` reads them: `edits` as an
 * array, a JSON string of one, or a single edit object, plus the legacy
 * top-level `oldText` / `newText`. Null unless there is at least one and every
 * one has string oldText and newText, as the TUI's preview requires.
 */
export function editPreviewEdits(input: unknown): EditPair[] | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const args = input as Record<string, unknown>;
  let edits: unknown = args.edits;
  if (typeof edits === "string") {
    try {
      const parsed: unknown = JSON.parse(edits);
      edits = isEditPair(parsed) ? [parsed] : parsed;
    } catch {
      // Left as it was: pi's validation refuses it, unless legacy fields stand in.
    }
  } else if (isEditPair(edits)) {
    edits = [edits];
  }
  const list: unknown[] = Array.isArray(edits) ? [...edits] : [];
  if (typeof args.oldText === "string" && typeof args.newText === "string") {
    list.push({ oldText: args.oldText, newText: args.newText });
  }
  if (list.length === 0 || !list.every(isEditPair)) return null;
  return list as EditPair[];
}

interface TextLines {
  lines: string[];
  /** Whether the last line ends in a line break; every other line does. */
  lastEnded: boolean;
}

function textLines(text: string): TextLines {
  if (text === "") return { lines: [], lastEnded: false };
  const lines = text.split(/\r\n|\r|\n/);
  // A text ending in a line break has no line after it.
  const lastEnded = lines.length > 1 && lines[lines.length - 1] === "";
  if (lastEnded) lines.pop();
  return { lines, lastEnded };
}

/**
 * Line i of one text and line j of the other are shared when their text and
 * their line break match: `foo();` with a break and without is a change.
 */
function sameLine(a: TextLines, i: number, b: TextLines, j: number): boolean {
  if (a.lines[i] !== b.lines[j]) return false;
  const aEnded = i < a.lines.length - 1 || a.lastEnded;
  const bEnded = j < b.lines.length - 1 || b.lastEnded;
  return aEnded === bEnded;
}

function clipLine(text: string): string {
  if (text.length <= EDIT_PREVIEW_MAX_LINE_CHARS) return text;
  let end = EDIT_PREVIEW_MAX_LINE_CHARS;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return `${text.slice(0, end)}…`;
}

const emptyCell = (): SplitDiffCell => ({ lineNo: null, text: "", type: "empty" });

/** The preview as one file of split rows, the shape a result's patch parses to; null when the input holds no edits. */
export function editPreviewFile(input: unknown): SplitDiffFile | null {
  const edits = editPreviewEdits(input);
  if (!edits) return null;
  const args = input as Record<string, unknown>;
  const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : undefined;

  const rows: SplitDiffRow[] = [];
  let lineRows = 0;
  let full = false;
  const pushGap = (count: number | null) => {
    const last = rows[rows.length - 1];
    if (last?.type === "gap") {
      last.count = last.count === null || count === null ? null : last.count + count;
    } else {
      rows.push({ type: "gap", count });
    }
  };
  const pushLine = (left: SplitDiffCell, right: SplitDiffCell): boolean => {
    if (lineRows >= EDIT_PREVIEW_MAX_ROWS) {
      if (!full) pushGap(null);
      full = true;
      return false;
    }
    rows.push({ type: "line", left, right });
    lineRows++;
    return true;
  };
  const pushContext = (text: string) => {
    const cell: SplitDiffCell = { lineNo: null, text: clipLine(text), type: "context" };
    return pushLine(cell, { ...cell });
  };

  for (const [index, edit] of edits.entries()) {
    if (full) break;
    // Edits are separate places in the file, how far apart unknown.
    if (index > 0) pushGap(null);
    const oldText = textLines(edit.oldText);
    const newText = textLines(edit.newText);
    const oldLines = oldText.lines;
    const newLines = newText.lines;
    let start = 0;
    while (start < oldLines.length && start < newLines.length && sameLine(oldText, start, newText, start)) start++;
    let oldEnd = oldLines.length;
    let newEnd = newLines.length;
    while (oldEnd > start && newEnd > start && sameLine(oldText, oldEnd - 1, newText, newEnd - 1)) {
      oldEnd--;
      newEnd--;
    }

    const leadingHidden = Math.max(0, start - EDIT_PREVIEW_CONTEXT_LINES);
    if (leadingHidden > 0) pushGap(leadingHidden);
    for (let i = leadingHidden; i < start && pushContext(oldLines[i]); i++);

    const changed = Math.max(oldEnd - start, newEnd - start);
    for (let i = 0; i < changed; i++) {
      const removed = start + i < oldEnd ? oldLines[start + i] : null;
      const added = start + i < newEnd ? newLines[start + i] : null;
      const left: SplitDiffCell = removed === null ? emptyCell() : { lineNo: null, text: clipLine(removed), type: "removed" };
      const right: SplitDiffCell = added === null ? emptyCell() : { lineNo: null, text: clipLine(added), type: "added" };
      if (!pushLine(left, right)) break;
    }

    const trailing = oldLines.length - oldEnd;
    const trailingShown = Math.min(trailing, EDIT_PREVIEW_CONTEXT_LINES);
    for (let i = 0; i < trailingShown && pushContext(oldLines[oldEnd + i]); i++);
    if (!full && trailing > trailingShown) pushGap(trailing - trailingShown);
  }

  if (!rows.some((row) => row.type === "line")) return null;
  return { oldPath: path, newPath: path, rows };
}
