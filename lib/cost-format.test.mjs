import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  DEFAULT_COST_DISPLAY_SETTINGS,
  DEFAULT_USD_TO_CNY_RATE,
  formatCost,
  formatCostShort,
  getCostDisplaySettings,
  normalizeCostDisplaySettings,
  setCostDisplaySettings,
  subscribeCostDisplaySettings,
} = await jiti.import("./cost-format.ts");

test("normalizeCostDisplaySettings falls back to defaults for invalid inputs", () => {
  assert.deepEqual(normalizeCostDisplaySettings(undefined), DEFAULT_COST_DISPLAY_SETTINGS);
  assert.deepEqual(normalizeCostDisplaySettings(null), DEFAULT_COST_DISPLAY_SETTINGS);
  assert.deepEqual(normalizeCostDisplaySettings({ costCurrency: "EUR", usdToCnyRate: -1 }), {
    costCurrency: "USD",
    usdToCnyRate: DEFAULT_USD_TO_CNY_RATE,
  });
  assert.deepEqual(normalizeCostDisplaySettings({ costCurrency: "CNY", usdToCnyRate: 7.35 }), {
    costCurrency: "CNY",
    usdToCnyRate: 7.35,
  });
});

test("formatCost and formatCostShort format USD and CNY with custom exchange rate", () => {
  const usd = { costCurrency: "USD", usdToCnyRate: 7.2 };
  const cny = { costCurrency: "CNY", usdToCnyRate: 7.2 };

  assert.equal(formatCost(0.022, 4, usd), "$0.0220");
  assert.equal(formatCost(0.022, 4, cny), "¥0.1584");
  assert.equal(formatCost(0.022, 2, cny), "¥0.16");

  assert.equal(formatCostShort(0, usd), null);
  assert.equal(formatCostShort(0.004, usd), "<$0.01");
  assert.equal(formatCostShort(0.456, usd), "$0.46");

  assert.equal(formatCostShort(0, cny), null);
  assert.equal(formatCostShort(0.001, cny), "<¥0.01");
  assert.equal(formatCostShort(0.022, cny), "¥0.16");
});

test("setCostDisplaySettings updates active settings and notifies subscribers", () => {
  const previous = getCostDisplaySettings();
  let notifications = 0;
  const unsubscribe = subscribeCostDisplaySettings(() => {
    notifications += 1;
  });
  try {
    setCostDisplaySettings({ costCurrency: "CNY", usdToCnyRate: 7.1 });
    assert.deepEqual(getCostDisplaySettings(), { costCurrency: "CNY", usdToCnyRate: 7.1 });
    assert.equal(formatCost(1, 2), "¥7.10");
    assert.equal(notifications, 1);
  } finally {
    unsubscribe();
    setCostDisplaySettings(previous);
  }
});
