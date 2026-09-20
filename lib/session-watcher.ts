/**
 * Watches the default `~/.pi/agent/sessions` root for writes made by other pi
 * processes (the TUI, another pi-web window, ...) and bumps the session list
 * version so the sidebar's existing poll picks them up without a manual reload.
 *
 * Backend: on macOS and Windows a single recursive `fs.watch` on the root.
 * Linux's recursive `fs.watch` is an emulation that opens one internal
 * watcher per subdirectory and — as of Node 24 — those internal handles
 * ignore `unref()`, so a "recursive" watcher there keeps every process
 * (test runner, CLI shutdown) alive forever. On Linux (and any other
 * platform) the module therefore uses the fallback layout directly: one
 * non-recursive root watcher that detects newly created project
 * subdirectories on the debounce flush plus one non-recursive watcher per
 * existing top-level subdirectory, all of which `unref()` correctly.
 * When nothing can be watched (missing root, watcher death) it degrades to the
 * plain 30 s TTL cache behaviour, logging the degradation exactly once.
 *
 * Safety: all watcher state lives on `globalThis` under
 * `Symbol.for("pi-web:session-watcher")` so a Turbopack hot reload reuses (or
 * recreates) at most one watcher set, mirroring `lib/auth-throttle.ts`.
 * Watchers are unref'd so they never keep a process (a test runner, a dev
 * server shutdown) alive, and every watcher carries an `error` handler so a
 * dead watcher degrades instead of crashing the server.
 */

import { readdirSync, watch, type FSWatcher } from "fs";
import { join, resolve as resolvePath } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { invalidateSessionListCache } from "./session-reader";
import { sessionPathKey } from "./session-path";

export const SESSION_WATCH_DEBOUNCE_MS = 300;
export const RECENT_SESSION_WRITES_LIMIT = 32;

export interface SessionWriteEvent {
  /** Absolute session file path. */
  path: string;
  /** `sessionPathKey()` of `path` — the stable comparison key. */
  pathKey: string;
  /** Per-session counter of debounced external write bursts. */
  generation: number;
  timestamp: number;
}

export interface SessionWatcherStatus {
  root: string;
  watcherCount: number;
  /** True when a single recursive root watcher is active. */
  recursive: boolean;
  /** True when watching failed and the module degraded to TTL-only behaviour. */
  degraded: boolean;
}

