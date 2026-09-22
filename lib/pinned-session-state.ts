const PINNED_SESSIONS_STORAGE_KEY = "pi-web:pinned-session-ids";
const PINNED_SESSIONS_ENABLED_STORAGE_KEY = "pi-web:pinned-sessions-enabled";

export function loadPinnedSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

export function savePinnedSessionIds(ids: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(PINNED_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Persistence is best-effort.
  }
}

export function loadPinnedSessionsEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(PINNED_SESSIONS_ENABLED_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function savePinnedSessionsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_SESSIONS_ENABLED_STORAGE_KEY, String(enabled));
  } catch {
    // Persistence is best-effort.
  }
}
