/**
 * Rendering support for Codex-style `apply_patch` tools (e.g. the
 * pi-apply-patch extension).
 *
 * Two data sources describe what such a call changed, and neither is a
 * standard unified diff:
 *
 * 1. The tool call input — a freeform V4A patch document that may contain
 *    several file operations in one call:
 *
 *    *** Begin Patch
 *    *** Add File: new.ts
 *    +line
 *    *** Update File: old.ts
 *    *** Move to: renamed.ts
 *    @@ optional context marker
 *     context
 *    -removed
 *    +added
 *    *** Delete File: gone.ts
 *    *** End Patch
 *
 * 2. The tool result `details.preview` — per-file applied diffs whose lines
 *    embed their line number after the +/-/space marker
 *    (`+12 text`, `-3 text`, ` 7 text`), produced by the extension.
 *
 * Both convert into the shared `SplitDiffFile[]` model from ./patch so they
 * render through the same split diff view as the built-in edit tool.
 */

import type { SplitDiffCell, SplitDiffFile, SplitDiffRow } from "./patch";

export interface ApplyPatchPreviewFile {
  filePath?: string;
  movePath?: string;
  operation?: string;
  diff?: string;
}

/** Extract the file paths targeted by a V4A patch document, in order. */
export function extractApplyPatchPaths(patchText: string): string[] {
  const paths: string[] = [];
  for (const match of patchText.matchAll(/^\*\*\* (?:Add|Delete|Update) File: (.+)$/gm)) {
    const filePath = (match[1] ?? "").trim();
    if (filePath && !paths.includes(filePath)) paths.push(filePath);
  }
  return paths;
}

/** Pull the patch document out of an apply_patch tool call's input. */
export function getApplyPatchInputText(input: unknown, rawInput?: string): string {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const value = (input as Record<string, unknown>).input;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return typeof rawInput === "string" ? rawInput : "";
}

// ── Shared row building ──────────────────────────────────────────────────────

interface RowSink {
  rows: SplitDiffRow[];
  context(text: string, lineNo: number | null): void;
  removed(text: string, lineNo: number | null): void;
  added(text: string, lineNo: number | null): void;
  finish(): void;
}

function createRowSink(): RowSink {
  const rows: SplitDiffRow[] = [];
  let pendingRemoved: SplitDiffCell[] = [];
  let pendingAdded: SplitDiffCell[] = [];

  const emptyCell = (): SplitDiffCell => ({ lineNo: null, text: "", type: "empty" });

  const flushChanges = () => {
    const count = Math.max(pendingRemoved.length, pendingAdded.length);
    for (let i = 0; i < count; i++) {
      rows.push({
        type: "line",
        left: pendingRemoved[i] ?? emptyCell(),
        right: pendingAdded[i] ?? emptyCell(),
      });
    }
    pendingRemoved = [];
    pendingAdded = [];
  };

  return {
    rows,
    context(text, lineNo) {
      flushChanges();
      rows.push({
        type: "line",
        left: { lineNo, text, type: "context" },
        right: { lineNo, text, type: "context" },
      });
    },
    removed(text, lineNo) {
      pendingRemoved.push({ lineNo, text, type: "removed" });
    },
    added(text, lineNo) {
      pendingAdded.push({ lineNo, text, type: "added" });
    },
    finish() {
      flushChanges();
      // Drop files whose body produced no renderable line (e.g. an empty
      // Add section while streaming) — mutate in place, callers already hold
      // a reference to this array.
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].type !== "line") rows.splice(i, 1);
      }
    },
  };
}

// ── Source 1: V4A patch document (tool call input) ───────────────────────────

/**
 * Parse a V4A patch document into split diff files. Tolerant of truncated
 * input (streaming) — complete operations parsed so far are returned.
 */
