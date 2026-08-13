/**
 * Per-workspace "last open session" memory.
 *
 * Switching to a workspace (project root or cwd) restores the session the user
 * had open there last, instead of landing on a blank new-session page. Without
 * this, every workspace switch required re-picking the session by hand.
 *
 * The workspace key is the resolved project root when known (sessions carry it
 * from the server), normalized into a server-provided project key so Windows
 * path case/separator variants and all worktrees share a single memory slot.
 * It falls back to projectRoot/cwd for transient or legacy session objects.
 *
 * Stored in localStorage; best-effort (silently ignored when unavailable).
 */

const STORAGE_KEY = "pi-web:last-open-by-workspace";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WorkspaceMemoryIdentity {
  /** Current stable identity used for all new writes. */
  key: string;
  /** Exact raw keys written by older Pi Web versions. No alias inference. */
  legacyKeys?: readonly string[];
}

type WorkspaceMemoryTarget = string | WorkspaceMemoryIdentity;

function resolveTarget(target: WorkspaceMemoryTarget): WorkspaceMemoryIdentity {
  return typeof target === "string" ? { key: target } : target;
}

function targetKeys(target: WorkspaceMemoryTarget): string[] {
  const { key, legacyKeys = [] } = resolveTarget(target);
  return [...new Set([key, ...legacyKeys].filter(Boolean))];
}

function storedSessionId(map: Record<string, string | undefined>, key: string): string | null {
  const id = map[key];
  return typeof id === "string" && id.length > 0 ? id : null;
}

function writeMap(storage: StorageLike, map: Record<string, string | undefined>): void {
  if (Object.keys(map).length === 0) storage.removeItem(STORAGE_KEY);
  else storage.setItem(STORAGE_KEY, JSON.stringify(map));
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readMap(storage: StorageLike): Record<string, string | undefined> {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, string | undefined>
      : {};
  } catch {
    return {};
  }
}

/** The remembered session id for a workspace, or null when none/stale. */
export function getLastOpenSession(
  target: WorkspaceMemoryTarget,
  storage: StorageLike | null = getBrowserStorage(),
): string | null {
  if (!storage) return null;
  try {
    const map = readMap(storage);
    const { key } = resolveTarget(target);
    const keys = targetKeys(target);
    const id = storedSessionId(map, key)
      ?? keys.slice(1).map((legacyKey) => storedSessionId(map, legacyKey)).find(Boolean)
      ?? null;
    if (!id) return null;

    // Migrate a raw pre-projectKey entry, or clean up aliases left beside an
    // already-migrated entry. Only explicit aliases are touched, so POSIX case
    // distinctions remain intact.
    let changed = map[key] !== id;
    map[key] = id;
    for (const legacyKey of keys.slice(1)) {
      if (legacyKey in map) {
        delete map[legacyKey];
        changed = true;
      }
    }
    if (changed) writeMap(storage, map);
    return id;
  } catch {
    return null;
  }
}

export function setLastOpenSession(
  target: WorkspaceMemoryTarget,
  sessionId: string,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    const map = readMap(storage);
    const keys = targetKeys(target);
    map[keys[0]] = sessionId;
    for (const legacyKey of keys.slice(1)) delete map[legacyKey];
    writeMap(storage, map);
  } catch {
    // storage unavailable — memory is best-effort
  }
}

export function clearLastOpen(
  target: WorkspaceMemoryTarget,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    const map = readMap(storage);
    const keys = targetKeys(target);
    if (!keys.some((key) => key in map)) return;
    for (const key of keys) delete map[key];
    writeMap(storage, map);
  } catch {
    // ignore
  }
}

/** Workspace identity for a session: resolved project root when known, else cwd. */
export function workspaceKeyOf(session: {
  cwd: string;
  projectRoot?: string | null;
  projectKey?: string | null;
}): string {
  return session.projectKey ?? session.projectRoot ?? session.cwd;
}