interface WatcherState {
  root: string;
  debounceMs: number;
  recursive: boolean;
  watchers: Set<FSWatcher>;
  /** Set once every watcher failed / could not be created. */
  failed: boolean;
  degradedLogged: boolean;
  /** pathKey -> generation, one per session file ever written externally. */
  generations: Map<string, number>;
  /** Bounded ring of recent debounced writes, newest last. */
  recentWrites: SessionWriteEvent[];
  /** pathKey -> path, collected between debounce flushes. */
  pendingWrites: Map<string, string>;
  /** Set when a root-level fallback event needs a subdir rescan. */
  pendingRescan: boolean;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

const STATE_KEY = "pi-web:session-watcher";

function getGlobalState(): WatcherState | undefined {
  const store = globalThis as Record<PropertyKey, unknown>;
  const existing = store[Symbol.for(STATE_KEY)];
  return isWatcherState(existing) ? existing : undefined;
}

function isWatcherState(value: unknown): value is WatcherState {
  return typeof value === "object" && value !== null && typeof (value as WatcherState).root === "string";
}

function setGlobalState(state: WatcherState | undefined): void {
  const store = globalThis as Record<PropertyKey, unknown>;
  if (state) store[Symbol.for(STATE_KEY)] = state;
  else delete store[Symbol.for(STATE_KEY)];
}

function defaultSessionsRoot(): string {
  return resolvePath(join(getAgentDir(), "sessions"));
}

function closeWatchers(state: WatcherState): void {
  for (const watcher of state.watchers) {
    try {
      watcher.close();
    } catch {
      // Already closed or the handle vanished; nothing to do.
    }
  }
  state.watchers.clear();
}

function clearDebounce(state: WatcherState): void {
  if (state.debounceTimer !== null) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
}

function unrefWatcher(watcher: FSWatcher): void {
  // Never keep a process (test runner, dev-server shutdown) alive for this.
  if (typeof watcher.unref === "function") watcher.unref();
}

function logDegradationOnce(state: WatcherState, reason: string): void {
  state.failed = true;
  if (state.degradedLogged) return;
  state.degradedLogged = true;
  console.warn(
    `[pi-web] session watcher unavailable (${reason}); falling back to the 30s session list cache. External session writes appear after the next cache refresh.`,
  );
}

type WatchTarget =
  | { kind: "sessions"; dir: string }
  | { kind: "root-rescan" };

// Recursive fs.watch is only usable where it maps to a single native handle
// that honours unref(): macOS (FSEvents) and Windows (ReadDirectoryChangesW).
// On Linux it is emulated with one internal watcher per subdirectory, and
// those handles ignore unref(), so using it would hang every process that
// lazily starts the watcher (the whole `npm test` suite included).
const RECURSIVE_WATCH_PLATFORMS = new Set(["darwin", "win32"]);

function attachWatcher(state: WatcherState, watcher: FSWatcher, target: WatchTarget): FSWatcher {
  watcher.on("error", (error) => {
    state.watchers.delete(watcher);
    try {
      watcher.close();
    } catch {
      // Ignore double-close.
    }
    if (state.watchers.size === 0) {
      logDegradationOnce(state, String(error));
    }
  });
  watcher.on("change", (_eventType, filename) => {
    const relative = filename === null ? undefined : filename.toString();
    if (target.kind === "root-rescan") {
      // A project subdirectory appeared or vanished under the root; the
      // debounced flush re-enumerates subdirectory watchers. Watching only
      // the root (non-recursively) means session files never live here.
      scheduleFlush(state, { rescan: true });
      return;
    }
    if (!relative) {
      // Some platforms omit the filename; conservatively invalidate.
      scheduleFlush(state, { rescan: false, path: target.dir });
      return;
    }
    const fullPath = join(target.dir, relative);
    if (!fullPath.endsWith(".jsonl")) return;
    scheduleFlush(state, { rescan: false, path: fullPath });
  });
  unrefWatcher(watcher);
  state.watchers.add(watcher);
  return watcher;
}

function scheduleFlush(state: WatcherState, event: { rescan: boolean; path?: string }): void {
  if (event.rescan) state.pendingRescan = true;
  if (event.path) state.pendingWrites.set(sessionPathKey(event.path), event.path);
  // Trailing debounce: a burst of appends coalesces into one flush (and thus
  // exactly one list-version bump and one per-session generation increment).
  if (state.debounceTimer !== null) clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    flushPending(state);
  }, state.debounceMs);
  unrefTimer(state.debounceTimer);
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  // Keep the flush transient even if the watchers themselves are gone.
  if (typeof timer === "object" && timer !== null && "unref" in timer && typeof timer.unref === "function") {
    (timer as unknown as { unref(): void }).unref();
  }
}

function flushPending(state: WatcherState): void {
  if (state.pendingWrites.size > 0) {
    const now = Date.now();
    for (const [pathKey, path] of state.pendingWrites) {
      const generation = (state.generations.get(pathKey) ?? 0) + 1;
      state.generations.set(pathKey, generation);
      // One ring entry per session file, carrying its latest generation.
      state.recentWrites = state.recentWrites.filter((write) => write.pathKey !== pathKey);
      state.recentWrites.push({ path, pathKey, generation, timestamp: now });
    }
    if (state.recentWrites.length > RECENT_SESSION_WRITES_LIMIT) {
      state.recentWrites.splice(0, state.recentWrites.length - RECENT_SESSION_WRITES_LIMIT);
    }
    state.pendingWrites.clear();
    // Exactly one list-cache invalidation per burst.
    invalidateSessionListCache();
  }
  if (!state.recursive || state.pendingRescan) {
    state.pendingRescan = false;
    rescanSubdirectoryWatchers(state);
  }
}

function rescanSubdirectoryWatchers(state: WatcherState): void {
  if (state.recursive) return;
  let entries;
  try {
    entries = readdirSync(state.root, { withFileTypes: true });
  } catch {
    return;
  }
  const known = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const dir = join(state.root, entry.name);
    known.add(dir);
    if ([...state.watchers].some((watcher) => (watcher as unknown as { __piWebWatchDir?: string }).__piWebWatchDir === dir)) continue;
    try {
      const watcher = watch(dir);
      (watcher as unknown as { __piWebWatchDir?: string }).__piWebWatchDir = dir;
      attachWatcher(state, watcher, { kind: "sessions", dir });
    } catch {
      // Unwatchable subdirectory; skip it rather than degrade everything.
    }
  }
  // Drop watchers for subdirectories that vanished.
  for (const watcher of [...state.watchers]) {
    const dir = (watcher as unknown as { __piWebWatchDir?: string }).__piWebWatchDir;
    if (dir !== undefined && !known.has(dir)) {
      state.watchers.delete(watcher);
      try {
        watcher.close();
      } catch {
        // Ignore double-close.
      }
    }
  }
}

