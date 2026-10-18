export type SplitDiffCellType = "context" | "removed" | "added" | "empty";

export interface SplitDiffCell {
  lineNo: number | null;
  text: string;
  type: SplitDiffCellType;
}

export type SplitDiffRow =
  | { type: "hunk"; text: string }
  | { type: "line"; left: SplitDiffCell; right: SplitDiffCell };

export interface SplitDiffFile {
  oldPath?: string;
  newPath?: string;
  rows: SplitDiffRow[];
}

interface PendingChangeLine {
  lineNo: number;
  text: string;
}

export function parseUnifiedPatch(text: string): SplitDiffFile[] | null {
  const files: SplitDiffFile[] = [];
  let current: SplitDiffFile | null = null;
  let pendingOldPath: string | undefined;
  let oldLineNo = 0;
  let newLineNo = 0;
  // Lines still expected in the current hunk body, from the @@ header counts.
  // While either is positive we are inside a hunk, where a line starting with
  // "--- "/"+++ " is a removed/added content line (e.g. "-- x"/"++ x"), not a
  // file header — checking for headers there splits one file into bogus extras.
  let hunkOldRemaining = 0;
  let hunkNewRemaining = 0;
  let removed: PendingChangeLine[] = [];
  let added: PendingChangeLine[] = [];

  const emptyCell = (): SplitDiffCell => ({ lineNo: null, text: "", type: "empty" });
  const flushChanges = () => {
    if (!current) {
      removed = [];
      added = [];
      return;
    }
    const count = Math.max(removed.length, added.length);
    for (let i = 0; i < count; i++) {
      const left = removed[i]
        ? { lineNo: removed[i].lineNo, text: removed[i].text, type: "removed" as const }
        : emptyCell();
      const right = added[i]
        ? { lineNo: added[i].lineNo, text: added[i].text, type: "added" as const }
        : emptyCell();
      current.rows.push({ type: "line", left, right });
    }
    removed = [];
    added = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const insideHunk = hunkOldRemaining > 0 || hunkNewRemaining > 0;

    // File headers only appear between hunks, never inside a hunk body.
    if (!insideHunk) {
      if (line.startsWith("--- ")) {
        flushChanges();
        pendingOldPath = cleanPatchPath(line.slice(4));
        continue;
      }

      if (line.startsWith("+++ ")) {
        flushChanges();
        current = { oldPath: pendingOldPath, newPath: cleanPatchPath(line.slice(4)), rows: [] };
        files.push(current);
        continue;
      }
    }

    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      if (!current) {
        current = { rows: [] };
        files.push(current);
      }
      flushChanges();
      oldLineNo = Number(hunk[1]);
      newLineNo = Number(hunk[3]);
      hunkOldRemaining = hunk[2] === undefined ? 1 : Number(hunk[2]);
      hunkNewRemaining = hunk[4] === undefined ? 1 : Number(hunk[4]);
      current.rows.push({ type: "hunk", text: line });
      continue;
    }

    if (!current) continue;

    if (line.startsWith("\\ ")) {
      flushChanges();
      current.rows.push({ type: "hunk", text: line });
      continue;
    }

    const prefix = line[0];
    const content = line.slice(1);

    if (prefix === " ") {
      flushChanges();
      current.rows.push({
        type: "line",
        left: { lineNo: oldLineNo++, text: content, type: "context" },
        right: { lineNo: newLineNo++, text: content, type: "context" },
      });
      if (hunkOldRemaining > 0) hunkOldRemaining--;
      if (hunkNewRemaining > 0) hunkNewRemaining--;
    } else if (prefix === "-") {
      removed.push({ lineNo: oldLineNo++, text: content });
      if (hunkOldRemaining > 0) hunkOldRemaining--;
    } else if (prefix === "+") {
      added.push({ lineNo: newLineNo++, text: content });
      if (hunkNewRemaining > 0) hunkNewRemaining--;
    } else if (line !== "") {
      flushChanges();
      current.rows.push({ type: "hunk", text: line });
    }
  }

  flushChanges();

  const parsed = files.filter((file) => file.rows.some((row) => row.type === "line"));
  return parsed.length > 0 ? parsed : null;
}

/** One line of a single-column diff: old and new numbering, whichever applies. */
export interface UnifiedDiffLine {
  type: "context" | "removed" | "added";
  text: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

/**
 * One file's rows as a single column. A pair the split view puts side by side
 * becomes its own line in patch order (removed first, then added), and a
 * context row becomes one line instead of two copies of itself. Hunk headers
 * carry no file content, as in the split view.
 */
export function unifiedDiffLines(file: SplitDiffFile): UnifiedDiffLine[] {
  const lines: UnifiedDiffLine[] = [];
  for (const row of file.rows) {
    if (row.type === "hunk") continue;
    if (row.left.type === "context" && row.right.type === "context") {
      lines.push({
        type: "context",
        text: row.right.text,
        oldLineNo: row.left.lineNo,
        newLineNo: row.right.lineNo,
      });
      continue;
    }
    if (row.left.type !== "empty") {
      lines.push({ type: "removed", text: row.left.text, oldLineNo: row.left.lineNo, newLineNo: null });
    }
    if (row.right.type !== "empty") {
      lines.push({ type: "added", text: row.right.text, oldLineNo: null, newLineNo: row.right.lineNo });
    }
  }
  return lines;
}

function cleanPatchPath(path: string): string {
  return path.split("\t")[0].trim();
}
