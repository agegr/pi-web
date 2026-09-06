import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  computeSessionContextStats,
  computeSessionInputHistory,
  paginateSessionContext,
  parseSessionContextPageRequest,
} = await jiti.import("./session-context-page.ts");

function contextWith(count) {
  return {
    messages: Array.from({ length: count }, (_, index) => ({ role: "user", content: `m${index}` })),
    entryIds: Array.from({ length: count }, (_, index) => `e${index}`),
    thinkingLevel: "off",
    model: null,
  };
}

test("tail and earlier pages preserve absolute parallel message indexes", () => {
  const full = contextWith(300);
  const tail = paginateSessionContext(full, { tail: 120 });
  assert.deepEqual(tail.page, {
    startIndex: 180,
    endIndex: 300,
    totalMessages: 300,
    hasEarlier: true,
  });
  assert.equal(tail.context.messages[0].content, "m180");
  assert.equal(tail.context.entryIds[0], "e180");

  const earlier = paginateSessionContext(full, { before: tail.page.startIndex, limit: 120 });
  assert.deepEqual(earlier.page, {
    startIndex: 60,
    endIndex: 180,
    totalMessages: 300,
    hasEarlier: true,
  });
  assert.equal(earlier.context.messages.at(-1).content, "m179");
  assert.equal(earlier.context.entryIds.at(-1), "e179");

  const first = paginateSessionContext(full, { before: earlier.page.startIndex, limit: 120 });
  assert.deepEqual(first.page, {
    startIndex: 0,
    endIndex: 60,
    totalMessages: 300,
    hasEarlier: false,
  });
});

test("page limits are bounded and invalid cursors cannot escape the context", () => {
  const full = contextWith(500);
  assert.equal(paginateSessionContext(full, { tail: 10_000 }).context.messages.length, 240);
  assert.equal(paginateSessionContext(full, { before: -5, limit: 120 }).context.messages.length, 0);
  assert.equal(paginateSessionContext(full, { before: 10_000, limit: 20 }).page.endIndex, 500);
});

test("page query parsing rejects ambiguous or unsafe cursors", () => {
  assert.deepEqual(
    parseSessionContextPageRequest(new URLSearchParams("tail=60")),
    { tail: 60 },
  );
  assert.deepEqual(
    parseSessionContextPageRequest(new URLSearchParams("before=120&limit=60")),
    { before: 120, limit: 60 },
  );
  assert.equal(parseSessionContextPageRequest(new URLSearchParams()), null);
  assert.throws(() => parseSessionContextPageRequest(new URLSearchParams("tail=0")), /Invalid tail/);
  assert.throws(() => parseSessionContextPageRequest(new URLSearchParams("limit=20")), /limit requires before/);
});

test("full-context input history stays available when message payloads are paged", () => {
  const full = contextWith(70);
  full.messages[69].content = "m10";
  const history = computeSessionInputHistory(full);
  assert.equal(history.length, 50);
  assert.equal(history.at(-1), "m10");
  assert.equal(new Set(history).size, history.length);
});

test("full-context statistics remain independent from a paged payload", () => {
  const context = {
    messages: [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [{ type: "toolCall", toolCallId: "t1", toolName: "read", input: {} }],
        usage: {
          input: 10,
          output: 5,
          cacheRead: 3,
          cacheWrite: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 },
        },
      },
      { role: "toolResult", toolCallId: "t1", toolName: "read", content: [] },
    ],
    entryIds: ["u", "a", "t"],
    thinkingLevel: "off",
    model: null,
  };
  assert.deepEqual(computeSessionContextStats(context), {
    userMessages: 1,
    assistantMessages: 1,
    toolCalls: 1,
    toolResults: 1,
    totalMessages: 3,
    tokens: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, total: 20 },
    cost: 0.25,
  });
});
