import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { SessionCompletionTracker, BackgroundCompletionTracker, backgroundCompletionSessions } = await jiti.import("./session-completion-client.ts");

test("initial snapshots establish history without replay, including no completion yet", () => {
  for (const first of [undefined, "100"]) {
    const tracker = new SessionCompletionTracker();
    assert.equal(tracker.snapshot("main", first), false);
    assert.equal(tracker.connected("main", first), false);
    assert.equal(tracker.snapshot("main", "101"), true);
    assert.equal(tracker.complete("main", "101"), false);
  }
});

test("first HTTP or connected snapshot 100 then genuine live 100 announces once", () => {
  for (const first of ["snapshot", "connected"]) {
    const tracker = new SessionCompletionTracker();
    assert.equal(tracker[first]("main", "100"), false);
    assert.equal(tracker.snapshot("main", "100"), false);
    assert.equal(tracker.complete("main", "100"), true, "initial history is not a delivered notification");
    assert.equal(tracker.complete("main", "100"), false);
    assert.equal(tracker.complete("main", "100"), false);
    assert.equal(tracker.connected("main", "100"), false);
    assert.equal(tracker.snapshot("main", "100"), false);
  }
});

test("subscription-buffered live completion survives pre-subscribe connected and racing HTTP history", () => {
  // The server captures connected's ID synchronously before subscribing. A live
  // completion during subscription is buffered until after connected is sent.
  for (const order of [["connected", "snapshot", "complete"], ["snapshot", "connected", "complete"], ["connected", "complete", "snapshot"]]) {
    const tracker = new SessionCompletionTracker();
    const results = order.map((method) => tracker[method]("main", method === "connected" ? "99" : "100"));
    assert.equal(results.filter(Boolean).length, 1, order.join(" → "));
    assert.equal(tracker.complete("main", "100"), false);
  }
  const tracker = new SessionCompletionTracker();
  assert.equal(tracker.snapshot("main", "101"), false);
  assert.equal(tracker.complete("main", "100"), false, "late live older than history still drops");
});

test("SSE, connected and HTTP snapshots deduplicate the same completion", () => {
  for (const order of [["complete", "snapshot", "connected"], ["snapshot", "connected", "complete"], ["connected", "complete", "snapshot"]]) {
    const tracker = new SessionCompletionTracker();
    tracker.connected("main", "100");
    assert.deepEqual(order.map((method) => tracker[method]("main", "101")), [true, false, false]);
  }
});

test("reconnect and state recovery announce each newer ID once even when already idle", () => {
  const tracker = new SessionCompletionTracker();
  tracker.connected("main", "100");
  assert.equal(tracker.connected("main", "101"), true);
  assert.equal(tracker.snapshot("main", "102"), true);
  assert.equal(tracker.connected("main", "102"), false);
});

test("live completion before the first connected or snapshot is never eaten by history", () => {
  for (const first of ["connected", "snapshot"]) {
    const tracker = new SessionCompletionTracker();
    assert.equal(tracker.complete("main", "200"), true);
    assert.equal(tracker[first]("main", "100"), false);
    assert.equal(tracker.snapshot("main", "150"), false, "old baseline cannot move the high-water mark backwards");
    assert.equal(tracker.connected("main", "200"), false);
    assert.equal(tracker.snapshot("main", "201"), true);
  }
});

test("late older snapshots, missing fields, and late SSE never lower a baseline", () => {
  const tracker = new SessionCompletionTracker();
  tracker.snapshot("main", "9");
  assert.equal(tracker.complete("main", "10"), true, "numeric, not lexical ordering");
  for (const value of ["8", undefined, "9", "", "NaN", "0", "10"]) {
    assert.equal(tracker.snapshot("main", value), false);
  }
  assert.equal(tracker.complete("main", "9"), false);
  assert.equal(tracker.snapshot("main", "11"), true);
  assert.equal(tracker.snapshot("main", "10"), false);
});

test("switching between observed sessions preserves independent baselines; clients are independent", () => {
  const tracker = new SessionCompletionTracker();
  tracker.connected("a", "100");
  tracker.connected("b", "200");
  assert.equal(tracker.snapshot("a", "101"), true);
  assert.equal(tracker.snapshot("b", "201"), true);
  assert.equal(tracker.connected("a", "101"), false);
  const otherClient = new SessionCompletionTracker();
  assert.equal(otherClient.connected("a", "101"), false);
  assert.equal(otherClient.complete("a", "102"), true);
  assert.equal(tracker.complete("a", "102"), true);
});

test("sidebar first poll is silent, including history, then new and newly appearing IDs alert", () => {
  const tracker = new BackgroundCompletionTracker();
  assert.deepEqual(tracker.poll({ a: "100", b: "101" }), []);
  assert.deepEqual(tracker.poll({ a: "100", b: "102", c: "103" }), ["b", "c"]);
  assert.deepEqual(tracker.poll({}), []);
  assert.deepEqual(tracker.poll({ a: "100", b: "102", c: "103" }), []);
  assert.deepEqual(tracker.poll({ a: "99", b: "104" }), ["b"]);
  assert.deepEqual(tracker.poll({ a: "100", b: "104" }), []);
  const emptyInitial = new BackgroundCompletionTracker();
  assert.deepEqual(emptyInitial.poll({}), []);
  assert.deepEqual(emptyInitial.poll({ a: "105" }), ["a"]);
});

test("sidebar consumes selected, deleted, and child IDs without unread or background alerts", () => {
  const tracker = new BackgroundCompletionTracker();
  const sessions = [{ id: "selected" }, { id: "background" }, { id: "child", relation: { kind: "subagent" } }];
  tracker.poll({});
  const completed = tracker.poll({ selected: "100", background: "101", child: "102", deleted: "103" });
  assert.deepEqual(backgroundCompletionSessions(completed, sessions, "selected"), ["background"]);
  assert.deepEqual(backgroundCompletionSessions(tracker.poll({ selected: "100" }), sessions, null), []);
});
