import type { AssistantContentBlock, ToolResultMessage } from "./types";
import { resolveLocalFileHref } from "./file-links";

export interface TurnArtifact {
  /** Resolved absolute path of a file produced this turn. */
  filePath: string;
}

function isWriteToolName(toolName: string): boolean {
  return toolName.toLowerCase() === "write";
}

function isEditToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return (
    name === "edit" ||
    name.startsWith("edit_") ||
    name.endsWith(".edit") ||
    name.endsWith("_edit") ||
    name.includes("str_replace") ||
    name.includes("replace_editor")
  );
}

function isArtifactToolName(toolName: string): boolean {
  return isWriteToolName(toolName) || isEditToolName(toolName);
}

function readToolPath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const value = input.file_path ?? input.path;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Collect the distinct files a single assistant turn successfully produced.
 *
 * Iterates the turn's `toolCall` blocks, keeps `write`/`edit` calls whose
 * result exists and did not error, resolves each path against `cwd`, dedupes
 * by absolute path, and preserves first-seen order.
 */
export function extractTurnArtifacts(
  content: AssistantContentBlock[],
  toolResults: Map<string, ToolResultMessage> | undefined,
  cwd?: string,
): TurnArtifact[] {
  const seen = new Set<string>();
  const artifacts: TurnArtifact[] = [];

  for (const block of content) {
    if (block.type !== "toolCall") continue;
    if (!isArtifactToolName(block.toolName)) continue;

    const result = toolResults?.get(block.toolCallId);
    if (!result || result.isError) continue;

    const rawPath = readToolPath(block.input);
    if (!rawPath) continue;

    // resolveLocalFileHref's isPathInside check applies only to RELATIVE candidates;
    // absolute paths pass through — actual access is gated by the backend
    // isFilePathAllowed (app/api/files/[...path]/route.ts), same as bare-path links.
    const filePath = resolveLocalFileHref(rawPath, cwd);
    if (!filePath) continue;

    if (seen.has(filePath)) continue;
    seen.add(filePath);
    artifacts.push({ filePath });
  }

  return artifacts;
}
