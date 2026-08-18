/**
 * Browser-local persistence for user-pinned custom project paths.
 *
 * The directory picker's "Custom path" branch validates a path server-side
 * but never wrote the choice anywhere except React state, so the path vanished
 * on reload and was absent from the project selector. This module lets the
 * sidebar remember those choices across reloads in `window.localStorage`.
 *
 * Entries only matter for projects that do not yet have a session file —
 * session-derived projects are surfaced by `getRecentProjects` regardless.
 * Stale entries are pruned automatically because the picker re-validates on
 * click and `commitCustomPath` only persists on a successful response.
 */

import type { RecentProject } from "./project-groups";

const STORAGE_KEY = "pi-web:custom-project-paths";

export interface CustomProjectEntry extends RecentProject {
  /** ISO timestamp recorded when the user pinned this project. */
  addedAt: string;
}

function resolveBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isValidEntry(value: unknown): value is CustomProjectEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.key === "string"
    && typeof v.root === "string"
    && typeof v.addedAt === "string";
}

/**
 * Load user-pinned custom project paths from browser localStorage.
 * Returns an empty array when storage is unavailable or the payload is
 * malformed — every consumer is expected to handle that gracefully.
 */
export function loadCustomProjects(storage: Storage | null = resolveBrowserStorage()): CustomProjectEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

/** Persist the full list. Strips the entry on empty so storage stays tidy. */
function writeCustomProjects(entries: CustomProjectEntry[], storage: Storage | null = resolveBrowserStorage()): void {
  if (!storage) return;
  try {
    if (entries.length === 0) {
      storage.removeItem(STORAGE_KEY);
    } else {
      storage.setItem(STORAGE_KEY, JSON.stringify(entries));
    }
  } catch {
    // Privacy mode or quota errors must not break project selection.
  }
}

/**
 * Pin a project path. If a previous entry exists with the same key it is
 * replaced — useful both for re-pinning and for normalising path casing.
 */
export function saveCustomProject(
  project: { key: string; root: string },
  storage: Storage | null = resolveBrowserStorage(),
): void {
  const list = loadCustomProjects(storage).filter((p) => p.key !== project.key);
  list.push({ key: project.key, root: project.root, addedAt: new Date().toISOString() });
  writeCustomProjects(list, storage);
}

/** Forget a pinned project by its stable server-provided key. */
export function removeCustomProject(
  key: string,
  storage: Storage | null = resolveBrowserStorage(),
): void {
  const list = loadCustomProjects(storage);
  const next = list.filter((p) => p.key !== key);
  if (next.length !== list.length) writeCustomProjects(next, storage);
}