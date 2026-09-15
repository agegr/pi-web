import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { computeSessionTiming, computeSessionTotalActiveMs, PI_WEB_TIMING_CUSTOM_TYPE } =
  await jiti.import("./session-timing.ts");

const base = Date.parse("2026-01-01T00:00:00.000Z");
const timestamp = (ms) => new Date(base + ms).toISOString();
let nextId = 0;

function entry(type, ms, extra = {}) {
  return {
    type,
    id: String(++nextId),
    parentId: null,
    timestamp: timestamp(ms),
    ...extra,
  };
}
function message(role, ms, extra = {}) {
  return entry("message", ms, { ...extra, message: { role, content: [] } });
}

test("empty or single-entry session yields zero", () => {
  assert.equal(computeSessionTotalActiveMs([]), 0);
  assert.equal(computeSessionTotalActiveMs([message("user", 1000)]), 0);
});

test("counts active gaps within a turn", () => {
  const entries = [
    message("user", 1000),
    message("assistant", 4000),
    message("toolResult", 7000),
    message("assistant", 9000),
  ];
  assert.equal(computeSessionTotalActiveMs(entries), 8000);
});

test("drops human idle before the next user message", () => {
  const entries = [
    message("user", 0),
    message("assistant", 3000),
    message("user", 20000),
    message("assistant", 23000),
  ];
  assert.equal(computeSessionTotalActiveMs(entries), 6000);
});

test("keeps compacted history and compaction time in append order", () => {
  const entries = [
    message("user", 0),
    message("assistant", 3000),
    message("user", 20000),
    message("assistant", 25000),
    entry("compaction", 27000),
    message("assistant", 30000),
  ];
  assert.equal(computeSessionTotalActiveMs(entries), 13000);
});

test("counts work appended on every branch exactly once", () => {
  const root = message("user", 0);
  const shared = message("assistant", 2000, { parentId: root.id });
  const branchAUser = message("user", 10000, { parentId: shared.id });
  const branchAResult = message("assistant", 13000, { parentId: branchAUser.id });
  const branchBUser = message("user", 20000, { parentId: shared.id });
  const branchBResult = message("assistant", 24000, { parentId: branchBUser.id });
  const entries = [root, shared, branchAUser, branchAResult, branchBUser, branchBResult];
  assert.equal(computeSessionTotalActiveMs(entries), 9000);
});

test("treats user-initiated bash as a boundary", () => {
  const entries = [
    message("user", 0),
    message("assistant", 2000),
    message("bashExecution", 100000),
    message("user", 110000),
    message("assistant", 113000),
  ];
  assert.equal(computeSessionTotalActiveMs(entries), 5000);
});

test("ignores metadata without breaking the active interval", () => {
  const entries = [
    message("user", 0),
    entry("model_change", 1000),
    message("assistant", 4000),
  ];
  assert.equal(computeSessionTotalActiveMs(entries), 4000);
});

test("counts branch summaries and custom messages", () => {
  const entries = [
    message("user", 0),
    entry("branch_summary", 2000),
    entry("custom_message", 3000),
    message("assistant", 5000),
  ];
  assert.equal(computeSessionTotalActiveMs(entries), 5000);
});

test("skips invalid timestamps and ignores negative gaps", () => {
  const invalid = { ...message("assistant", 2000), timestamp: "invalid" };
  const entries = [message("user", 5000), invalid, message("assistant", 3000)];
  assert.equal(computeSessionTotalActiveMs(entries), 0);
});

function timingEntry(ms, data) {
  return entry("custom", ms, { customType: PI_WEB_TIMING_CUSTOM_TYPE, data });
}

function totals(timing) {
  return timing.modelMs + timing.toolMs + timing.otherMs;
}

test("splits model time from tool time", () => {
  const entries = [
    message("user", 1000),
    message("assistant", 4000),
    message("toolResult", 7000),
    message("assistant", 9000),
  ];
  const timing = computeSessionTiming(entries);
  assert.equal(timing.modelMs, 5000);
  assert.equal(timing.toolMs, 3000);
  assert.equal(timing.otherMs, 0);
  assert.equal(timing.assistantRequests, 2);
  assert.equal(totals(timing), computeSessionTotalActiveMs(entries));
});

