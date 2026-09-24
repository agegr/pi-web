/**
 * Worker-session filter (wi pi#49 R1).
 *
 * The sidebar hides "worker" sessions (workflow step invocations spawned by
 * the orchestrator) from its rendered lists. The rules are user-editable
 * in the Settings dialog: one substring per line, matched case-insensitively
 * against the session's stored name OR its first message. A separate
 * "show filtered sessions" toggle reveals the hidden rows again with no
 * visual difference.
 *
 * Everything here is pure and best-effort by contract: browser storage is
 * injected (so `node --test` drives the real logic without a DOM), a
 * corrupt/non-array payload or a throwing storage read falls back to the
 * default pattern list, and persistence failures are swallowed (an
 * unavailable storage degrades to session-only behavior).
 */

import type { SessionInfo } from "./types";

/** localStorage key of the persisted pattern array (JSON string array). */
export const SESSION_FILTER_PATTERNS_STORAGE_KEY = "pi-web:session-filter-patterns";

/** localStorage key of the persisted show-filtered toggle. */
export const SHOW_FILTERED_SESSIONS_STORAGE_KEY = "pi-web:show-filtered-sessions";

/** Default patterns when the storage key is absent or unreadable: the
 *  workflow-invocation marker pi-web's own orchestrator produces. */
export const DEFAULT_SESSION_FILTER_PATTERNS: readonly string[] = ["Execute the pinned skill entry"];

/** Minimal storage surface the helpers need (localStorage-shaped). */
export interface SessionFilterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Acquires the browser's localStorage for the filter helpers; null during
 *  server rendering or when the browser denies storage access. Never throws. */
export function sessionFilterStorage(): SessionFilterStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null; // storage-policy denial degrades to defaults
  }
}

function safeGetItem(storage: SessionFilterStorage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Reads the persisted pattern list. Absent key, non-JSON, non-array or
 *  non-string entries fall back to the DEFAULT list; an empty stored array
 *  is a legitimate "disable hiding" value and is returned as-is. */
export function loadSessionFilterPatterns(
  storage: SessionFilterStorage | null,
): string[] {
  const fallback = (): string[] => [...DEFAULT_SESSION_FILTER_PATTERNS];
  const raw = safeGetItem(storage, SESSION_FILTER_PATTERNS_STORAGE_KEY);
  if (raw === null) return fallback();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback();
  }
  if (!Array.isArray(parsed)) return fallback();
  // A non-string entry means the payload is corrupt, not user-edited: the
  // whole list falls back to the defaults rather than silently dropping
  // (and thus un-hiding) entries the user cannot see in the editor.
  if (parsed.some((item) => typeof item !== "string")) return fallback();
  // Whitespace-only lines are ignored (the editor is line-per-rule; blank
  // separators are formatting, not rules). The remaining list — including
  // an empty one — is returned as-is: an empty list disables hiding.
  return parsed.filter((line): line is string =>
    typeof line === "string" && line.trim().length > 0);
}

/** Persists the pattern list (best-effort): storage failures are swallowed. */
export function saveSessionFilterPatterns(
  storage: SessionFilterStorage | null,
  patterns: readonly string[],
): void {
  if (!storage) return;
  try {
    storage.setItem(SESSION_FILTER_PATTERNS_STORAGE_KEY, JSON.stringify([...patterns]));
  } catch {
    // Best-effort persistence: unavailable storage degrades to session-only.
  }
}

/** Reads the persisted show-filtered toggle (default false, best-effort). */
export function loadShowFilteredSessions(
  storage: SessionFilterStorage | null,
): boolean {
  return safeGetItem(storage, SHOW_FILTERED_SESSIONS_STORAGE_KEY) === "true";
}

/** Persists the show-filtered toggle (best-effort). */
export function saveShowFilteredSessions(
  storage: SessionFilterStorage | null,
  value: boolean,
): void {
  if (!storage) return;
  try {
    storage.setItem(SHOW_FILTERED_SESSIONS_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Best-effort persistence.
  }
}

/** Whether one session matches any of the filter patterns: a
 *  case-insensitive substring hit on the session's stored name OR its first
 *  message. Whitespace-only patterns never match; an empty pattern list
 *  disables hiding entirely. */
export function isSessionFiltered(
  session: Pick<SessionInfo, "name" | "firstMessage">,
  patterns: readonly string[],
): boolean {
  for (const pattern of patterns) {
    const needle = pattern.trim().toLowerCase();
    if (!needle) continue;
    const name = session.name?.toLowerCase();
    if (name !== undefined && name.includes(needle)) return true;
    const firstMessage = session.firstMessage?.toLowerCase();
    if (firstMessage !== undefined && firstMessage.includes(needle)) return true;
  }
  return false;
}

/**
 * Live store (review B1): the sidebar and the Settings editor share ONE
 * in-memory state, persisted best-effort on every write and fanned out to
 * subscribers — so a rules edit or toggle in Settings updates the rendered
 * sidebar immediately in the same window (no remount needed). The snapshot
 * reference is stable between writes, so useSyncExternalStore can consume
 * it directly.
 */
export interface SessionFilterState {
  readonly patterns: readonly string[];
  readonly showFiltered: boolean;
}

let storeState: SessionFilterState | null = null;
const storeListeners = new Set<() => void>();

function ensureStoreState(): SessionFilterState {
  if (!storeState) {
    storeState = {
      patterns: loadSessionFilterPatterns(sessionFilterStorage()),
      showFiltered: loadShowFilteredSessions(sessionFilterStorage()),
    };
  }
  return storeState;
}

export function getSessionFilterState(): SessionFilterState {
  return ensureStoreState();
}

export function setSessionFilterPatterns(patterns: readonly string[]): void {
  storeState = { ...ensureStoreState(), patterns: [...patterns] };
  saveSessionFilterPatterns(sessionFilterStorage(), patterns);
  storeListeners.forEach((listener) => listener());
}

export function setShowFilteredSessions(show: boolean): void {
  storeState = { ...ensureStoreState(), showFiltered: show };
  saveShowFilteredSessions(sessionFilterStorage(), show);
  storeListeners.forEach((listener) => listener());
}

export function subscribeSessionFilter(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => { storeListeners.delete(listener); };
}

/** Stable server snapshot for useSyncExternalStore's getServerSnapshot:
 *  the server never reads storage, so SSR renders the defaults. The
 *  reference must be module-stable (React compares snapshots). */
const SERVER_SESSION_FILTER_STATE: SessionFilterState = {
  patterns: [...DEFAULT_SESSION_FILTER_PATTERNS],
  showFiltered: false,
};

export function getServerSessionFilterState(): SessionFilterState {
  return SERVER_SESSION_FILTER_STATE;
}
