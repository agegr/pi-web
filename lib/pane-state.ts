export interface PaneTab {
  sessionId: string;
  label: string;
  hasBadge: boolean;
}

// --- Count-adaptive pane sizing (pi#13) ---
// maxVisiblePanes replaces the old density toggle: panes size at
// 100% / min(openPaneCount, maxVisiblePanes), and the pane area scrolls
// horizontally once the open count exceeds the setting.
export const MAX_VISIBLE_PANES_KEY = "pi-max-visible-panes";
export const MAX_VISIBLE_PANES_MIN = 2;
export const MAX_VISIBLE_PANES_MAX = 4;
export const MAX_VISIBLE_PANES_DEFAULT = 3;

export function clampMaxVisiblePanes(value: number): number {
  if (!Number.isFinite(value)) return MAX_VISIBLE_PANES_DEFAULT;
  const n = Math.trunc(value);
  return Math.min(MAX_VISIBLE_PANES_MAX, Math.max(MAX_VISIBLE_PANES_MIN, n));
}

export function paneWidth(openCount: number, maxVisiblePanes: number): string {
  if (openCount <= 1) return "100%";
  const n = clampMaxVisiblePanes(maxVisiblePanes);
  const fraction = 100 / Math.min(openCount, n);
  // toFixed(4) keeps the historical "33.3333%" fraction; parseFloat trims
  // trailing zeros so whole fractions stay "50%" / "25%".
  return `${parseFloat(fraction.toFixed(4))}%`;
}

export interface MaxVisiblePanesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): MaxVisiblePanesStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadMaxVisiblePanes(storage?: Pick<MaxVisiblePanesStorage, "getItem">): number {
  try {
    const raw = (storage ?? defaultStorage())?.getItem(MAX_VISIBLE_PANES_KEY);
    if (raw == null) return MAX_VISIBLE_PANES_DEFAULT;
    return clampMaxVisiblePanes(Number.parseInt(raw, 10));
  } catch {
    return MAX_VISIBLE_PANES_DEFAULT;
  }
}

export function persistMaxVisiblePanes(
  value: number,
  storage?: Pick<MaxVisiblePanesStorage, "setItem">,
): number {
  const clamped = clampMaxVisiblePanes(value);
  try {
    (storage ?? defaultStorage())?.setItem(MAX_VISIBLE_PANES_KEY, String(clamped));
  } catch {
    // Browser storage is best-effort.
  }
  return clamped;
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
