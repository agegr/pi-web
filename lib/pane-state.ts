export interface PaneTab {
  sessionId: string;
  label: string;
  hasBadge: boolean;
}

export type PaneDensity = "default" | "compact";

export const DENSITY_WIDTH_FRACTIONS: Record<PaneDensity, string> = {
  default: "33.3333%",
  compact: "25%",
};

export function densityWidth(density: PaneDensity): string {
  return DENSITY_WIDTH_FRACTIONS[density] ?? DENSITY_WIDTH_FRACTIONS.default;
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
