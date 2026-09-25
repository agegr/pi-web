/**
 * Pinned-group expansion state, persisted across reloads per the confirmed
 * product decision (wi body: 展开状态记住到 localStorage). Stored as a JSON
 * array of project keys under "pi-web:sidebar-pinned-expanded"; absent or
 * corrupt values read as the empty set. Keys of projects that were later
 * unpinned are harmless — a re-pin simply finds its old expansion state
 * again — but the delete path in the sidebar now actively discards the
 * removed group's key (wi pi#52) so no stale reference survives.
 *
 * Extracted from components/SessionSidebar.tsx (wi pi#52) so the read/write/
 * discard rules live in ONE storage-injectable, DOM-free implementation the
 * node --test suites can drive. Every accessor re-reads storage (no module
 * cache), mirroring lib/custom-directories.ts; unavailable storage degrades
 * to the empty set and never throws.
 *
 * Accordion note (carried over from the sidebar): the single expanded key
 * is persisted as-is, so legacy multi-key storage written by the pre-accordion version
 * simply collapses on the first expand action (no migration path).
 */

export const PINNED_EXPANDED_STORAGE_KEY = "pi-web:sidebar-pinned-expanded";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The persisted expanded-group key set; absent/corrupt storage reads as empty. */
export function readExpandedGroupKeys(
  storage: StorageLike | null = getBrowserStorage(),
): ReadonlySet<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(PINNED_EXPANDED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((key): key is string => typeof key === "string"));
  } catch {
    return new Set();
  }
}

/** Persist the expanded-group key set (best-effort; never throws). */
export function writeExpandedGroupKeys(
  keys: ReadonlySet<string>,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(PINNED_EXPANDED_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

/**
 * Drop one group key from the persisted expansion set (wi pi#52): after a
 * listed directory is deleted, its accordion key must not survive in
 * storage. Under the accordion model the set holds at most one key, so
 * discarding the expanded group's key leaves the empty set. A key that is
 * not present is a no-op; corrupt storage degrades to nothing-written.
 */
export function discardExpandedGroupKey(
  key: string,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    const current = readExpandedGroupKeys(storage);
    if (!current.has(key)) return;
    const next = new Set(current);
    next.delete(key);
    writeExpandedGroupKeys(next, storage);
  } catch {
    // ignore
  }
}
