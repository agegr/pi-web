const STORAGE_KEY = "pi-session-tree-collapsed-v1";
const MAX_COLLAPSED_SESSION_IDS = 512;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function loadCollapsedSessionIds(
  storage: StorageLike | null = browserStorage(),
): Set<string> {
  if (!storage) return new Set();
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return new Set();
    const ids = parsed.filter((value): value is string => (
      typeof value === "string" && value.length > 0
    ));
    return new Set(ids.slice(-MAX_COLLAPSED_SESSION_IDS));
  } catch {
    return new Set();
  }
}

export function saveCollapsedSessionIds(
  ids: ReadonlySet<string>,
  storage: StorageLike | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify([...ids].slice(-MAX_COLLAPSED_SESSION_IDS)),
    );
  } catch {
    // Storage can be unavailable or full; the in-memory state still works.
  }
}

export function setSessionTreeCollapsed(
  current: ReadonlySet<string>,
  sessionId: string,
  collapsed: boolean,
): Set<string> {
  const next = new Set(current);
  next.delete(sessionId);
  if (collapsed) next.add(sessionId);
  while (next.size > MAX_COLLAPSED_SESSION_IDS) {
    const oldest = next.values().next().value as string | undefined;
    if (!oldest) break;
    next.delete(oldest);
  }
  return next;
}
