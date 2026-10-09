/**
 * Per-browser choice of the minimap's lock toggle: while locked, hovering the
 * minimap does not open the turn preview. ChatWindow remounts per session, so
 * the choice lives here rather than in component state. Best-effort
 * localStorage: privacy mode or quota errors fall back to unlocked.
 */

const STORAGE_KEY = "pi-web:minimap-preview-locked";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadMinimapPreviewLocked(storage: StorageLike | null = getBrowserStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveMinimapPreviewLocked(
  locked: boolean,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, String(locked));
  } catch {
    // Persistence is best-effort.
  }
}
