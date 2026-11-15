/**
 * A per-browser on/off choice kept in localStorage under its own key, off
 * unless saved on: the minimap's hover-preview lock, the Agents strip's lock.
 * Best-effort: privacy mode or quota errors fall back to off and never throw.
 */

export interface FlagStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): FlagStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadBrowserFlag(key: string, storage: FlagStorage | null = getBrowserStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(key) === "true";
  } catch {
    return false;
  }
}

export function saveBrowserFlag(key: string, on: boolean, storage: FlagStorage | null = getBrowserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(key, String(on));
  } catch {
    // Persistence is best-effort.
  }
}
