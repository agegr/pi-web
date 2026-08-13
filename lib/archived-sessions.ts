const KEY = "pi-web:archived-session-ids";

export function parseArchivedSessionIds(raw: string | null): Set<string> {
  try {
    const value = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(value)
      ? new Set(value.filter((item): item is string => typeof item === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

export function readArchivedSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  return parseArchivedSessionIds(localStorage.getItem(KEY));
}

export function writeArchivedSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size) localStorage.setItem(KEY, JSON.stringify([...ids]));
    else localStorage.removeItem(KEY);
  } catch {
    // Browser storage is best-effort.
  }
}
