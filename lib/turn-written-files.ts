import type { AssistantContentBlock, ToolResultMessage } from "./types";
import { resolveLocalFilePath } from "./file-links";
import { getFileName } from "./file-paths";
import { TEXT_PREVIEW_MAX_BYTES } from "./file-types";
import { countPatchLineStats } from "./patch";
import { isEditToolName, isWriteToolName } from "./tool-names";

export interface WrittenFile {
  /** Resolved absolute path of a file this turn wrote. */
  filePath: string;
  /** Unified patch for this turn's writes/edits, when one can be derived. */
  patch?: string;
  additions: number;
  deletions: number;
}

function isFileWritingToolName(toolName: string): boolean {
  return isWriteToolName(toolName) || isEditToolName(toolName);
}

function readToolPath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const value = input.file_path ?? input.path;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readToolResultPatch(result: ToolResultMessage): string | null {
  if (!isRecord(result.details)) return null;
  if (typeof result.details.patch === "string" && result.details.patch.length > 0) {
    return result.details.patch;
  }
  if (typeof result.details.diff === "string" && result.details.diff.length > 0) {
    return result.details.diff;
  }
  return null;
}

function createAddedFilePatch(gitPath: string, content: string): string {
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewlineMarker = !hasTrailingNewline && lines.length > 0
    ? "\n\\ No newline at end of file"
    : "";
  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${gitPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    `${body}${noNewlineMarker}`,
  ].join("\n");
}

function readCallPatch(
  toolName: string,
  input: Record<string, unknown> | undefined,
  result: ToolResultMessage,
  displayPath: string,
): string | null {
  const fromResult = readToolResultPatch(result);
  if (fromResult) return fromResult;
  if (!isWriteToolName(toolName)) return null;
  const content = input?.content;
  if (typeof content !== "string") return null;
  if (content.length > TEXT_PREVIEW_MAX_BYTES) return null;
  return createAddedFilePatch(displayPath, content);
}

function appendPatch(existing: string | undefined, next: string | null): string | undefined {
  if (!next) return existing;
  if (!existing) return next;
  return `${existing}\n${next}`;
}

/**
 * Collect the distinct files a single assistant turn actually wrote.
 *
 * Every entry is derived from a `write`/`edit` tool call whose result arrived
 * and did not error — never from the reply text. A path the assistant merely
 * mentions in prose is not evidence that any file was touched, so it is not a
 * source here; the tool call is the record of what happened.
 *
 * Paths are resolved against `cwd`, deduped, and kept in first-seen order.
 * When a patch can be derived from the tool result or write content, it is
 * attached and later calls against the same path are concatenated.
 */
export function extractTurnWrittenFiles(
  content: AssistantContentBlock[],
  toolResults: Map<string, ToolResultMessage> | undefined,
  cwd?: string,
): WrittenFile[] {
  const byPath = new Map<string, WrittenFile>();
  const writtenFiles: WrittenFile[] = [];

  for (const block of content) {
    if (block.type !== "toolCall") continue;
    if (!isFileWritingToolName(block.toolName)) continue;

    // No result yet (still streaming) or the call failed — nothing was written.
    const result = toolResults?.get(block.toolCallId);
    if (!result || result.isError) continue;

    const rawPath = readToolPath(block.input);
    if (!rawPath) continue;

    // Tool arguments are filesystem paths, not hrefs: preserve characters such
    // as #, ?, and :digits that have special meaning in links and source refs.
    const filePath = resolveLocalFilePath(rawPath, cwd);
    if (!filePath) continue;

    let entry = byPath.get(filePath);
    if (!entry) {
      entry = { filePath, additions: 0, deletions: 0 };
      byPath.set(filePath, entry);
      writtenFiles.push(entry);
    }

    const patch = readCallPatch(block.toolName, block.input, result, getFileName(filePath));
    const nextPatch = appendPatch(entry.patch, patch);
    if (nextPatch) {
      entry.patch = nextPatch;
      const stats = countPatchLineStats(nextPatch);
      entry.additions = stats.additions;
      entry.deletions = stats.deletions;
    }
  }

  return writtenFiles;
}
