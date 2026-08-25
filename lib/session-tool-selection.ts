import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { PRESET_FULL } from "./tool-presets";
import type { SessionEntry } from "./types";

export const TOOL_SELECTION_TYPE = "pi-web:tool-selection";

export interface SessionToolSelectionData {
  version: 1;
  tools: string[];
}

const BUILTIN_TOOL_NAMES = new Set(PRESET_FULL);

function parseToolSelectionData(data: unknown): string[] | undefined {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const candidate = data as { version?: unknown; tools?: unknown };
  if (
    candidate.version !== 1
    || !Array.isArray(candidate.tools)
    || candidate.tools.some((tool) => typeof tool !== "string" || !BUILTIN_TOOL_NAMES.has(tool))
  ) return undefined;
  return [...new Set(candidate.tools as string[])];
}

/** Return the newest valid persisted selection. Undefined identifies legacy sessions. */
export function readSessionToolSelection(entries: readonly SessionEntry[]): string[] | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== TOOL_SELECTION_TYPE) continue;
    const tools = parseToolSelectionData(entry.data);
    if (tools !== undefined) return tools;
  }
  return undefined;
}

export function validateSessionToolSelection(tools: unknown): string[] {
  const parsed = parseToolSelectionData({ version: 1, tools });
  if (parsed === undefined) {
    throw new Error("toolNames must contain only built-in tool names");
  }
  return parsed;
}

export function appendSessionToolSelection(
  sessionManager: SessionManager,
  tools: readonly string[],
): void {
  sessionManager.appendCustomEntry(TOOL_SELECTION_TYPE, {
    version: 1,
    tools: [...tools],
  } satisfies SessionToolSelectionData);
}
