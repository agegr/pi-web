/**
 * Browser-persisted preference for how thinking blocks are rendered.
 * "card" — bordered panel with a thinking icon (default).
 * "minimal" — unobtrusive italic text, no card chrome.
 */

export type ThinkingStyle = "card" | "minimal";

const STORAGE_KEY = "pi-thinking-style";

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

export function isThinkingStyle(value: unknown): value is ThinkingStyle {
  return value === "card" || value === "minimal";
}

export function getPreferredThinkingStyle(
  storage: StorageLike | null = getBrowserStorage(),
): ThinkingStyle {
  if (!storage) return "card";
  try {
    const value = storage.getItem(STORAGE_KEY);
    return isThinkingStyle(value) ? value : "card";
  } catch {
    return "card";
  }
}

export function setPreferredThinkingStyle(
  style: ThinkingStyle,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, style);
  } catch {
    // Browser storage is best-effort.
  }
}
