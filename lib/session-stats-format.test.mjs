import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { formatActiveDuration, formatCompactCount, formatCostShort } = await jiti.import("./session-stats-format.ts");

test("formats counts, costs and durations as the stats toolbar shows them", () => {
  assert.equal(formatCompactCount(950), "950");
  assert.equal(formatCompactCount(18_400), "18k");
  assert.equal(formatCompactCount(1_240_000), "1.2M");
  assert.equal(formatCostShort(0, "en"), null);
  assert.equal(formatCostShort(0.004, "en"), "<$0.01");
  assert.equal(formatCostShort(0.456, "en"), "$0.46");
  // Simplified Chinese converts at the hardcoded rate; Traditional Chinese and English keep dollars.
  assert.equal(formatCostShort(0.456, "zh-CN"), "¥3.05");
  assert.equal(formatCostShort(0.0001, "zh-CN"), "<¥0.01");
  assert.equal(formatCostShort(0.456, "zh-TW"), "$0.46");
  assert.equal(formatActiveDuration(0), "0s");
  assert.equal(formatActiveDuration(42_000), "42s");
  assert.equal(formatActiveDuration(185_000), "3m 5s");
  assert.equal(formatActiveDuration(4_800_000), "1h 20m");
});
