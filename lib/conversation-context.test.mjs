import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildConversationContextModel } = await createJiti(import.meta.url).import("./conversation-context.ts");

const stats = {
  sessionId: "s1",
  userMessages: 1,
  assistantMessages: 1,
  toolCalls: 2,
  toolResults: 2,
  totalMessages: 4,
  tokens: { input: 6400, output: 22000, cacheRead: 339000, cacheWrite: 0, total: 367400 },
  cost: 0.008,
};

test("builds the visible card metrics from existing stats", () => {
  assert.deepEqual(buildConversationContextModel({
    stats,
    contextUsage: { percent: 2.9, tokens: 31000, contextWindow: 1_000_000 },
    modelLabel: "deepseek-v4-flash",
  }), {
    percent: 2.9,
    usedTokens: 31000,
    contextWindow: 1_000_000,
    availableTokens: 969000,
    inputTokens: 6400,
    outputTokens: 22000,
    cacheRead: 339000,
    cacheWrite: 0,
    cacheRate: 98.1,
    totalTokens: 367400,
    modelLabel: "deepseek-v4-flash",
    cost: 0.008,
  });
});

test("clamps context values and avoids a divide-by-zero cache rate", () => {
  const model = buildConversationContextModel({
    stats: { ...stats, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 },
    contextUsage: { percent: 110, tokens: 1200, contextWindow: 1000 },
    modelLabel: null,
  });
  assert.equal(model.percent, 100);
  assert.equal(model.availableTokens, 0);
  assert.equal(model.cacheRate, 0);
  assert.equal(model.modelLabel, "");
});
