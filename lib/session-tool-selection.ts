import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { PRESET_FULL } from "./tool-presets";
import type { SessionEntry } from "./types";

export const TOOL_SELECTION_TYPE = "pi-web:tool-selection";

export interface SessionToolSelectionData {
  version: 1;
  tools: string[];
}

/**
 * Written when the user returns a session to pi's configured defaults. The session
 * log is append-only, so an earlier pin can only be retracted by a later entry that
 * says so; without it the newest pin would win forever (#700).
 */
export interface ClearedSessionToolSelectionData {
  version: 1;
  cleared: true;
}

const BUILTIN_TOOL_NAMES = new Set(PRESET_FULL);
const CLEARED = Symbol("cleared-tool-selection");

function parseToolSelectionData(data: unknown): string[] | typeof CLEARED | undefined {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const candidate = data as { version?: unknown; tools?: unknown; cleared?: unknown };
  if (candidate.version !== 1) return undefined;
  if (candidate.cleared === true) return CLEARED;
  if (
    !Array.isArray(candidate.tools)
    || candidate.tools.some((tool) => typeof tool !== "string" || !BUILTIN_TOOL_NAMES.has(tool))
  ) return undefined;
  return [...new Set(candidate.tools as string[])];
}

/**
 * Return the newest valid persisted selection. Undefined means the session carries no
 * selection of its own - legacy sessions, sessions created without an override, and
 * sessions explicitly returned to the configured defaults all resolve that way.
 */
export function readSessionToolSelection(entries: readonly SessionEntry[]): string[] | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== TOOL_SELECTION_TYPE) continue;
    const tools = parseToolSelectionData(entry.data);
    if (tools === undefined) continue;
    return tools === CLEARED ? undefined : tools;
  }
  return undefined;
}

export function validateSessionToolSelection(tools: unknown): string[] {
  const parsed = parseToolSelectionData({ version: 1, tools });
  if (parsed === undefined || parsed === CLEARED) {
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

/** Retract any earlier pin so the session follows settings.json defaultTools again. */
export function appendClearedSessionToolSelection(sessionManager: SessionManager): void {
  sessionManager.appendCustomEntry(TOOL_SELECTION_TYPE, {
    version: 1,
    cleared: true,
  } satisfies ClearedSessionToolSelectionData);
}
