/**
 * Projects hidden from the sidebar project picker.
 *
 * The picker lists every directory that has session history — the list is
 * derived from the sessions themselves and has no stored registry to edit. That
 * made a stale entry expensive to remove: the only lever was deleting the
 * project's sessions, so a single visit to a temporary directory could cost
 * real history that had nothing to do with the clutter.
 *
 * Hiding removes the entry and keeps every session on disk, so it is always
 * reversible from the picker's hidden-projects footer.
 *
 * Entries are the session's stable project identity (`projectKey` — case- and
 * separator-insensitive on Windows), the same key the picker groups by, so all
 * worktrees and path spellings of one repository hide together.
 *
 * Stored in localStorage; best-effort (silently ignored when unavailable). This
 * is deliberately a per-browser view preference, not session data.
 */

const STORAGE_KEY = "pi-web:hidden-projects";

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

function readKeys(storage: StorageLike): string[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop unusable entries instead of discarding the whole list.
    return parsed.filter((key): key is string => typeof key === "string" && key.length > 0);
  } catch {
    return [];
  }
}

/** Project identities hidden from the picker. */
export function getHiddenProjects(storage: StorageLike | null = getBrowserStorage()): string[] {
  if (!storage) return [];
  try {
    return readKeys(storage);
  } catch {
    return [];
  }
}

export function setHiddenProjects(
  keys: readonly string[],
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    // Keep the store clean: drop the key entirely when nothing is hidden.
    if (keys.length === 0) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // storage unavailable — hiding is best-effort
  }
}
