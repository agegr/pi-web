/**
 * Per-browser sidebar preferences: the active tab (sessions or files), the
 * user's explicit project group expand/collapse choices, the archive view's
 * folded projects, whether the pinned section is collapsed, whether the files section below the sessions is
 * collapsed, whether the files tab or section lists ignored files, whether the
 * Git changes panel shows a flat list or a folder tree, and the folders the
 * worktree listing last found outside git.
 * Best-effort localStorage, like the other sidebar memories: privacy mode or
 * quota errors fall back to defaults.
 */

const SIDEBAR_TAB_STORAGE_KEY = "pi-web:sidebar-tab";
const GROUP_EXPANSION_STORAGE_KEY = "pi-web:sidebar-groups-v2";
/**
 * The group choices before v2. A group that stopped being current was saved
 * there as open, so every project ever visited came back expanded; its
 * `true` entries cannot be told from the user's own, and only its collapses
 * move to v2 (loadGroupExpansion).
 */
const LEGACY_GROUP_EXPANSION_STORAGE_KEY = "pi-web:sidebar-groups";
const ARCHIVE_COLLAPSED_STORAGE_KEY = "pi-web:sidebar-archive-collapsed";
const PINNED_COLLAPSED_STORAGE_KEY = "pi-web:sidebar-pins-collapsed";
const SHOW_IGNORED_FILES_STORAGE_KEY = "pi-web:sidebar-files-show-ignored";
const FILES_COLLAPSED_STORAGE_KEY = "pi-web:sidebar-files-collapsed";
const CHANGES_VIEW_MODE_STORAGE_KEY = "pi-web:sidebar-changes-view-mode";
const NON_GIT_CWDS_STORAGE_KEY = "pi-web:sidebar-non-git-cwds";
/**
 * Keys nothing reads now: the sessions/explorer split's, which the two tabs
 * replaced, and the group choices before v2 (loadGroupExpansion reads them
 * only while v2 is missing).
 */
const RETIRED_STORAGE_KEYS = ["pi-web:file-explorer:open", "pi-web:sidebar-session-pane-height", LEGACY_GROUP_EXPANSION_STORAGE_KEY];

/** Oldest choices are dropped beyond this many project keys. */
const MAX_GROUP_EXPANSION_ENTRIES = 300;
/** Oldest folders are dropped beyond this many. */
const MAX_NON_GIT_CWDS = 50;

export type SidebarTab = "sessions" | "files";

/** Flat list (default) or folder tree for the Git changes panel. */
export type ChangesViewMode = "list" | "tree";

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

/**
 * The saved group choices. A browser without v2 yet takes the collapses of
 * the old key and saves them as v2 at once, so the old key can go
 * (forgetRetiredSidebarKeys, after this) and is never read again; its
 * expansions are dropped: the defaults (current and pinned projects open)
 * come back once.
 */
export function loadGroupExpansion(storage: StorageLike | null = getBrowserStorage()): Record<string, boolean> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(GROUP_EXPANSION_STORAGE_KEY);
    if (raw !== null) return cleanGroupExpansion(JSON.parse(raw));
  } catch {
    return {};
  }
  let legacy: Record<string, boolean>;
  try {
    const raw = storage.getItem(LEGACY_GROUP_EXPANSION_STORAGE_KEY);
    if (raw === null) return {};
    legacy = cleanGroupExpansion(JSON.parse(raw));
  } catch {
    // Unreadable: nothing to keep, and the key goes with the retired ones.
    legacy = {};
  }
  const collapsed = Object.fromEntries(Object.entries(legacy).filter(([, expanded]) => !expanded));
  saveGroupExpansion(collapsed, storage);
  return collapsed;
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

/**
 * The archive view's folded projects (project keys, oldest choice first). Its
 * groups are open unless folded here: apart from the main tree's choices, so
 * folding a project's archive never folds its live sessions.
 */
export function loadArchiveCollapsed(storage: StorageLike | null = getBrowserStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(ARCHIVE_COLLAPSED_STORAGE_KEY);
    const value: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const keys = value.filter((key): key is string => typeof key === "string" && key !== "");
    return [...new Set(keys)].slice(-MAX_GROUP_EXPANSION_ENTRIES);
  } catch {
    return [];
  }
}

/** Keeps the newest 300 keys; to mark one as recent, put it last. */
export function saveArchiveCollapsed(
  keys: readonly string[],
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(ARCHIVE_COLLAPSED_STORAGE_KEY, JSON.stringify([...new Set(keys)].slice(-MAX_GROUP_EXPANSION_ENTRIES)));
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

/** The files tab's (or section's) ignored-files switch; off unless the browser saved it on. */
export function loadShowIgnoredFiles(storage: StorageLike | null = getBrowserStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(SHOW_IGNORED_FILES_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveShowIgnoredFiles(
  show: boolean,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(SHOW_IGNORED_FILES_STORAGE_KEY, String(show));
  } catch {
    // Persistence is best-effort.
  }
}

/**
 * The files section below the sessions folded to its header row; open unless
 * the browser saved it folded. The tabs layout ignores it.
 */
export function loadFilesCollapsed(storage: StorageLike | null = getBrowserStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(FILES_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveFilesCollapsed(
  collapsed: boolean,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(FILES_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // Persistence is best-effort.
  }
}


/** Flat list unless the browser saved tree mode for the Git changes panel. */
export function loadChangesViewMode(storage: StorageLike | null = getBrowserStorage()): ChangesViewMode {
  if (!storage) return "list";
  try {
    return storage.getItem(CHANGES_VIEW_MODE_STORAGE_KEY) === "tree" ? "tree" : "list";
  } catch {
    return "list";
  }
}

export function saveChangesViewMode(
  mode: ChangesViewMode,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(CHANGES_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Persistence is best-effort.
  }
}

/**
 * Folders the worktree listing last found outside any git repository, oldest
 * first. The sidebar knows them before its listing answers, after a reload
 * too, so such a folder never shows the "checking" worktree box only to drop
 * it and widen the project box (the default dated folder is one).
 */
export function loadNonGitCwds(storage: StorageLike | null = getBrowserStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(NON_GIT_CWDS_STORAGE_KEY);
    const value: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((cwd): cwd is string => typeof cwd === "string" && cwd !== "").slice(-MAX_NON_GIT_CWDS);
  } catch {
    return [];
  }
}

/**
 * Records what a listing found for `cwd`: a folder outside git becomes the
 * newest, one in git leaves the list (it may have become a repository).
 * Read, then written, so the folders another tab saved stay; nothing is
 * written when nothing changes.
 */
export function rememberCwdGitStatus(
  cwd: string,
  isGit: boolean,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage || !cwd) return;
  const known = loadNonGitCwds(storage);
  const index = known.indexOf(cwd);
  if (isGit ? index === -1 : index !== -1 && index === known.length - 1) return;
  const next = known.filter((other) => other !== cwd);
  if (!isGit) next.push(cwd);
  try {
    storage.setItem(NON_GIT_CWDS_STORAGE_KEY, JSON.stringify(next.slice(-MAX_NON_GIT_CWDS)));
  } catch {
    // Persistence is best-effort.
  }
}

/**
 * Drops the retired keys. Best-effort, like the rest. Runs after
 * loadGroupExpansion, which moves the old group choices it keeps to v2.
 */
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
