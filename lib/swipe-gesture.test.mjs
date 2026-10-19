import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  SWIPE_COMMIT_FRACTION,
  SWIPE_FLING_MIN_TRAVEL_PX,
  SWIPE_FLING_VELOCITY,
  SWIPE_SLOP_PX,
  SWIPE_VELOCITY_WINDOW_MS,
  readSwipeIntent,
  sheetDismisses,
  swipeCommits,
  swipeTravel,
  velocityOf,
} = await jiti.import("./swipe-gesture.ts");

test("a press stays undecided until the finger has moved past the slop", () => {
  assert.equal(readSwipeIntent(0, 0), "pending");
  assert.equal(readSwipeIntent(SWIPE_SLOP_PX - 1, 2), "pending");
  // A diagonal waits for a clearer direction.
  assert.equal(readSwipeIntent(10, 10), "pending");
});

test("sideways wins only when it clearly beats the vertical movement", () => {
  assert.equal(readSwipeIntent(-40, 4), "horizontal");
  assert.equal(readSwipeIntent(0, 40), "vertical");
  assert.equal(readSwipeIntent(10, 30), "vertical");
  assert.equal(readSwipeIntent(30, 10), "horizontal");
});

test("travel is measured toward the destination, never away from it", () => {
  // Opening a left drawer: the finger moves right.
  assert.equal(swipeTravel(30, 1), 30);
  assert.equal(swipeTravel(-30, 1), -30);
  // Closing it: the finger moves left.
  assert.equal(swipeTravel(-30, -1), 30);
});

test("a drawer commits at a third of its width, or on a flick", () => {
  const size = 280;
  assert.equal(swipeCommits({ travel: size * SWIPE_COMMIT_FRACTION, size, velocity: 0 }), true);
  assert.equal(swipeCommits({ travel: size * SWIPE_COMMIT_FRACTION - 1, size, velocity: 0 }), false);
  // A quick flick over a short distance commits too.
  assert.equal(swipeCommits({ travel: SWIPE_FLING_MIN_TRAVEL_PX, size, velocity: SWIPE_FLING_VELOCITY }), true);
  // But a fast twitch shorter than the minimum travel does not.
  assert.equal(swipeCommits({ travel: SWIPE_FLING_MIN_TRAVEL_PX - 1, size, velocity: SWIPE_FLING_VELOCITY }), false);
  // Slow and short: settles back.
  assert.equal(swipeCommits({ travel: 40, size, velocity: 0.1 }), false);
  // A panel with no measured size never commits.
  assert.equal(swipeCommits({ travel: 100, size: 0, velocity: 2 }), false);
});

test("the release speed comes from the last moments of the drag", () => {
  const samples = [
    { travel: 0, time: 0 },
    { travel: 30, time: 100 },
    { travel: 60, time: 200 },
  ];
  assert.equal(velocityOf(samples, 200), 0.3);
  // A finger that stopped before letting go is not a flick.
  assert.equal(velocityOf(samples, 200 + SWIPE_VELOCITY_WINDOW_MS + 1), 0);
  // One sample says nothing.
  assert.equal(velocityOf([{ travel: 10, time: 100 }], 100), 0);
  // A drag that reverses has negative speed, never a flick forward.
  assert.equal(velocityOf([{ travel: 60, time: 0 }, { travel: 20, time: 100 }], 100), -0.4);
});

test("a bottom sheet leaves on a shorter drag than a full-height drawer", () => {
  const height = 400;
  assert.equal(sheetDismisses({ travel: 400 * 0.22, height, velocity: 0 }), true);
  assert.equal(sheetDismisses({ travel: 400 * 0.22 - 1, height, velocity: 0 }), false);
  assert.equal(sheetDismisses({ travel: 30, height, velocity: 0.6 }), true);
  assert.equal(sheetDismisses({ travel: 10, height, velocity: 0.6 }), false);
  assert.equal(sheetDismisses({ travel: 300, height: 0, velocity: 1 }), false);
});
