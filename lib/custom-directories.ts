/**
 * User-managed custom directory list for the sidebar (this feature).
 *
 * Stores an ordered list of directory entries, most-recently-added first.
 * Each entry is `{ path, displayName?, addedAt }` where `path` is the
 * directory to render/group and `displayName` is an optional user-set label
 * (absent/empty falls back to the path-derived label).
 *
 * This store SUPERSEDES the pinned-projects concept: a pinned project IS a
 * directory entry. On the first read after the feature ships, the list is
 * seeded from the legacy `pi-web:pinned-projects` payload (both the current
 * `{key, root}` shape and the legacy bare-string shape; the pin root becomes
 * the entry path and the pin order is preserved). The migration writes only
 * the new key — it never writes or deletes the old one — and is idempotent:
 * once the new key exists the legacy payload is ignored.
 *
 * Persisted in localStorage under "pi-web:custom-directories"; best-effort —
 * unavailable or corrupt storage degrades to an empty list, never throws.
 * Follows the same storage-injectable, no-module-cache pattern as
 * lib/pinned-projects.ts: every accessor re-reads storage, so a reload or a
 * hot-reload sees fresh state.
 *
 * Entry identity (dedupe, accordion keys, group keys) uses a client-safe
 * normalized path: trailing separators trimmed and case-folded on Windows,
 * mirroring lib/project-identity.ts's philosophy without node:path.
 */

import { getPinnedProjects } from "./pinned-projects";

const STORAGE_KEY = "pi-web:custom-directories";
// The legacy pinned-projects key is read (never written or deleted) by the
// one-time migration below, through lib/pinned-projects' own reader.

