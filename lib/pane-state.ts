export interface PaneTab {
  sessionId: string;
  label: string;
  hasBadge: boolean;
}

// --- Width-adaptive pane sizing (pi#20) ---
// Pane widths are auto-computed from the measured pane-area width: panes
// split the area equally while they all fit, and once the open count exceeds
// floor(areaWidth / MIN_PANE_WIDTH) every pane is exactly MIN_PANE_WIDTH wide
// and the pane area scrolls horizontally. This replaces the old localStorage
// persisted manual visible-pane cap (pi#13).
export const MIN_PANE_WIDTH = 360;

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
  const maxVisible = Math.max(1, Math.floor(areaWidth / minPaneWidth));
  if (openCount <= maxVisible) return areaWidth / openCount;
  return minPaneWidth;
}

export function openPane(
  tabs: PaneTab[],
  sessionId: string,
  label: string,
): PaneTab[] {
  const existing = tabs.find((t) => t.sessionId === sessionId);
  if (existing) return tabs;
  return [...tabs, { sessionId, label, hasBadge: false }];
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
): { tabs: PaneTab[]; existed: boolean } {
  if (tabs.some((t) => t.sessionId === NEW_SESSION_TAB_ID)) {
    return { tabs, existed: true };
  }
  return { tabs: [...tabs, { sessionId: NEW_SESSION_TAB_ID, label, hasBadge: false }], existed: false };
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
