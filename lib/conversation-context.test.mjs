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

test("builds the compact card metrics from existing stats", () => {
  assert.deepEqual(buildConversationContextModel({
    stats,
    contextUsage: { percent: 2.9, tokens: 31000, contextWindow: 1_000_000 },
  }), {
    percent: 2.9,
    usedTokens: 31000,
    contextWindow: 1_000_000,
    availableTokens: 969000,
    userMessages: 1,
    toolCalls: 2,
    cacheHitRate: 98.1,
  });
});

test("clamps context values", () => {
  const model = buildConversationContextModel({
    stats: { ...stats, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 },
    contextUsage: { percent: 110, tokens: 1200, contextWindow: 1000 },
  });
  assert.equal(model.percent, 100);
  assert.equal(model.availableTokens, 0);
  assert.equal(model.cacheHitRate, null);
});
