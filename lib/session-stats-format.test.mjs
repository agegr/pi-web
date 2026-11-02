import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { formatActiveDuration, formatCompactCount, formatCostShort, formatSessionSummary } = await jiti.import("./session-stats-format.ts");

test("a tab's /session says what the popover's first lines say", () => {
  assert.equal(formatSessionSummary({ totalMessages: 4, tokens: { total: 18_400 }, cost: 0.12 }), "4 messages · 18k tokens · $0.12");
  assert.equal(formatSessionSummary({ totalMessages: 2, tokens: { total: 950 }, cost: 0 }), "2 messages · 950 tokens");
  assert.equal(formatSessionSummary(null), "No usage yet");
});

test("formats counts, costs and durations as the stats toolbar shows them", () => {
  assert.equal(formatCompactCount(950), "950");
  assert.equal(formatCompactCount(18_400), "18k");
  assert.equal(formatCompactCount(1_240_000), "1.2M");
  assert.equal(formatCostShort(0), null);
  assert.equal(formatCostShort(0.004), "<$0.01");
  assert.equal(formatCostShort(0.456), "$0.46");
  assert.equal(formatActiveDuration(0), "0s");
  assert.equal(formatActiveDuration(42_000), "42s");
  assert.equal(formatActiveDuration(185_000), "3m 5s");
  assert.equal(formatActiveDuration(4_800_000), "1h 20m");
});
