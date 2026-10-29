import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildContextMap, calculateFitMapScale, contextCategoryColor } = await jiti.import("./context-usage-map.ts");

function usage(categories, contextWindow = 100_000, reserveTokens) {
  return {
    categories,
    estimatedTokens: categories.reduce((sum, category) => sum + category.tokens, 0),
    reported: { tokens: null, contextWindow, percent: null },
    ...(reserveTokens ? { reserveTokens } : {}),
    computedAt: 0,
  };
}

test("lays categories over the window in order, then free space, then the reserve", () => {
  const map = buildContextMap(usage([
    { id: "system-prompt", label: "System Prompt", tokens: 10_000 },
    { id: "user-messages", label: "User", tokens: 10_000 },
  ], 100_000, 20_000), 10, 1);
  assert.equal(map.cells.length, 10);
  assert.equal(map.blockTokens, 10_000);
  assert.deepEqual(map.cells.map((cell) => cell.categoryId ?? cell.fill), [
    "system-prompt", "user-messages", "free", "free", "free", "free", "free", "free", "buffer", "buffer",
  ]);
});

test("marks a cell a category only partly fills", () => {
  const map = buildContextMap(usage([{ id: "a", label: "A", tokens: 1_500 }], 10_000), 10, 1);
  assert.deepEqual(map.cells.slice(0, 3).map((cell) => cell.fill), ["full", "partial", "free"]);
});

test("Fit adds headroom, rounds to two digits, and keeps the reserve out of range", () => {
  const small = usage([{ id: "a", label: "A", tokens: 30_000 }], 200_000, 16_000);
  assert.equal(calculateFitMapScale(small), 35_000);
  assert.equal(calculateFitMapScale(usage([{ id: "a", label: "A", tokens: 100 }], 200_000)), 10_000);
  assert.equal(calculateFitMapScale(usage([{ id: "a", label: "A", tokens: 190_000 }], 200_000)), 200_000);
  const map = buildContextMap(small, 7, 1, 35_000);
  assert.equal(map.cells.filter((cell) => cell.fill === "buffer").length, 0);
  assert.equal(map.cells.filter((cell) => cell.categoryId === "a").length, 6);
});

test("has no map without a context window", () => {
  assert.equal(buildContextMap({ ...usage([]), reported: null }, 10, 1), undefined);
});

test("keeps a category's color by id", () => {
  assert.equal(contextCategoryColor("tool-output", 0), contextCategoryColor("tool-output", 5));
  assert.notEqual(contextCategoryColor("system-prompt", 0), contextCategoryColor("tool-output", 0));
});