export interface CustomDirectoryEntry {
  /** Directory path exactly as the user added it (display + fs operations). */
  path: string;
  /** Optional user-set label; empty/absent falls back to the path label. */
  displayName?: string;
  /** ISO timestamp of when the entry was added. */
  addedAt: string;
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

/** Windows detection without node APIs; overridable for tests. */
function detectWindows(isWindows?: boolean): boolean {
  if (isWindows !== undefined) return isWindows;
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform ?? navigator.userAgent ?? "";
  return /win/i.test(platform);
}

/**
 * Client-safe path identity: trailing separators trimmed, backslashes
 * normalized to forward slashes, and case folded on Windows (the default
 * Windows filesystem is case-insensitive). Two paths that differ only in
 * casing or trailing separator are the SAME entry.
 */
export function customDirectoryIdentity(path: string, isWindows?: boolean): string {
  const windows = detectWindows(isWindows);
  const withForwardSlashes = path.replace(/\\/g, "/");
  // Trim trailing separators but keep a bare root ("/", "C:/") usable.
  const trimmed = withForwardSlashes.replace(/\/+$/, "") || "/";
  return windows ? trimmed.toLowerCase() : trimmed;
}

/**
 * Read the persisted list. Accepts only the entry shape; invalid entries are
 * skipped and duplicated identities (hand-edited payloads) keep the first
 * occurrence. When the new key is absent, the one-time migration below seeds
 * the list from the legacy pinned-projects payload.
 */
function readList(storage: StorageLike): CustomDirectoryEntry[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return migrateFromPinned(storage);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return parseEntries(parsed);
}

function parseEntries(parsed: unknown): CustomDirectoryEntry[] {
  if (!Array.isArray(parsed)) return [];
  const entries: CustomDirectoryEntry[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const { path, displayName, addedAt } = item as {
      path?: unknown; displayName?: unknown; addedAt?: unknown;
    };
    if (typeof path !== "string" || path.length === 0) continue;
    const identity = customDirectoryIdentity(path);
    if (seen.has(identity)) continue;
    seen.add(identity);
    entries.push({
      path,
      displayName: typeof displayName === "string" && displayName.length > 0 ? displayName : undefined,
      addedAt: typeof addedAt === "string" && addedAt.length > 0 ? addedAt : new Date().toISOString(),
    });
  }
  return entries;
}

/**
 * One-time, idempotent migration: when the custom-directories key has never
 * been written, the first read seeds the list from the legacy
 * pinned-projects payload (pin order preserved, pin root as entry path) and
 * persists the result under the new key. The legacy key is never written or
 * deleted, and once the new key exists this never runs again.
 */
function migrateFromPinned(storage: StorageLike): CustomDirectoryEntry[] {
  let pinned: ReturnType<typeof getPinnedProjects>;
  try {
    pinned = getPinnedProjects(storage);
  } catch {
    pinned = [];
  }
  if (pinned.length === 0) return [];
  const addedAt = new Date().toISOString();
  const entries: CustomDirectoryEntry[] = [];
  const seen = new Set<string>();
  for (const pin of pinned) {
    const identity = customDirectoryIdentity(pin.root);
    if (seen.has(identity)) continue;
    seen.add(identity);
    entries.push({ path: pin.root, addedAt });
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Migration persistence is best-effort; the seeded list is still
    // returned for this read, and the next read re-runs the migration
    // idempotently (same source, same result).
  }
  return entries;
}

function writeList(storage: StorageLike, entries: readonly CustomDirectoryEntry[]): void {
  // An emptied list persists as "[]" rather than removing the key: the
  // key's presence is the migration marker, so a user who removed every
  // entry must not have the legacy pins re-seeded on the next read.
  storage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/** The custom directory list, most-recently-added first. */
export function listCustomDirectories(
  storage: StorageLike | null = getBrowserStorage(),
): CustomDirectoryEntry[] {
  if (!storage) return [];
  try {
    return readList(storage);
  } catch {
    return [];
  }
}

/** Whether a directory is already listed (loose identity comparison). */
export function isCustomDirectoryListed(
  path: string,
  storage: StorageLike | null = getBrowserStorage(),
): boolean {
  const identity = customDirectoryIdentity(path);
  return listCustomDirectories(storage).some(
    (entry) => customDirectoryIdentity(entry.path) === identity,
  );
}

/**
 * Add a directory at the head of the list. Idempotent: an already-listed
 * directory moves to the head with the new path spelling and keeps its
 * existing display name — no duplicate entry is created.
 */
export function addCustomDirectory(
  path: string,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage || !path) return;
  try {
    const identity = customDirectoryIdentity(path);
    const entries = readList(storage);
    const remaining = entries.filter(
      (entry) => customDirectoryIdentity(entry.path) !== identity,
    );
    const existing = entries.find((entry) => customDirectoryIdentity(entry.path) === identity);
    writeList(storage, [
      { path, displayName: existing?.displayName, addedAt: existing?.addedAt ?? new Date().toISOString() },
      ...remaining,
    ]);
  } catch {
    // storage unavailable — adding is best-effort
  }
}

/** Remove a listed directory (list operation only — disk is untouched). */
export function removeCustomDirectory(
  path: string,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage || !path) return;
  try {
    const identity = customDirectoryIdentity(path);
    writeList(storage, readList(storage).filter(
      (entry) => customDirectoryIdentity(entry.path) !== identity,
    ));
  } catch {
    // ignore
  }
}

/**
 * Set or clear a listed entry's display name. An empty value clears it, so
 * the entry falls back to its path-derived label. A no-op for unlisted paths.
 */
export function renameCustomDirectory(
  path: string,
  displayName: string | null,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage || !path) return;
  try {
    const identity = customDirectoryIdentity(path);
    const trimmed = displayName?.trim() ?? "";
    writeList(storage, readList(storage).map((entry) => {
      if (customDirectoryIdentity(entry.path) !== identity) return entry;
      return trimmed === ""
        ? { ...entry, displayName: undefined }
        : { ...entry, displayName: trimmed };
    }));
  } catch {
    // ignore
  }
}

export { STORAGE_KEY as CUSTOM_DIRECTORIES_STORAGE_KEY };
