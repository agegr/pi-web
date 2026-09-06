/**
 * Browser-persisted preference for how long lines in the split diff view wrap.
 * "wrap" — soft-wrap long lines within each column (default).
 * "nowrap" — keep lines on one row and scroll horizontally.
 */

export type DiffWrapMode = "wrap" | "nowrap";

const STORAGE_KEY = "pi-diff-wrap";

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

export function isDiffWrapMode(value: unknown): value is DiffWrapMode {
  return value === "wrap" || value === "nowrap";
}

export function getPreferredDiffWrap(
  storage: StorageLike | null = getBrowserStorage(),
): DiffWrapMode {
  if (!storage) return "wrap";
  try {
    const value = storage.getItem(STORAGE_KEY);
    return isDiffWrapMode(value) ? value : "wrap";
  } catch {
    return "wrap";
  }
}

export function setPreferredDiffWrap(
  mode: DiffWrapMode,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, mode);
  } catch {
    // Browser storage is best-effort.
  }
}
