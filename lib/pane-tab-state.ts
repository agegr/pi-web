/**
 * Persisted split-view pane-tab state (this wi).
 *
 * `paneTabs`/`focusedPaneId` in AppShell are plain React state, so a browser
 * reload used to lose every open pane except the single `?session=` deep-link
 * target. This module persists the strip under a schema-versioned
 * localStorage record so the next load can rebuild it.
 *
 * Validation posture mirrors `components/terminal-tab-state.ts`: best-effort
 * everywhere — unavailable or failing storage degrades to no persistence and
 * never crashes; corrupt, stale, or partial records degrade to the largest
 * valid subset; unknown record versions are treated as unparseable. The
 * sentinel new-session tab id and the `hasBadge` flag are never stored.
 */

import { isNewSessionTab, type PaneTab } from "./pane-state";

export const OPEN_PANE_TABS_KEY = "pi-web:open-pane-tabs";

/** Persisted slice of a PaneTab: the sentinel id and hasBadge never persist. */
export interface StoredPaneTab {
  sessionId: string;
  label: string;
  /** Sidebar project identity (pi#25): basename of the project root. */
  projectName: string;
}

/** Schema-versioned record. Unknown versions are unparseable. */
export interface OpenPaneTabsRecord {
  version: 1;
  tabs: StoredPaneTab[];
  focusedPaneId: string | null;
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
 * Parse a raw record. Malformed entries are rejected individually so a
 * partially corrupt record still yields its largest valid subset; duplicate
 * session ids keep the first occurrence; a focusedPaneId that does not match
 * a kept tab is dropped. Unknown versions (and non-records) yield null.
 */
export function parseOpenPaneTabs(raw: string | null): OpenPaneTabsRecord | null {
  let saved: unknown;
  try {
    saved = JSON.parse(raw ?? "null");
  } catch {
    return null;
  }
  if (saved === null || typeof saved !== "object" || Array.isArray(saved)) return null;
  const record = saved as { version?: unknown; tabs?: unknown; focusedPaneId?: unknown };
  if (record.version !== 1) return null;
  const tabs: StoredPaneTab[] = [];
  if (Array.isArray(record.tabs)) {
    for (const tab of record.tabs) {
      if (tab === null || typeof tab !== "object" || Array.isArray(tab)) continue;
      const candidate = tab as { sessionId?: unknown; label?: unknown; projectName?: unknown };
      if (typeof candidate.sessionId !== "string" || candidate.sessionId.length === 0) continue;
      if (isNewSessionTab(candidate.sessionId)) continue;
      if (typeof candidate.label !== "string" || typeof candidate.projectName !== "string") continue;
      if (tabs.some((existing) => existing.sessionId === candidate.sessionId)) continue;
      tabs.push({ sessionId: candidate.sessionId, label: candidate.label, projectName: candidate.projectName });
    }
  }
  const focusedPaneId = typeof record.focusedPaneId === "string"
    && tabs.some((existing) => existing.sessionId === record.focusedPaneId)
    ? record.focusedPaneId
    : null;
  return { version: 1, tabs, focusedPaneId };
}

/**
 * Serialize the live strip. The sentinel new-session tab and panes with
 * non-string label/projectName (impossible from PaneTab, defensive) are
 * excluded, and a focusedPaneId that matches no stored tab is dropped.
 */
function toStoredPaneTabs(tabs: PaneTab[]): StoredPaneTab[] {
  const stored: StoredPaneTab[] = [];
  for (const tab of tabs) {
    if (isNewSessionTab(tab.sessionId)) continue;
    if (typeof tab.label !== "string" || typeof tab.projectName !== "string") continue;
    if (stored.some((existing) => existing.sessionId === tab.sessionId)) continue;
    stored.push({ sessionId: tab.sessionId, label: tab.label, projectName: tab.projectName });
  }
  return stored;
}

export function serializeOpenPaneTabs(tabs: PaneTab[], focusedPaneId: string | null): string {
  const stored = toStoredPaneTabs(tabs);
  const focused = focusedPaneId !== null
    && stored.some((existing) => existing.sessionId === focusedPaneId)
    ? focusedPaneId
    : null;
  return JSON.stringify({ version: 1, tabs: stored, focusedPaneId: focused });
}

/** Read the record; null when storage is unavailable, failing, or unparseable. */
export function readOpenPaneTabs(storage: StorageLike | null = getBrowserStorage()): OpenPaneTabsRecord | null {
  if (!storage) return null;
  try {
    return parseOpenPaneTabs(storage.getItem(OPEN_PANE_TABS_KEY));
  } catch {
    return null;
  }
}

/** Persist the strip; best-effort, storage failures are swallowed. */
export function writeOpenPaneTabs(
  tabs: PaneTab[],
  focusedPaneId: string | null,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    // An empty strip (all real panes closed) REMOVES the key (spec R2): the
    // next reload must start from the entry logic, not parse an empty record.
    if (toStoredPaneTabs(tabs).length === 0) {
      storage.removeItem(OPEN_PANE_TABS_KEY);
      return;
    }
    storage.setItem(OPEN_PANE_TABS_KEY, serializeOpenPaneTabs(tabs, focusedPaneId));
  } catch {
    // Best-effort persistence: a full or blocked localStorage never crashes.
  }
}
