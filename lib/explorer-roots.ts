/**
 * Multi-root model for the sidebar file explorer (pi#14).
 *
 * The explorer renders one section per root: every pinned project (pin
 * order, most-recently-pinned first — exactly as getPinnedProjects yields)
 * followed by the currently selected project only when its stable key is
 * not already pinned. Dedupe is by stable key, so all worktrees of one
 * repository share one section and the trailing selection can never
 * duplicate a pinned entry. Pure over its inputs, so the spec scenarios
 * ([A,B]+C → [A,B,C]; selected==pinned A → [A,B]; empty → []) are
 * trivially testable without React.
 *
 * Per-section expansion state persists in localStorage as a JSON array of
 * root keys under "pi-web:file-explorer:section-expanded" — the same
 * best-effort, corrupt-tolerant, storage-injectable pattern as
 * lib/pinned-projects.ts: unavailable or corrupt storage degrades to the
 * empty set and never throws; writes are wrapped so a quota or
 * privacy-mode failure is silently ignored. Keys of roots that were later
 * unpinned are harmless leftovers and are never auto-cleaned — a re-pin
 * simply finds its old expansion state again. Sections default to
 * COLLAPSED: an absent key means the empty set, which is the default.
 */

const SECTION_EXPANDED_STORAGE_KEY = "pi-web:file-explorer:section-expanded";

export interface ExplorerRoot {
  /** Stable server-provided project identity (worktrees share it). */
  key: string;
  /** Display root the section's FileExplorer is rooted at. */
  root: string;
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

/**
 * Build the explorer section set: pinned entries in pin order, then the
 * selected project as the trailing section when its key is not already
 * covered. Invalid entries (missing key) and duplicate keys are skipped —
 * the first occurrence wins, mirroring the pinned-store reader.
 */
export function buildExplorerRoots(
  pinned: readonly { key: string; root: string }[],
  selected: { key: string; root: string } | null,
): ExplorerRoot[] {
  const roots: ExplorerRoot[] = [];
  const seen = new Set<string>();
  for (const entry of pinned) {
    if (!entry?.key || seen.has(entry.key)) continue;
    seen.add(entry.key);
    roots.push({ key: entry.key, root: entry.root || entry.key });
  }
  if (selected?.key && !seen.has(selected.key)) {
    roots.push({ key: selected.key, root: selected.root || selected.key });
  }
  return roots;
}

/**
 * Persisted expanded-section keys. Absent or corrupt storage reads as the
 * empty set (everything collapsed). Every accessor re-reads storage, so a
 * page reload or hot-reload sees fresh state — no module-level cache that
 * could survive HMR incorrectly.
 */
export function readExplorerSectionExpanded(
  storage: StorageLike | null = getBrowserStorage(),
): ReadonlySet<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(SECTION_EXPANDED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((key): key is string => typeof key === "string"));
  } catch {
    return new Set();
  }
}

export function writeExplorerSectionExpanded(
  keys: ReadonlySet<string>,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    if (keys.size === 0) storage.removeItem(SECTION_EXPANDED_STORAGE_KEY);
    else storage.setItem(SECTION_EXPANDED_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}
