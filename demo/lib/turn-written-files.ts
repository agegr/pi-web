import type { AssistantContentBlock, ToolResultMessage } from "./types";
import { resolveLocalFilePath } from "./file-links";
import { isApplyPatchToolName, isEditToolName, isWriteToolName } from "./tool-names";
import {
  applyPatchPreviewToFiles,
  applyPatchResultHasFailures,
  getApplyPatchAppliedFiles,
  getApplyPatchInputText,
  parseApplyPatchInput,
} from "./apply-patch";
import type { SplitDiffFile } from "./patch";

export interface WrittenFile {
  /** Resolved absolute path of a file this turn wrote. */
  filePath: string;
}

function isFileWritingToolName(toolName: string): boolean {
  return isWriteToolName(toolName) || isEditToolName(toolName);
}

function readToolPath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const value = input.file_path ?? input.path;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function writtenPathsFromFiles(files: SplitDiffFile[] | null): string[] {
  if (!files) return [];
  // Deletes have no newPath — they are not files this turn wrote.
  return files
    .map((file) => file.newPath)
    .filter((filePath): filePath is string => typeof filePath === "string" && filePath.length > 0);
}

function collectApplyPatchDeletePaths(input: Record<string, unknown> | undefined, details: unknown): Set<string> {
  const deleted = new Set<string>();
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const preview = (details as Record<string, unknown>).preview;
    if (preview && typeof preview === "object" && !Array.isArray(preview)) {
      const files = (preview as Record<string, unknown>).files;
      if (Array.isArray(files)) {
        for (const raw of files) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
          const entry = raw as { operation?: unknown; filePath?: unknown };
          if (entry.operation === "delete" && typeof entry.filePath === "string" && entry.filePath.length > 0) {
            deleted.add(entry.filePath);
          }
        }
      }
    }
  }
  for (const match of getApplyPatchInputText(input).matchAll(/^\*\*\* Delete File: (.+)$/gm)) {
    const filePath = (match[1] ?? "").trim();
    if (filePath) deleted.add(filePath);
  }
  return deleted;
}

/**
 * Collect the paths one apply_patch call actually wrote.
 *
 * Prefers `details.result.appliedFiles` (what landed, including rename
 * targets). Falls back to the applied-result preview, then the patch
 * document. Deletes are omitted — they are not files this turn wrote.
 * A returned failure with no `appliedFiles` writes nothing.
 */
function readApplyPatchPaths(input: Record<string, unknown> | undefined, result: ToolResultMessage | undefined): string[] {
  const details = result?.details;
  const deleted = collectApplyPatchDeletePaths(input, details);
  const applied = getApplyPatchAppliedFiles(details);
  if (applied) return applied.filter((filePath) => !deleted.has(filePath));
  if (applyPatchResultHasFailures(details)) return [];

  if (details && typeof details === "object" && !Array.isArray(details)) {
    const fromPreview = writtenPathsFromFiles(applyPatchPreviewToFiles((details as Record<string, unknown>).preview));
    if (fromPreview.length > 0) return fromPreview;
  }
  return writtenPathsFromFiles(parseApplyPatchInput(getApplyPatchInputText(input)));
}

/**
 * Collect the distinct files a single assistant turn actually wrote.
 *
 * Every entry is derived from a `write`/`edit`/`apply_patch` tool call whose
 * result arrived and did not error — never from the reply text. A path the
 * assistant merely mentions in prose is not evidence that any file was
 * touched, so it is not a source here; the tool call is the record of what
 * happened.
 *
 * Paths are resolved against `cwd`, deduped, and kept in first-seen order.
 */
export function extractTurnWrittenFiles(
  content: AssistantContentBlock[],
  toolResults: Map<string, ToolResultMessage> | undefined,
  cwd?: string,
): WrittenFile[] {
  const seen = new Set<string>();
  const writtenFiles: WrittenFile[] = [];

  for (const block of content) {
    if (block.type !== "toolCall") continue;
    if (!isFileWritingToolName(block.toolName) && !isApplyPatchToolName(block.toolName)) continue;

    const result = toolResults?.get(block.toolCallId);
    if (!result || result.isError) continue;

    const rawPaths = isApplyPatchToolName(block.toolName)
      ? readApplyPatchPaths(block.input, result)
      : [readToolPath(block.input)];

    for (const rawPath of rawPaths) {
      if (!rawPath) continue;

      // Tool arguments are filesystem paths, not hrefs: preserve characters such
      // as #, ?, and :digits that have special meaning in links and source refs.
      const filePath = resolveLocalFilePath(rawPath, cwd);
      if (!filePath) continue;

      if (seen.has(filePath)) continue;
      seen.add(filePath);
      writtenFiles.push({ filePath });
    }
  }

  return writtenFiles;
}
