import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  USD_TO_CNY,
  SMALLEST_UNIT,
  currencySymbol,
  displaysCny,
  formatMoney,
  formatMoneyFromCent,
  localAmount,
} = await jiti.import("./money.ts");

test("only Simplified Chinese converts dollar amounts into yuan", () => {
  assert.equal(displaysCny("zh-CN"), true);
  assert.equal(displaysCny("zh-TW"), false);
  assert.equal(displaysCny("en"), false);
  assert.equal(displaysCny(undefined), false);
  assert.equal(USD_TO_CNY > 0, true);
  assert.equal(SMALLEST_UNIT, 0.01);
});

test("converts and formats amounts with the locale's currency symbol", () => {
  assert.equal(localAmount(2, "en"), 2);
  assert.equal(localAmount(2, "zh-TW"), 2);
  assert.equal(localAmount(2, "zh-CN"), 2 * USD_TO_CNY);
  assert.equal(currencySymbol("zh-CN"), "¥");
  assert.equal(currencySymbol("zh-TW"), "$");
  assert.equal(currencySymbol(undefined), "$");
  assert.equal(formatMoney(0.5, "en", 2), "$0.50");
  assert.equal(formatMoney(0.5, "zh-TW", 2), "$0.50");
  assert.equal(formatMoney(0.5, "zh-CN", 2), `¥${(0.5 * USD_TO_CNY).toFixed(2)}`);
  assert.equal(formatMoney(0.456123, "zh-CN", 4), `¥${(0.456123 * USD_TO_CNY).toFixed(4)}`);
});

test("shows nothing below zero and a floored unit below one cent", () => {
  assert.equal(formatMoneyFromCent(0, "en"), null);
  assert.equal(formatMoneyFromCent(-1, "zh-CN"), null);
  assert.equal(formatMoneyFromCent(0.004, "en"), "<$0.01");
  assert.equal(formatMoneyFromCent(0.0001, "zh-CN"), "<¥0.01");
  // Converted, it reaches a cent: the threshold is read in the displayed currency, not in USD.
  assert.equal(formatMoneyFromCent(0.002, "en"), "<$0.01");
  assert.equal(formatMoneyFromCent(0.002, "zh-CN"), "¥0.01");
  assert.equal(formatMoneyFromCent(0.5, "zh-CN"), `¥${(0.5 * USD_TO_CNY).toFixed(2)}`);
});
