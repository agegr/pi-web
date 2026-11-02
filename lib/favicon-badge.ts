// The browser tab's favicon mirrors the sidebar's activity state (#1483): a
// persistent badge in the tab strip after the completion sound fades, so a
// background tab shows it needs attention without being opened. Colors match
// the sidebar's status dots (app/sidebar.css: awaiting amber, unread blue).

export interface FaviconBadgeCounts {
  awaiting: number;
  unread: number;
}

export interface FaviconBadge {
  kind: "awaiting" | "unread";
  count: number;
}

export const FAVICON_BASE_ICON_URL = "/icons/icon-192.png";
export const FAVICON_BADGE_MAX_COUNT = 99;

export const FAVICON_BADGE_COLORS = {
  awaiting: "#d97706",
  unread: "#0891b2",
} as const;

function cleanCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function getFaviconBadge(counts: FaviconBadgeCounts): FaviconBadge | null {
  const awaiting = cleanCount(counts.awaiting);
  const unread = cleanCount(counts.unread);
  const total = awaiting + unread;
  if (total <= 0) return null;
  return {
    kind: awaiting > 0 ? "awaiting" : "unread",
    count: Math.min(total, FAVICON_BADGE_MAX_COUNT),
  };
}

export function faviconBadgeKey(badge: FaviconBadge | null): string {
  return badge ? `${badge.kind}:${badge.count}` : "none";
}

/**
 * The unread count the badge shows: the sidebar's unread markers plus the
 * sessions that finished while the tab was hidden. Those are usually the
 * selected session, which the markers exclude ("already looking" — false
 * while hidden), so an id already marked is not counted twice (#1484).
 */
export function countFaviconUnread(unreadSessionIds: Set<string>, hiddenFinishedSessionIds?: Set<string>): number {
  if (!hiddenFinishedSessionIds || hiddenFinishedSessionIds.size === 0) return unreadSessionIds.size;
  let extra = 0;
  for (const id of hiddenFinishedSessionIds) {
    if (!unreadSessionIds.has(id)) extra += 1;
  }
  return unreadSessionIds.size + extra;
}

let lastSyncedKey: string | null = null;
let baseIconPromise: Promise<HTMLImageElement | null> | null = null;
const defaultIconHrefs = new Map<HTMLLinkElement, string>();

function getIconLinks(): HTMLLinkElement[] {
  return [...document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')];
}

function loadBaseIcon(): Promise<HTMLImageElement | null> {
  if (!baseIconPromise) {
    baseIconPromise = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = FAVICON_BASE_ICON_URL;
    });
  }
  return baseIconPromise;
}

async function drawBadgedIcon(badge: FaviconBadge, key: string): Promise<void> {
  const base = await loadBaseIcon();
  if (!base || lastSyncedKey !== key) return;
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, size, size);
  context.drawImage(base, 0, 0, size, size);
  // Badge circle in the top-right corner, chunky enough to read at 16px.
  const hasCount = badge.count > 1;
  const radius = hasCount ? 56 : 42;
  const centerX = size - radius - 10;
  const centerY = radius + 10;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fillStyle = FAVICON_BADGE_COLORS[badge.kind];
  context.fill();
  context.lineWidth = 10;
  context.strokeStyle = "#ffffff";
  context.stroke();
  if (hasCount) {
    context.fillStyle = "#ffffff";
    context.font = `bold ${badge.count > 9 ? 56 : 68}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(badge.count), centerX, centerY + 4);
  }
  if (lastSyncedKey !== key) return;
  const url = canvas.toDataURL("image/png");
  for (const link of getIconLinks()) link.href = url;
}

export function syncFaviconBadge(counts: FaviconBadgeCounts): void {
  if (typeof document === "undefined") return;
  const badge = getFaviconBadge(counts);
  const key = faviconBadgeKey(badge);
  if (key === lastSyncedKey) return;
  lastSyncedKey = key;
  if (!badge) {
    for (const [link, href] of defaultIconHrefs) link.href = href;
    return;
  }
  for (const link of getIconLinks()) {
    if (!defaultIconHrefs.has(link)) defaultIconHrefs.set(link, link.href);
  }
  void drawBadgedIcon(badge, key);
}
