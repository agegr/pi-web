import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  createServerClock,
  isMarkRead,
  manualMarkTime,
  needsRead,
  parseUnreadMarks,
  sameMarksOr,
  serializeUnreadMarks,
  unreadIdsOf,
  withoutReadMarks,
} = await jiti.import("./unread-markers.ts");

test("markers round-trip through storage, and the id list of older builds reads as markers any read clears", () => {
  const marks = new Map([["a", 10], ["b", 20]]);
  const raw = serializeUnreadMarks(marks);
  assert.deepEqual([...parseUnreadMarks(raw)], [["a", 10], ["b", 20]]);
  assert.equal(serializeUnreadMarks(new Map()), null);

  assert.deepEqual([...parseUnreadMarks('["a","b",3]')], [["a", 0], ["b", 0]]);
  assert.deepEqual([...parseUnreadMarks('{"a":1,"b":-1,"c":"2","d":null}')], [["a", 1]]);
  assert.deepEqual([...parseUnreadMarks("{not json")], []);
  assert.deepEqual([...parseUnreadMarks(null)], []);
});

test("an adoption keeps the same Map while nothing changed, times included", () => {
  const previous = new Map([["a", 1]]);
  assert.equal(sameMarksOr(previous, new Map([["a", 1]])), previous);
  assert.notEqual(sameMarksOr(previous, new Map([["a", 2]])), previous);
  assert.notEqual(sameMarksOr(previous, new Map([["b", 1]])), previous);
});

test("a read clears only the markers set before it", () => {
  assert.equal(isMarkRead(100, undefined), false);
  assert.equal(isMarkRead(100, 99), false);
  assert.equal(isMarkRead(100, 100), true);

  const marks = new Map([["office", 100], ["later", 300], ["never", 50]]);
  // Read at the office at 200: the dot set at home at 100 goes; the run that
  // finished after that read (marked at 300) keeps its dot; an unread one stays.
  const readAt = { office: 200, later: 200 };
  assert.deepEqual([...withoutReadMarks(marks, readAt)], [["later", 300], ["never", 50]]);
  assert.deepEqual([...unreadIdsOf(marks, readAt)], ["later", "never"]);
  // Nothing covered: the same Map, so the cleanup effect settles.
  assert.equal(withoutReadMarks(marks, { other: 999 }), marks);
  assert.equal(withoutReadMarks(marks, undefined), marks);
  // A legacy marker (0) goes with any read of it.
  assert.deepEqual([...withoutReadMarks(new Map([["old", 0]]), { old: 1 })], []);
});

test("a hand-set marker is dated after the session's last read", () => {
  assert.equal(manualMarkTime(500, undefined), 500);
  assert.equal(manualMarkTime(500, 400), 500);
  // The page's estimate of the server's clock lags a read it just made.
  assert.equal(manualMarkTime(500, 600), 601);
  assert.equal(isMarkRead(manualMarkTime(500, 600), 600), false);
});

test("a look writes a read only when there is something new to read", () => {
  const base = { readAt: 100, modifiedMs: 90, marked: false, pending: false };
  assert.equal(needsRead(base), false, "nothing changed since the last read");
  assert.equal(needsRead({ ...base, modifiedMs: 150 }), true, "changed since");
  assert.equal(needsRead({ ...base, readAt: undefined }), true, "never read");
  assert.equal(needsRead({ ...base, marked: true }), true, "this browser has a dot for it");
  assert.equal(needsRead({ ...base, pending: true }), true, "a run ended here while nobody looked");
  assert.equal(needsRead({ ...base, modifiedMs: undefined }), false);
});

test("the server clock is estimated from the poll's round trip", () => {
  let now = 1_000;
  const clock = createServerClock(() => now);
  assert.equal(clock.toServer(), 1_000, "one clock until a poll answers");
  // Sent at 1000, answered at 1100; the server said 5050 (its midpoint is 1050 here).
  clock.note(5_050, 1_000, 1_100);
  assert.equal(clock.toServer(1_050), 5_050);
  now = 2_000;
  assert.equal(clock.toServer(), 6_000);
  clock.note(Number.NaN, 0, 0);
  assert.equal(clock.toServer(), 6_000, "a bad answer is ignored");
});
