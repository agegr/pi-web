/**
 * Per-browser sidebar preferences: the active tab (sessions or files), the
 * user's explicit project group expand/collapse choices, and whether the
 * pinned section is collapsed. Best-effort localStorage, like the other
 * sidebar memories: privacy mode or quota errors fall back to defaults.
 */

const SIDEBAR_TAB_STORAGE_KEY = "pi-web:sidebar-tab";
const GROUP_EXPANSION_STORAGE_KEY = "pi-web:sidebar-groups";
const PINNED_COLLAPSED_STORAGE_KEY = "pi-web:sidebar-pins-collapsed";
/** What the sessions/explorer split, which the two tabs replaced, kept: nothing reads them now. */
const RETIRED_STORAGE_KEYS = ["pi-web:file-explorer:open", "pi-web:sidebar-session-pane-height"];

/** Oldest choices are dropped beyond this many project keys. */
const MAX_GROUP_EXPANSION_ENTRIES = 300;

export type SidebarTab = "sessions" | "files";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSidebarTab(storage: StorageLike | null = getBrowserStorage()): SidebarTab {
  if (!storage) return "sessions";
  try {
    return storage.getItem(SIDEBAR_TAB_STORAGE_KEY) === "files" ? "files" : "sessions";
  } catch {
    return "sessions";
  }
}

export function saveSidebarTab(tab: SidebarTab, storage: StorageLike | null = getBrowserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(SIDEBAR_TAB_STORAGE_KEY, tab);
  } catch {
    // Persistence is best-effort.
  }
}

/** Only boolean entries survive; "__proto__" is never a project key. */
function cleanGroupExpansion(value: unknown): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, expanded] of Object.entries(value)) {
    if (key === "__proto__" || typeof expanded !== "boolean") continue;
    result[key] = expanded;
  }
  return result;
}

export function loadGroupExpansion(storage: StorageLike | null = getBrowserStorage()): Record<string, boolean> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(GROUP_EXPANSION_STORAGE_KEY);
    return raw ? cleanGroupExpansion(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/**
 * Keeps at most 300 entries, dropping the oldest by insertion order. To mark
 * a choice as recent, delete the key before setting it again.
 */
export function saveGroupExpansion(
  value: Record<string, boolean>,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    const entries = Object.entries(cleanGroupExpansion(value));
    const kept = entries.length > MAX_GROUP_EXPANSION_ENTRIES
      ? entries.slice(entries.length - MAX_GROUP_EXPANSION_ENTRIES)
      : entries;
    storage.setItem(GROUP_EXPANSION_STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Persistence is best-effort.
  }
}

export function loadPinnedCollapsed(storage: StorageLike | null = getBrowserStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(PINNED_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function savePinnedCollapsed(
  collapsed: boolean,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(PINNED_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // Persistence is best-effort.
  }
}

/** Drops the keys the old split sidebar left behind. Best-effort, like the rest. */
export function forgetRetiredSidebarKeys(storage: StorageLike | null = getBrowserStorage()): void {
  if (!storage) return;
  for (const key of RETIRED_STORAGE_KEYS) {
    try {
      storage.removeItem?.(key);
    } catch {
      // Privacy mode may refuse it; the key is simply left unread.
    }
  }
}
