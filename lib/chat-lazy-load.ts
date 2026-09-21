export const VISIBLE_PAGE_SIZE = 50;
export const CHAT_SCROLL_TAIL_TOLERANCE = 8;
export const CHAT_SCROLL_REATTACH_TOLERANCE = 96;

export function getVisibleRenderWindow(totalCount: number, visibleCount: number): {
  startIndex: number;
  hasMore: boolean;
} {
  const clampedVisibleCount = Math.min(Math.max(visibleCount, 0), Math.max(totalCount, 0));
  const startIndex = Math.max(0, totalCount - clampedVisibleCount);
  return { startIndex, hasMore: startIndex > 0 };
}

export function getNextVisibleCount(currentVisibleCount: number, pageSize = VISIBLE_PAGE_SIZE): number {
  return currentVisibleCount + pageSize;
}

export function captureScrollDistance(scrollHeight: number, scrollTop: number): number {
  return scrollHeight - scrollTop;
}

export function restoreScrollTop(scrollHeight: number, savedDistance: number): number {
  return Math.max(0, scrollHeight - savedDistance);
}

/**
 * Scroll anchor captured before an upward history page load (pi#16).
 * `distance` is the bottom-anchored offset (scrollHeight - scrollTop);
 * `scrollHeight` and `firstEntryId` record the DOM state at capture so the
 * restore effect can tell a committed prepend (height grew and the first
 * rendered entry changed) apart from tail growth (streaming appends: height
 * grew but the first entry is unchanged) and from a not-yet-committed state
 * (height unchanged).
 */
export interface ScrollAnchorSnapshot {
  distance: number;
  scrollHeight: number;
  firstEntryId: string | null;
}

export function captureScrollAnchor(
  scrollHeight: number,
  scrollTop: number,
  firstEntryId: string | null,
): ScrollAnchorSnapshot {
  return { distance: captureScrollDistance(scrollHeight, scrollTop), scrollHeight, firstEntryId };
}

export function shouldRestoreScrollAnchor(
  snapshot: ScrollAnchorSnapshot,
  currentScrollHeight: number,
  currentFirstEntryId: string | null,
): boolean {
  if (currentScrollHeight === snapshot.scrollHeight) return false;
  if (snapshot.firstEntryId === null) return true;
  return currentFirstEntryId !== snapshot.firstEntryId;
}

export function isScrollAtTail(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  tolerance = CHAT_SCROLL_TAIL_TOLERANCE,
): boolean {
  return scrollTop + clientHeight >= scrollHeight - tolerance;
}

export function getLiveFollowAttached(
  wasAttached: boolean,
  previousScrollTop: number,
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  reattachTolerance = CHAT_SCROLL_REATTACH_TOLERANCE,
): boolean {
  if (isScrollAtTail(scrollTop, clientHeight, scrollHeight)) return true;
  if (scrollTop < previousScrollTop) return false;
  if (
    !wasAttached
    && scrollTop > previousScrollTop
    && isScrollAtTail(scrollTop, clientHeight, scrollHeight, reattachTolerance)
  ) return true;
  return wasAttached;
}

export function getPromptAnchorSpacerHeight(
  targetTop: number,
  contentEnd: number,
  clientHeight: number,
): number {
  const clampedTargetTop = Math.max(0, targetTop);
  if (clampedTargetTop === 0) return 0;

  return Math.max(0, Math.ceil(
    clampedTargetTop + clientHeight - Math.max(0, contentEnd),
  ));
}
