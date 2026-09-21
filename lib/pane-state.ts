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
