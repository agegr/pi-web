/**
 * The math of the mobile interface's touch gestures (hooks/useSwipePanel.ts and
 * the bottom sheet in components/SidebarMenu.tsx): how a finger's movement is
 * read, and how far and how fast it has to get before a drawer, the file panel
 * or a sheet follows it.
 *
 * Every gesture has one destination — the sidebar opens, the file panel
 * closes, the sheet leaves the screen — so a swipe is measured as travel
 * toward that destination. Short of the commit point, and without a flick,
 * the panel settles back where it was.
 */

/** A touch has to move this far before the gesture is read at all. */
export const SWIPE_SLOP_PX = 6;
/** Sideways movement wins over vertical only when it is clearly larger: a diagonal scroll stays a scroll. */
export const SWIPE_DIRECTION_RATIO = 1.2;
/** Fraction of the panel's size a drag must cover to commit on release. */
export const SWIPE_COMMIT_FRACTION = 0.33;
/** A flick this fast (px/ms) commits too, once it has travelled SWIPE_FLING_MIN_TRAVEL_PX. */
export const SWIPE_FLING_VELOCITY = 0.45;
export const SWIPE_FLING_MIN_TRAVEL_PX = 18;
/** Movement older than this is not part of the release velocity. */
export const SWIPE_VELOCITY_WINDOW_MS = 100;

/** A bottom sheet is dismissed with a shorter drag than a full-height drawer needs. */
export const SHEET_DISMISS_FRACTION = 0.22;
export const SHEET_DISMISS_VELOCITY = 0.5;
export const SHEET_DISMISS_MIN_TRAVEL_PX = 24;
/** How long the sheet takes to leave the screen before it is closed. */
export const SHEET_EXIT_MS = 160;

export type SwipeIntent = "pending" | "horizontal" | "vertical";

export interface SwipeSample {
  /** Pixels travelled toward the gesture's destination. */
  travel: number;
  /** The event's timeStamp. */
  time: number;
}

/**
 * Which way a touch is going. "pending" means wait for a clearer direction: a
 * few pixels either way is not a decision, and a diagonal stays undecided
 * until it leans one way.
 */
export function readSwipeIntent(dx: number, dy: number): SwipeIntent {
  const horizontal = Math.abs(dx);
  const vertical = Math.abs(dy);
  if (horizontal < SWIPE_SLOP_PX && vertical < SWIPE_SLOP_PX) return "pending";
  if (horizontal > vertical * SWIPE_DIRECTION_RATIO) return "horizontal";
  if (vertical > horizontal * SWIPE_DIRECTION_RATIO) return "vertical";
  return "pending";
}

/** The finger's travel toward the destination: positive only when it moves the panel's way. */
export function swipeTravel(dx: number, direction: 1 | -1): number {
  return dx * direction;
}

/** Speed of the drag's last moments, toward the destination, in px/ms. */
export function velocityOf(samples: readonly SwipeSample[], now: number): number {
  const last = samples.at(-1);
  const first = samples[0];
  if (!last || !first || samples.length < 2) return 0;
  // A finger that stopped before letting go is not a flick.
  if (now - last.time > SWIPE_VELOCITY_WINDOW_MS) return 0;
  const elapsed = last.time - first.time;
  return elapsed > 0 ? (last.travel - first.travel) / elapsed : 0;
}

/** Whether a released drawer or panel goes to its destination rather than settling back. */
export function swipeCommits({
  travel,
  size,
  velocity,
}: {
  travel: number;
  /** The panel's width, or the sheet's height. */
  size: number;
  /** px/ms toward the destination. */
  velocity: number;
}): boolean {
  if (size <= 0) return false;
  const committed = travel >= size * SWIPE_COMMIT_FRACTION;
  const flicked = velocity >= SWIPE_FLING_VELOCITY && travel >= SWIPE_FLING_MIN_TRAVEL_PX;
  return committed || flicked;
}

/** Whether a released bottom sheet leaves the screen. */
export function sheetDismisses({
  travel,
  height,
  velocity,
}: {
  travel: number;
  height: number;
  velocity: number;
}): boolean {
  if (height <= 0) return false;
  const dragged = travel >= height * SHEET_DISMISS_FRACTION;
  const flicked = velocity >= SHEET_DISMISS_VELOCITY && travel >= SHEET_DISMISS_MIN_TRAVEL_PX;
  return dragged || flicked;
}
