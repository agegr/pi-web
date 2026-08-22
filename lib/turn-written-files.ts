import type { AssistantContentBlock, ToolResultMessage } from "./types";
import { resolveLocalFilePath } from "./file-links";
import { isApplyPatchToolName, isEditToolName, isWriteToolName } from "./tool-names";
import { applyPatchPreviewToFiles, extractApplyPatchPaths, getApplyPatchInputText } from "./apply-patch";

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

/**
 * Collect the paths targeted by one apply_patch call.
 *
 * Prefers the applied-result preview — it reflects what actually landed on
 * disk, including rename targets. Falls back to parsing the patch document
 * from the call input. A single call may contain several file operations.
 */
function readApplyPatchPaths(input: Record<string, unknown> | undefined, result: ToolResultMessage | undefined): string[] {
  const details = (result as (ToolResultMessage & { details?: unknown }) | undefined)?.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const files = applyPatchPreviewToFiles((details as Record<string, unknown>).preview);
    if (files) {
      const paths = files
        .map((file) => file.newPath ?? file.oldPath)
        .filter((path): path is string => typeof path === "string");
      if (paths.length > 0) return paths;
    }
  }
  return extractApplyPatchPaths(getApplyPatchInputText(input));
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
