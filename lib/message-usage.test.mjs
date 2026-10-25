import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { formatUsageTokens, averageOutputRate, summarizeTurnUsage, sameUsageSummary } = await jiti.import("./message-usage.ts");
const { getTurnDurationMs } = await jiti.import("./turn-duration.ts");
const usage = (input = 232, output = 258, cacheRead = 57_856, cacheWrite = 0, cost = 0.0088) => ({
  input, output, cacheRead, cacheWrite,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
});
const reply = (at, ms, u = usage()) => ({ role: "assistant", provider: "p", model: "m", content: [], usage: u, timestamp: at, durationMs: ms });
const summary = (durationMs, u = usage()) => ({ usage: u, durationMs, scope: "response", complete: true });

test("uses decimal K/M, one optional decimal, with no rounding at small counts", () => {
  for (const [value, expected] of [
    [0, "0"], [232, "232"], [999, "999"], [1_000, "1K"], [1_049, "1K"],
    [1_050, "1.1K"], [7_241, "7.2K"], [12_000, "12K"], [57_856, "57.9K"],
    [314_138, "314.1K"], [999_949, "999.9K"], [999_950, "1M"], [999_999, "1M"],
    [1_000_000, "1M"], [1_600_640, "1.6M"], [14_600_000, "14.6M"],
  ]) assert.equal(formatUsageTokens(value), expected, String(value));
});

test("rate uses actual output and unrounded milliseconds, not compact counts or displayed seconds", () => {
  assert.equal(averageOutputRate(summary(10_000)), 25.8);
  assert.equal(averageOutputRate(summary(10_900)), 258 / 10.9);
  assert.equal(averageOutputRate(summary(10_000, usage(314_138, 7_241, 1_600_640))), 724.1);
  assert.equal(averageOutputRate(summary(10_000, usage(0, 0))), 0);
});

test("no bogus speed when timing or usage is missing, partial or invalid", () => {
  for (const ms of [undefined, 0, -1, NaN, Infinity]) assert.equal(averageOutputRate(summary(ms)), undefined);
  assert.equal(averageOutputRate({ ...summary(10_000), complete: false }), undefined);
  for (const output of [-1, NaN, Infinity]) assert.equal(averageOutputRate(summary(10_000, usage(0, output))), undefined);
});

test("whole-turn totals include all responses and tool waiting in the matching duration", () => {
  const messages = [
    { role: "user", timestamp: 1_000 },
    reply(1_100, 2_000, usage(100, 200, 1_000, 50, 0.01)),
    { role: "toolResult", timestamp: 8_000, content: [] },
    reply(8_100, 2_900, usage(132, 58, 56_856, 100, 0.02)),
    { role: "user", timestamp: 20_000 },
    reply(20_100, 1_000, usage(99_999, 99_999)),
  ];
  const original = structuredClone(messages);
  const durationMs = getTurnDurationMs(messages, 0, 4);
  assert.equal(durationMs, 10_000);
  const result = summarizeTurnUsage(messages, 1, 4, durationMs);
  assert.equal(result.scope, "turn");
  assert.equal(result.complete, true);
  assert.deepEqual([result.usage.input, result.usage.output, result.usage.cacheRead, result.usage.cacheWrite], [232, 258, 57_856, 150]);
  assert.equal(result.usage.cost.total, 0.03);
  assert.equal(averageOutputRate(result), 25.8);
  assert.deepEqual(messages, original, "summarizing does not alter the transcript");
});

test("unknown responses disable the average; no usage does not fabricate a total", () => {
  const messages = [reply(1, 2), { role: "assistant", content: [] }];
  const partial = summarizeTurnUsage(messages, 0, 2, 100);
  assert.equal(partial.complete, false);
  assert.equal(partial.usage.output, 258);
  assert.equal(averageOutputRate(partial), undefined);
  assert.equal(summarizeTurnUsage(messages, 1, 2, 100), undefined);
  assert.equal(summarizeTurnUsage([], 0, 0), undefined);
});

test("equal derived summaries do not invalidate the memoized message", () => {
  const a = summary(10_000);
  assert.equal(sameUsageSummary(a, structuredClone(a)), true);
  assert.equal(sameUsageSummary(undefined, undefined), true);
  for (const changed of [
    undefined, { ...a, scope: "turn" }, { ...a, complete: false }, { ...a, durationMs: 20_000 },
    { ...a, usage: usage(233) }, { ...a, usage: usage(232, 259) },
    { ...a, usage: usage(232, 258, 1) }, { ...a, usage: usage(232, 258, 57_856, 1) },
    { ...a, usage: usage(232, 258, 57_856, 0, 1) },
  ]) assert.equal(sameUsageSummary(a, changed), false);
});