export function parseApplyPatchInput(patchText: string): SplitDiffFile[] | null {
  if (!patchText.includes("*** Begin Patch") && !/\*\*\* (?:Add|Delete|Update) File: /.test(patchText)) {
    return null;
  }

  const files: SplitDiffFile[] = [];
  let sink: RowSink | null = null;
  let current: SplitDiffFile | null = null;
  // "add" / "delete" bodies carry bare content lines; "update" bodies carry
  // prefixed ones. Tracked so unprefixed lines land on the correct side.
  let operation: "add" | "delete" | "update" | null = null;

  for (const rawLine of patchText.split(/\r?\n/)) {
    const header = rawLine.match(/^\*\*\* (Add|Delete|Update) File: (.+)$/);
    if (header) {
      const op = (header[1]?.toLowerCase() ?? "update") as "add" | "delete" | "update";
      const filePath = (header[2] ?? "").trim();
      sink?.finish();
      operation = op;
      sink = createRowSink();
      current = {
        oldPath: op === "add" ? undefined : filePath,
        newPath: op === "delete" ? undefined : filePath,
        rows: sink.rows,
      };
      files.push(current);
      continue;
    }

    if (/^\*\*\* Move to: /.test(rawLine)) {
      const movePath = rawLine.replace(/^\*\*\* Move to: /, "").trim();
      if (current && operation === "update") current.newPath = movePath;
      continue;
    }

    if (!sink || !current) continue;
    const body: RowSink = sink;
    if (rawLine.startsWith("*** ")) continue; // Begin/End Patch markers
    if (operation === "update" && rawLine.startsWith("@@")) continue; // hunk context markers carry no line numbers here

    if (operation === "update") {
      const prefix = rawLine[0];
      const content = rawLine.slice(1);
      if (prefix === "+") body.added(content, null);
      else if (prefix === "-") body.removed(content, null);
      else if (prefix === " ") body.context(content, null);
      else if (rawLine !== "") body.context(rawLine, null); // defensive: unprefixed context
    } else if (operation === "add") {
      if (rawLine === "") continue;
      sink.added(rawLine.startsWith("+") ? rawLine.slice(1) : rawLine, null);
    } else if (operation === "delete") {
      if (rawLine === "") continue;
      sink.removed(rawLine.startsWith("-") ? rawLine.slice(1) : rawLine, null);
    }
  }
  sink?.finish();

  const parsed = files.filter((file) => file.rows.length > 0);
  return parsed.length > 0 ? parsed : null;
}

// ── Source 2: applied result preview (details.preview) ───────────────────────

/**
 * Convert the extension's applied-result preview into split diff files.
 * Its per-file `diff` lines look like `+12 text` / `-3 text` / `␣7 text`
 * with real line numbers, so those are preserved.
 */
export function applyPatchPreviewToFiles(preview: unknown): SplitDiffFile[] | null {
  if (!preview || typeof preview !== "object" || Array.isArray(preview)) return null;
  const rawFiles = (preview as Record<string, unknown>).files;
  if (!Array.isArray(rawFiles)) return null;

  const files: SplitDiffFile[] = [];
  for (const rawFile of rawFiles) {
    if (!rawFile || typeof rawFile !== "object" || Array.isArray(rawFile)) continue;
    const entry = rawFile as ApplyPatchPreviewFile;
    if (typeof entry.filePath !== "string" || typeof entry.diff !== "string") continue;

    const sink = createRowSink();
    for (const line of entry.diff.split(/\r?\n/)) {
      const match = line.match(/^([+\- ])\s*(\d+) (.*)$/);
      if (!match) continue;
      const [, marker, num, text] = match;
      const lineNo = Number(num);
      if (marker === "+") sink.added(text, lineNo);
      else if (marker === "-") sink.removed(text, lineNo);
      else sink.context(text, lineNo);
    }
    sink.finish();

    const isAdd = entry.operation === "add";
    const isDelete = entry.operation === "delete";
    files.push({
      oldPath: isAdd ? undefined : entry.filePath,
      newPath: isDelete ? undefined : (entry.movePath ?? entry.filePath),
      rows: sink.rows,
    });
  }

  const parsed = files.filter((file) => file.rows.length > 0);
  return parsed.length > 0 ? parsed : null;
}