test("counts compaction as model time and keeps the active total consistent", () => {
  const entries = [
    message("user", 0),
    message("assistant", 3000),
    message("user", 20000),
    message("assistant", 25000),
    entry("compaction", 27000),
    message("assistant", 30000),
  ];
  const timing = computeSessionTiming(entries);
  // 3000 + 5000 + 2000 (compaction) + 3000, with the idle gap before the second user turn dropped.
  assert.equal(timing.modelMs, 13000);
  assert.equal(timing.toolMs, 0);
  assert.equal(timing.assistantRequests, 3);
  assert.equal(totals(timing), computeSessionTotalActiveMs(entries));
});

test("attributes parallel tool batches by completion order", () => {
  const entries = [
    message("user", 0),
    message("assistant", 2000),
    message("toolResult", 5000),
    message("toolResult", 6000),
    message("toolResult", 9000),
  ];
  const timing = computeSessionTiming(entries);
  assert.equal(timing.modelMs, 2000);
  assert.equal(timing.toolMs, 7000);
  assert.equal(totals(timing), computeSessionTotalActiveMs(entries));
});

test("counts custom messages as other time", () => {
  const entries = [
    message("user", 0),
    entry("custom_message", 1500),
    message("assistant", 4000),
  ];
  const timing = computeSessionTiming(entries);
  assert.equal(timing.otherMs, 1500);
  assert.equal(timing.modelMs, 2500);
  assert.equal(totals(timing), computeSessionTotalActiveMs(entries));
});

test("instrumentation entries never move the anchor", () => {
  const withoutCustom = [
    message("user", 0),
    message("assistant", 2000),
    message("toolResult", 5000),
  ];
  const withCustom = [
    message("user", 0),
    message("assistant", 2000),
    timingEntry(3900, { ttftMs: 900, decodeMs: 1000, outputTokens: 250 }),
    message("toolResult", 5000),
  ];
  const timing = computeSessionTiming(withCustom);
  assert.equal(timing.modelMs, 2000);
  assert.equal(timing.toolMs, 3000);
  assert.equal(totals(timing), computeSessionTiming(withoutCustom).modelMs + 3000);
  assert.equal(computeSessionTotalActiveMs(withCustom), computeSessionTotalActiveMs(withoutCustom));
});

test("ignores unrelated custom entries", () => {
  const entries = [
    message("user", 0),
    entry("custom", 1000, { customType: "some-other-extension", data: { ttftMs: 5 } }),
    message("assistant", 2000),
  ];
  const timing = computeSessionTiming(entries);
  assert.equal(timing.timedRequests, 0);
  assert.equal(timing.ttftAvgMs, null);
  assert.equal(timing.tps, null);
});

test("averages TTFT and weights output speed by decode time", () => {
  const entries = [
    message("user", 0),
    message("assistant", 3000),
    timingEntry(3000, { ttftMs: 1000, decodeMs: 2000, outputTokens: 400 }),
    message("toolResult", 4000),
    message("assistant", 8000),
    // Second request is longer: TPS must be weighted by decode time, not a mean of per-request speeds.
    timingEntry(8000, { ttftMs: 3000, decodeMs: 8000, outputTokens: 800 }),
  ];
  const timing = computeSessionTiming(entries);
  assert.equal(timing.timedRequests, 2);
  assert.equal(timing.ttftAvgMs, 2000);
  assert.equal(timing.tps, 1200 / 10);
});

test("leaves TTFT and speed null without live timing", () => {
  const timing = computeSessionTiming([message("user", 0), message("assistant", 2000)]);
  assert.equal(timing.ttftAvgMs, null);
  assert.equal(timing.tps, null);
  assert.equal(timing.timedRequests, 0);
});

test("reports TTFT without inventing a speed when decode time is missing", () => {
  const timing = computeSessionTiming([
    message("user", 0),
    message("assistant", 2000),
    timingEntry(2000, { ttftMs: 1500 }),
  ]);
  assert.equal(timing.ttftAvgMs, 1500);
  assert.equal(timing.tps, null);
});

test("ignores malformed live timing payloads", () => {
  const entries = [
    message("user", 0),
    message("assistant", 2000),
    timingEntry(2000, null),
    timingEntry(2100, "nope"),
    timingEntry(2200, { ttftMs: -5, decodeMs: "x", outputTokens: Number.NaN }),
  ];
  const timing = computeSessionTiming(entries);
  assert.equal(timing.timedRequests, 0);
  assert.equal(timing.ttftAvgMs, null);
  assert.equal(timing.tps, null);
});

test("empty session times out at zero", () => {
  const timing = computeSessionTiming([]);
  assert.deepEqual(timing, {
    modelMs: 0,
    toolMs: 0,
    otherMs: 0,
    ttftAvgMs: null,
    tps: null,
    timedRequests: 0,
    assistantRequests: 0,
  });
});
