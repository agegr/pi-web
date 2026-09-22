export interface PaneTab {
  sessionId: string;
  label: string;
  /** Sidebar project identity (pi#25): basename of the project root. */
  projectName: string;
  hasBadge: boolean;
}

/**
 * Embedded pane-header attribution (pi#25): `<project> · <session>` for
 * session panes and `<New> · <project>` for the sentinel new-session pane,
 * where the sentinel's localized short "New" word is carried by its label
 * (set from `tabs.new` at the open site).
 */
export function paneHeaderLabel(tab: PaneTab): string {
  if (isNewSessionTab(tab.sessionId)) return `${tab.label} · ${tab.projectName}`;
  return `${tab.projectName} · ${tab.label}`;
}

// --- Width-adaptive pane sizing (pi#20) ---
// Pane widths are auto-computed from the measured pane-area width: panes
// split the area equally while they all fit, and once the open count exceeds
// floor(areaWidth / MIN_PANE_WIDTH) every pane is exactly MIN_PANE_WIDTH wide
// and the pane area scrolls horizontally. This replaces the old localStorage
// persisted manual visible-pane cap (pi#13).
export const MIN_PANE_WIDTH = 520;

/** How many MIN_PANE_WIDTH-wide panes fit the measured pane area. */
export function visiblePaneCapacity(
  areaWidth: number,
  minPaneWidth: number,
): number {
  if (!Number.isFinite(areaWidth) || areaWidth <= 0) return 1;
  if (!Number.isFinite(minPaneWidth) || minPaneWidth <= 0) {
    // Degenerate floor: no capacity bound — sizing falls back to the equal
    // split, so the overflow indicator must stay hidden.
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.max(1, Math.floor(areaWidth / minPaneWidth));
}

export function paneWidth(
  openCount: number,
  areaWidth: number,
  minPaneWidth: number,
): number {
  if (openCount <= 1) return areaWidth;
  if (!Number.isFinite(minPaneWidth) || minPaneWidth <= 0) {
    // Defensive guard (mirrors the old NaN-clamping posture): a degenerate
    // floor falls back to the plain equal split of the area.
    return areaWidth / openCount;
  }
  const maxVisible = visiblePaneCapacity(areaWidth, minPaneWidth);
  if (openCount <= maxVisible) return areaWidth / openCount;
  return minPaneWidth;
}

export function openPane(
  tabs: PaneTab[],
  sessionId: string,
  label: string,
  projectName: string,
): PaneTab[] {
  const existing = tabs.find((t) => t.sessionId === sessionId);
  if (existing) return tabs;
  return [...tabs, { sessionId, label, projectName, hasBadge: false }];
}

// --- New-session tab (pi#21) ---
// The new-session page renders as an ordinary pane tab whose sessionId is a
// sentinel constant instead of a real session id. Every tab path (widths,
// scrolling, focus, close, PaneHeader) treats it uniformly, and a single
// constant sentinel guarantees at most one new-session tab by construction.
export const NEW_SESSION_TAB_ID = "__new-session__";

export function isNewSessionTab(sessionId: string): boolean {
  return sessionId === NEW_SESSION_TAB_ID;
}

/** At least one tab is a real (non-sentinel) session pane. */
export function hasSessionTab(tabs: PaneTab[]): boolean {
  return tabs.some((t) => t.sessionId !== NEW_SESSION_TAB_ID);
}

/**
 * Insert the new-session tab at the tail unless one is already open.
 * Reports whether the tab already existed so callers can focus/scroll the
 * existing tab instead of duplicating it.
 */
export function openNewSessionTab(
  tabs: PaneTab[],
  label: string,
  projectName: string,
): { tabs: PaneTab[]; existed: boolean } {
  if (tabs.some((t) => t.sessionId === NEW_SESSION_TAB_ID)) {
    return { tabs, existed: true };
  }
  return {
    tabs: [...tabs, { sessionId: NEW_SESSION_TAB_ID, label, projectName, hasBadge: false }],
    existed: false,
  };
}

// --- Background-tasks panel session (pi#28) ---
// The background-tasks panel follows the FOCUSED pane's session, not the
// classic selectedSession: in split view pane focus only updates
// focusedPaneId (never selectedSession), so reading selectedSession left the
// panel permanently "unavailable" whenever a real session pane was focused
// (pi#28 — same family as pi#23's focused-pane usage stats).
export function resolveBackgroundTasksSessionId({
  splitPaneEnabled,
  focusedPaneId,
  selectedSessionId,
  lastSessionPaneId,
  paneTabs,
}: {
  splitPaneEnabled: boolean;
  focusedPaneId: string | null;
  selectedSessionId: string | null;
  /** Most recent non-sentinel focused pane id (may point at a closed pane). */
  lastSessionPaneId: string | null;
  paneTabs: PaneTab[];
}): string | null {
  // Classic layout (split off / mobile): the single chat IS the selection.
  if (!splitPaneEnabled) return selectedSessionId;
  // Split view with a real session pane focused: follow it exactly.
  if (focusedPaneId && !isNewSessionTab(focusedPaneId)) return focusedPaneId;
  // Sentinel (new-session) pane focused, or no focus yet: keep following the
  // last focused session pane while it is still open, else any open session
  // pane, so the panel shows that session's (usually empty) list instead of
  // "unavailable" while the user drafts a new session beside existing panes.
  const openSessionIds = new Set(
    paneTabs.filter((t) => !isNewSessionTab(t.sessionId)).map((t) => t.sessionId),
  );
  if (lastSessionPaneId && openSessionIds.has(lastSessionPaneId)) return lastSessionPaneId;
  const firstOpenSession = paneTabs.find((t) => !isNewSessionTab(t.sessionId));
  if (firstOpenSession) return firstOpenSession.sessionId;
  return selectedSessionId;
}

export function closePane(tabs: PaneTab[], sessionId: string): PaneTab[] {
  return tabs.filter((t) => t.sessionId !== sessionId);
}

export function focusPane(tabs: PaneTab[], focusedId: string | null, sessionId: string): string {
  const exists = tabs.some((t) => t.sessionId === sessionId);
  return exists ? sessionId : (focusedId ?? sessionId);
}

export function setCompletionBadge(tabs: PaneTab[], sessionId: string): PaneTab[] {
  return tabs.map((t) =>
    t.sessionId === sessionId ? { ...t, hasBadge: true } : t,
  );
}

export function clearBadgeOnFocus(tabs: PaneTab[], sessionId: string): PaneTab[] {
  return tabs.map((t) =>
    t.sessionId === sessionId ? { ...t, hasBadge: false } : t,
  );
}

const SOUND_COALESCE_WINDOW_MS = 500;

export function coalesceCompletionSound(
  lastPlayedAt: number,
  now: number,
  windowMs: number = SOUND_COALESCE_WINDOW_MS,
): boolean {
  return now - lastPlayedAt >= windowMs;
}

export function isPlainClick(
  hadTextSelectionAtPointerUp: boolean,
): boolean {
  return !hadTextSelectionAtPointerUp;
}
