import { mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { serializeByKey } from "./key-serializer";
import { readRegularFileText } from "./regular-file";
import {
  applySessionUiStateRequest,
  emptySessionUiState,
  normalizeSessionUiState,
  SESSION_UI_STATE_VERSION,
  type SessionUiState,
  type SessionUiStateRequest,
} from "./session-ui-state-shared";

// The sidebar's pins, archive and project order (`lib/session-ui-state-shared.ts`
// has the rules) in `pi-web-session-state.json` beside pi's own files. It holds what
// the user chose, so unlike the session index it is never rebuilt: writes are
// serialized in-process, locked against other processes, replaced atomically,
// and a file that cannot be parsed is set aside, never overwritten.

const MAX_BYTES = 4 * 1024 * 1024;
// `__proto__` is never copied: assigning it would set the object's prototype instead.
const KNOWN_KEYS = new Set(["version", "revision", "sessions", "projects", "projectOrder", "__proto__"]);

// Route handlers are bundled separately and hot reload re-evaluates modules; globalThis keeps one queue per process.
const QUEUE_KEY: symbol = Symbol.for("pi-web:session-ui-state-write-queue");

/**
 * About three seconds of retries in all, as for `mcp.json`: writes are
 * serialized before the lock, so only another process holds it, and only for
 * one short write. A compromised lock is logged: proper-lockfile's default
 * throws from a timer, which would take the whole server down.
 */
const LOCK_OPTIONS = {
  realpath: false,
  stale: 10_000,
  retries: { retries: 10, factor: 2, minTimeout: 25, maxTimeout: 500 },
  onCompromised: (error: Error) => {
    console.warn(`[pi-web] the session UI state lock was compromised: ${error.message}`);
  },
};

/** Another process held the file's lock for longer than the retries wait. */
export class SessionUiStateLockedError extends Error {
  constructor(message = "Another process holds the session UI state lock") {
    super(message);
    this.name = "SessionUiStateLockedError";
  }
}

interface CachedRead {
  mtimeMs: number;
  size: number;
  ino: number;
  state: SessionUiState;
}

interface SessionUiStateCache {
  /** The last read per path, valid while the file's stat fingerprint matches. */
  reads: Map<string, CachedRead>;
  /** The highest revision seen per path, so a reset after a corrupt or removed file still moves forward. */
  revisions: Map<string, number>;
}

declare global {
  var __piWebSessionUiStateCache: SessionUiStateCache | undefined;
}

function cache(): SessionUiStateCache {
  return (globalThis.__piWebSessionUiStateCache ??= { reads: new Map(), revisions: new Map() });
}

function noteRevision(path: string, revision: number): void {
  const revisions = cache().revisions;
  if (revision > (revisions.get(path) ?? -1)) revisions.set(path, revision);
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/** Callers get their own copy: the cached state is shared by every later read. */
function copyState(state: SessionUiState): SessionUiState {
  return structuredClone(state);
}

export function getSessionUiStatePath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web-session-state.json");
}

type Parsed = { ok: true; state: SessionUiState; raw: Record<string, unknown> } | { ok: false };

function parseStateText(text: string): Parsed {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  const state = normalizeSessionUiState(raw);
  return state ? { ok: true, state, raw: raw as Record<string, unknown> } : { ok: false };
}

/**
 * The file's state through the stat-keyed cache. Missing reads as empty and an
 * unparsable file as empty (warned once per version of it); anything else, such
 * as a file that is not a regular one or is too large, throws.
 */
function loadState(path: string): SessionUiState {
  let stats;
  try {
    stats = statSync(path);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      cache().reads.delete(path);
      return emptySessionUiState();
    }
    throw error;
  }
  const cached = cache().reads.get(path);
  // An atomic replace gives the file a new inode, so a write within the mtime's granularity is still seen.
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size && cached.ino === stats.ino) {
    return cached.state;
  }
  // Read after the stat: a write in between leaves a fingerprint older than the text, which only costs one more read.
  const text = readRegularFileText(path, MAX_BYTES);
  if (text === undefined) {
    cache().reads.delete(path);
    return emptySessionUiState();
  }
  const parsed = parseStateText(text);
  let state: SessionUiState;
  if (parsed.ok) {
    state = parsed.state;
    noteRevision(path, state.revision);
  } else {
    console.warn(`[pi-web] ${path} is not valid session UI state; reading it as empty until the next change sets it aside`);
    state = emptySessionUiState();
  }
  cache().reads.set(path, { mtimeMs: stats.mtimeMs, size: stats.size, ino: stats.ino, state });
  return state;
}

