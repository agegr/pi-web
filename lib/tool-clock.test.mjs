import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { applyToolClockEvent, endedToolClocks, withoutToolClock, toolClockMs, NO_TOOL_CLOCKS } = await jiti.import("./tool-clock.ts");

const start = (extra = {}) => ({ type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", ...extra });
const end = (extra = {}) => ({ type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", isError: false, ...extra });

test("a live start counts from when it reached the page", () => {
  const clocks = applyToolClockEvent(NO_TOOL_CLOCKS, start(), 5_000);
  assert.deepEqual(clocks.get("call-1"), { startedAt: 5_000 });
  assert.equal(toolClockMs(clocks.get("call-1"), 9_200), 4_200);
});

test("a replayed start counts from how long the server says the call has run", () => {
  const clocks = applyToolClockEvent(NO_TOOL_CLOCKS, start({ elapsedMs: 37_400 }), 50_000);
  assert.equal(toolClockMs(clocks.get("call-1"), 50_000), 37_400);
});

test("a call keeps its clock when its start comes again", () => {
  const clocks = applyToolClockEvent(NO_TOOL_CLOCKS, start(), 1_000);
  assert.equal(applyToolClockEvent(clocks, start({ elapsedMs: 0 }), 8_000), clocks);
});

test("an end keeps pi's measured time, or drops the clock without one", () => {
  const running = applyToolClockEvent(NO_TOOL_CLOCKS, start(), 1_000);
  const ended = applyToolClockEvent(running, end({ durationMs: 4_200 }), 60_000);
  assert.deepEqual(ended.get("call-1"), { durationMs: 4_200 });
  assert.equal(toolClockMs(ended.get("call-1"), 999_999), 4_200);

  assert.equal(applyToolClockEvent(running, end(), 60_000).has("call-1"), false);
});

test("calls a tool made itself and other events have no clock", () => {
  const nested = { ...start(), toolCallId: "call-1/1", parentToolCallId: "call-1" };
  assert.equal(applyToolClockEvent(NO_TOOL_CLOCKS, nested, 1_000), NO_TOOL_CLOCKS);
  assert.equal(applyToolClockEvent(NO_TOOL_CLOCKS, { type: "tool_execution_update", toolCallId: "call-1" }, 1_000), NO_TOOL_CLOCKS);
  assert.equal(applyToolClockEvent(NO_TOOL_CLOCKS, start({ toolCallId: undefined }), 1_000), NO_TOOL_CLOCKS);
});

test("a negative or invalid elapsed time counts from now", () => {
  for (const elapsedMs of [-5, Number.NaN, "12"]) {
    assert.deepEqual(applyToolClockEvent(NO_TOOL_CLOCKS, start({ elapsedMs }), 3_000).get("call-1"), { startedAt: 3_000 });
  }
});

test("a result message removes its call's clock", () => {
  const clocks = applyToolClockEvent(NO_TOOL_CLOCKS, start(), 1_000);
  assert.equal(withoutToolClock(clocks, "call-1").size, 0);
  assert.equal(withoutToolClock(clocks, "other"), clocks);
});

test("a clock never reads below zero", () => {
  assert.equal(toolClockMs({ startedAt: 2_000 }, 1_000), 0);
});

test("a reconnect keeps ended calls' times and drops running clocks", () => {
  const clocks = new Map([["running", { startedAt: 5 }], ["ended", { durationMs: 200 }]]);
  assert.deepEqual([...endedToolClocks(clocks)], [["ended", { durationMs: 200 }]]);
  const ended = new Map([["ended", { durationMs: 200 }]]);
  assert.equal(endedToolClocks(ended), ended);
  assert.equal(endedToolClocks(new Map([["running", { startedAt: 5 }]])), NO_TOOL_CLOCKS);
});
