import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  LONG_USER_MESSAGE_CHAR_LIMIT,
  LONG_USER_MESSAGE_LINE_LIMIT,
  getLongUserMessageStats,
} = await jiti.import("./long-user-message.ts");

test("字符数超过阈值时折叠长消息", () => {
  assert.equal(getLongUserMessageStats("x".repeat(LONG_USER_MESSAGE_CHAR_LIMIT)).compact, false);
  assert.equal(getLongUserMessageStats("x".repeat(LONG_USER_MESSAGE_CHAR_LIMIT + 1)).compact, true);
});

test("行数超过阈值时折叠长消息", () => {
  const atLimit = Array.from({ length: LONG_USER_MESSAGE_LINE_LIMIT }, () => "x").join("\n");
  assert.deepEqual(getLongUserMessageStats(atLimit), {
    characters: atLimit.length,
    lines: LONG_USER_MESSAGE_LINE_LIMIT,
    compact: false,
  });
  assert.equal(getLongUserMessageStats(`${atLimit}\nx`).compact, true);
});
