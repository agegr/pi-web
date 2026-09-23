import type { SessionEntry } from "@/lib/types";

/** Newest `pi-web:tool-selection` pin, as lib/session-tool-selection.ts reads it. */
export function readSessionToolSelectionFromEntries(entries: readonly SessionEntry[]): string[] | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== "pi-web:tool-selection") continue;
    const data = entry.data as { version?: number; tools?: unknown; cleared?: boolean } | undefined;
    if (data?.version !== 1) continue;
    if (data.cleared) return undefined;
    if (Array.isArray(data.tools)) return data.tools as string[];
  }
  return undefined;
}
