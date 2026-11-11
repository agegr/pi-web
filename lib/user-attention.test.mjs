import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { ATTENTION_INPUT_EVENTS, ATTENTION_WINDOW_MS, createAttentionTracker, isPageAttended } = await jiti.import("./user-attention.ts");
const source = await readFile(new URL("./user-attention.ts", import.meta.url), "utf8");

function setup() {
  const page = { active: true, now: 0 };
  const tracker = createAttentionTracker(() => page.active, () => page.now, 1_000);
  const calls = [];
  tracker.onAttended(() => calls.push(page.now));
  return { page, tracker, calls };
}

test("a page is attended only after an input, while visible and focused, within the window", () => {
  const { page, tracker } = setup();
  assert.equal(tracker.isAttended(), false, "a restored tab nobody touched reads nothing");
  tracker.noteInput();
  assert.equal(tracker.isAttended(), true);
  page.now = 999;
  assert.equal(tracker.isAttended(), true);
  page.now = 1_000;
  assert.equal(tracker.isAttended(), false, "the window lapsed");
  page.now = 500;
  page.active = false;
  assert.equal(tracker.isAttended(), false, "hidden or unfocused");
});

test("the listener fires each time the page turns attended, not on every input", () => {
  const { page, tracker, calls } = setup();
  tracker.noteInput();
  page.now = 200;
  tracker.noteInput();
  assert.deepEqual(calls, [0], "a second input in the window is no return");

  // Away past the window, back with a key press.
  page.now = 2_000;
  tracker.noteInput();
  assert.deepEqual(calls, [0, 2_000]);

  // Another window took focus, then this one has it again soon after an input.
  page.active = false;
  page.now = 2_100;
  tracker.notePageChange();
  page.active = true;
  page.now = 2_200;
  tracker.notePageChange();
  assert.deepEqual(calls, [0, 2_000, 2_200]);

  // Focus back long after the last input is no look: nobody pressed anything.
  page.active = false;
  tracker.notePageChange();
  page.active = true;
  page.now = 9_000;
  tracker.notePageChange();
  assert.deepEqual(calls, [0, 2_000, 2_200]);
});

test("pointer moves do not count, and nothing is attended on the server or before anyone subscribes", () => {
  assert.deepEqual([...ATTENTION_INPUT_EVENTS], ["pointerdown", "keydown", "wheel", "touchstart"]);
  assert.doesNotMatch(source, /"(pointermove|mousemove)"/);
  assert.equal(ATTENTION_WINDOW_MS, 120_000);
  assert.equal(isPageAttended(), false);
});
