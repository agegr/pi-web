/**
 * Per-browser choice of the Agents strip's lock: while locked, the strip also
 * shows on the main agent of a session that has subagents or side chats, not
 * only while the main chat shows one of them. A view choice like the sidebar's
 * folds, not a setting. Falls back to unlocked (`lib/browser-flag.ts`).
 */

import { loadBrowserFlag, saveBrowserFlag, type FlagStorage } from "./browser-flag";

const STORAGE_KEY = "pi-web:agent-strip-locked";

export function loadAgentStripLocked(storage?: FlagStorage | null): boolean {
  return loadBrowserFlag(STORAGE_KEY, storage);
}

export function saveAgentStripLocked(locked: boolean, storage?: FlagStorage | null): void {
  saveBrowserFlag(STORAGE_KEY, locked, storage);
}
