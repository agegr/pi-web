/**
 * Per-browser choice of the minimap's lock toggle: while locked, hovering the
 * minimap does not open the turn preview. ChatWindow remounts per session, so
 * the choice lives here rather than in component state. Falls back to
 * unlocked (`lib/browser-flag.ts`).
 */

import { loadBrowserFlag, saveBrowserFlag, type FlagStorage } from "./browser-flag";

const STORAGE_KEY = "pi-web:minimap-preview-locked";

export function loadMinimapPreviewLocked(storage?: FlagStorage | null): boolean {
  return loadBrowserFlag(STORAGE_KEY, storage);
}

export function saveMinimapPreviewLocked(locked: boolean, storage?: FlagStorage | null): void {
  saveBrowserFlag(STORAGE_KEY, locked, storage);
}
