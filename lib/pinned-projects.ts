/**
 * Pinned projects for the sidebar workspace selector.
 *
 * Stores an ordered list of pinned entries, most-recently-pinned first. Each
 * entry persists BOTH the stable project key (the same `workspaceKeyOf`
 * identity the selector uses for row identity and filtering, so all worktrees
 * of one repo share one pin) AND the display root needed to render and
 * select the row when no currently-loaded session resolves to it.
 *
 * Persisted in localStorage under "pi-web:pinned-projects"; best-effort —
 * unavailable or corrupt storage degrades to an empty pin list, never throws.
 * Legacy payloads (plain string arrays of bare keys) are still accepted so
 * existing pins survive the entry-shape migration. Every accessor re-reads
 * storage, so a page reload or a hot-reload sees fresh state — there is
 * deliberately no module-level cache that could survive HMR incorrectly.
 */

const STORAGE_KEY = "pi-web:pinned-projects";

export interface PinnedProject {
  /** Stable server-provided identity used for comparison and Map keys. */
  key: string;
  /** Display root used to render and select the row. */
  root: string;
}

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

/**
 * Read the raw persisted list. Accepts the current entry shape
 * (`{key, root}` objects) and the legacy shape (bare key strings), which
 * carried no display root — those fall back to the key itself (on POSIX the
 * identity key is the normalized path, so it doubles as a usable root).
 * Duplicated keys are impossible through pinProject, but a hand-edited or
 * migrated payload may contain them; the first occurrence wins.
 */
function readPinnedList(storage: StorageLike): PinnedProject[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: PinnedProject[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    let entry: PinnedProject | null = null;
    if (typeof item === "string" && item.length > 0) {
      entry = { key: item, root: item };
    } else if (item && typeof item === "object") {
      const { key, root } = item as { key?: unknown; root?: unknown };
      if (typeof key === "string" && key.length > 0) {
        entry = { key, root: typeof root === "string" && root.length > 0 ? root : key };
      }
    }
    if (entry && !seen.has(entry.key)) {
      seen.add(entry.key);
      entries.push(entry);
    }
  }
  return entries;
}

function writePinnedList(storage: StorageLike, entries: readonly PinnedProject[]): void {
  if (entries.length === 0) storage.removeItem(STORAGE_KEY);
  else storage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/** Pinned projects, most-recently-pinned first. */
export function getPinnedProjects(
  storage: StorageLike | null = getBrowserStorage(),
): PinnedProject[] {
  if (!storage) return [];
  try {
    return readPinnedList(storage);
  } catch {
    return [];
  }
}

/** Pinned project keys, most-recently-pinned first. */
export function getPinnedProjectKeys(
  storage: StorageLike | null = getBrowserStorage(),
): string[] {
  return getPinnedProjects(storage).map((entry) => entry.key);
}

export function isProjectPinned(
  key: string,
  storage: StorageLike | null = getBrowserStorage(),
): boolean {
  return getPinnedProjectKeys(storage).includes(key);
}

/**
 * Pin a project: moves it to the front of the pinned order and (re)persists
 * its display root, so the row renders and stays selectable even when no
 * currently-loaded session resolves to the project.
 */
export function pinProject(
  key: string,
  root: string,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage || !key) return;
  try {
    const remaining = readPinnedList(storage).filter((pinned) => pinned.key !== key);
    writePinnedList(storage, [{ key, root: root || key }, ...remaining]);
  } catch {
    // storage unavailable — pinning is best-effort
  }
}

/** Unpin a project; a no-op when it was not pinned. */
export function unpinProject(
  key: string,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage || !key) return;
  try {
    writePinnedList(storage, readPinnedList(storage).filter((pinned) => pinned.key !== key));
  } catch {
    // ignore
  }
}