/** Never throws; missing/corrupt → empty (does not rewrite on read). */
export function readSessionUiState(path?: string): SessionUiState {
  try {
    return copyState(loadState(path ?? getSessionUiStatePath()));
  } catch (error) {
    console.warn(`[pi-web] could not read the session UI state: ${error instanceof Error ? error.message : String(error)}`);
    return emptySessionUiState();
  }
}

/** Cheap enough for the running poll: one stat while the file is unchanged. Null on an unexpected error. */
export function getSessionUiStateRevision(path?: string): number | null {
  try {
    return loadState(path ?? getSessionUiStatePath()).revision;
  } catch {
    return null;
  }
}

/** Sets an unparsable file aside beside itself; best effort. */
function backUpCorruptFile(path: string): void {
  const backup = `${path}.corrupt-${Date.now()}`;
  try {
    renameSync(path, backup);
    console.warn(`[pi-web] ${path} could not be parsed; moved it to ${backup} and started from an empty session UI state`);
  } catch (error) {
    console.warn(`[pi-web] ${path} could not be parsed and could not be moved aside (${error instanceof Error ? error.message : String(error)}); starting from an empty session UI state`);
  }
}

/**
 * Reads the file under the lock, applies `edit`, and replaces the file when it
 * changed something, with the revision bumped. Unknown top-level fields of a
 * valid file are kept for a newer build.
 */
function editState(
  path: string,
  edit: (state: SessionUiState) => { state: SessionUiState; changed: boolean },
): Promise<SessionUiState> {
  return serializeByKey(QUEUE_KEY, path, async () => {
    mkdirSync(dirname(path), { recursive: true });
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(path, LOCK_OPTIONS);
    } catch (error) {
      if (errorCode(error) === "ELOCKED") throw new SessionUiStateLockedError();
      throw error;
    }
    try {
      const lastRevision = cache().revisions.get(path) ?? 0;
      const text = readRegularFileText(path, MAX_BYTES);
      let state: SessionUiState;
      const extras: Record<string, unknown> = {};
      let reset = false;
      if (text === undefined) {
        // A removed file starts over, but its revision keeps counting so clients notice.
        state = { ...emptySessionUiState(), revision: lastRevision };
      } else {
        const parsed = parseStateText(text);
        if (parsed.ok) {
          state = parsed.state;
          for (const [key, value] of Object.entries(parsed.raw)) {
            if (!KNOWN_KEYS.has(key)) extras[key] = value;
          }
        } else {
          backUpCorruptFile(path);
          state = { ...emptySessionUiState(), revision: lastRevision + 1 };
          // The file was moved away: write the fresh state even when the edit itself changes nothing.
          reset = true;
        }
      }
      const result = edit(state);
      if (!result.changed && !reset) return copyState(state);
      const next: SessionUiState = { ...result.state, version: SESSION_UI_STATE_VERSION, revision: state.revision + (result.changed ? 1 : 0) };
      const document = {
        version: next.version,
        revision: next.revision,
        sessions: next.sessions,
        projects: next.projects,
        ...(next.projectOrder?.length ? { projectOrder: next.projectOrder } : {}),
        ...extras,
      };
      writePrivateFileAtomicSync(path, JSON.stringify(document, null, 2) + "\n");
      noteRevision(path, next.revision);
      try {
        const stats = statSync(path);
        cache().reads.set(path, { mtimeMs: stats.mtimeMs, size: stats.size, ino: stats.ino, state: copyState(next) });
      } catch {
        cache().reads.delete(path);
      }
      return copyState(next);
    } finally {
      try {
        await release();
      } catch {
        // A compromised lock was already reported through onCompromised.
      }
    }
  });
}

export function updateSessionUiState(request: SessionUiStateRequest, path?: string): Promise<SessionUiState> {
  let target: string;
  try {
    target = path ?? getSessionUiStatePath();
  } catch (error) {
    return Promise.reject(error);
  }
  return editState(target, (state) => applySessionUiStateRequest(state, request, Date.now()));
}

/** Removes those session entries; no-op (no write) if none present. */
export async function forgetSessionUiState(ids: Iterable<string>, path?: string): Promise<void> {
  const target = path ?? getSessionUiStatePath();
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return;
  const has = (state: SessionUiState) => wanted.some((id) => Object.prototype.hasOwnProperty.call(state.sessions, id));
  // Deleting a session must not lock or create anything when it had no pin or archive time.
  // A file that cannot be read throws here: the locked read could not do better.
  if (!has(loadState(target))) return;
  await editState(target, (state) => {
    if (!has(state)) return { state, changed: false };
    const sessions = { ...state.sessions };
    for (const id of wanted) delete sessions[id];
    return { state: { ...state, sessions }, changed: true };
  });
}

export function resetSessionUiStateCacheForTests(): void {
  globalThis.__piWebSessionUiStateCache = undefined;
}