function createWatchers(state: WatcherState): void {
  state.failed = false;
  if (RECURSIVE_WATCH_PLATFORMS.has(process.platform)) {
    state.recursive = true;
    try {
      const rootWatcher = watch(state.root, { recursive: true });
      attachWatcher(state, rootWatcher, { kind: "sessions", dir: state.root });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT" || code === "EACCES") {
        // Missing or unreadable root: the subdirectory fallback cannot work
        // either; degrade to the TTL-cache behaviour.
        logDegradationOnce(state, code);
        return;
      }
      // Recursive watch unsupported for another reason: fall through to the
      // per-subdirectory layout.
    }
  }
  state.recursive = false;
  try {
    const rootWatcher = watch(state.root);
    attachWatcher(state, rootWatcher, { kind: "root-rescan" });
  } catch (error) {
    logDegradationOnce(state, String((error as NodeJS.ErrnoException)?.code ?? error));
    return;
  }
  rescanSubdirectoryWatchers(state);
}

export interface EnsureSessionWatcherOptions {
  /** Overrides the sessions root (tests). Defaults to `~/.pi/agent/sessions`. */
  root?: string;
  /** Overrides the debounce window (tests). Defaults to 300 ms. */
  debounceMs?: number;
}

/**
 * Idempotent: reuses a live watcher set for the same root, closes-and-recreates
 * a dead one, and moves wholesale to a new root when it changes. At most one
 * watcher set exists on `globalThis` at any time, surviving hot reloads.
 */
export function ensureSessionWatcher(options: EnsureSessionWatcherOptions = {}): void {
  const root = resolvePath(options.root ?? defaultSessionsRoot());
  const debounceMs = options.debounceMs ?? SESSION_WATCH_DEBOUNCE_MS;
  const existing = getGlobalState();
  if (
    existing
    && existing.root === root
    && existing.watchers.size > 0
    && !existing.failed
  ) {
    return; // Live watcher set for this root already running.
  }
  if (existing && existing.root !== root) {
    closeWatchers(existing);
    clearDebounce(existing);
    setGlobalState(undefined);
  }
  const state: WatcherState = existing && existing.root === root
    ? existing
    : {
      root,
      debounceMs,
      recursive: true,
      watchers: new Set(),
      failed: false,
      degradedLogged: existing?.degradedLogged ?? false,
      generations: new Map(),
      recentWrites: [],
      pendingWrites: new Map(),
      pendingRescan: false,
      debounceTimer: null,
    };
  if (existing && existing.root === root) {
    closeWatchers(existing);
    clearDebounce(existing);
    state.debounceMs = debounceMs;
  }
  setGlobalState(state);
  createWatchers(state);
}

/** Bounded snapshot of recent debounced external session writes, oldest first. */
export function getRecentSessionWrites(): SessionWriteEvent[] {
  const state = getGlobalState();
  return state ? [...state.recentWrites] : [];
}

/** Debounced-write generation for one session file path (0 when never seen). */
export function getSessionWriteGeneration(filePath: string): number {
  const state = getGlobalState();
  return state?.generations.get(sessionPathKey(filePath)) ?? 0;
}

/** Introspection for tests and diagnostics. */
export function getSessionWatcherStatus(): SessionWatcherStatus | null {
  const state = getGlobalState();
  if (!state) return null;
  return {
    root: state.root,
    watcherCount: state.watchers.size,
    recursive: state.recursive,
    degraded: state.failed,
  };
}

/** Closes every watcher and drops the state. Intended for tests. */
export function disposeSessionWatcher(): void {
  const state = getGlobalState();
  if (!state) return;
  closeWatchers(state);
  clearDebounce(state);
  state.pendingWrites.clear();
  state.pendingRescan = false;
  setGlobalState(undefined);
}
