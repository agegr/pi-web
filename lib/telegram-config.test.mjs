import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { normalizeAllowedChatIds, toPublicTelegramConfig, validateTelegramConfig } =
  await jiti.import("./telegram-config.ts");
const { splitTelegramMessage } = await jiti.import("./telegram-bridge.ts");

test("normalizes and deduplicates Telegram chat IDs", () => {
  assert.deepEqual(
    normalizeAllowedChatIds("123, -456\n123 invalid 7.5"),
    ["123", "-456"],
  );
});
test("never exposes the Telegram token in public config", () => {
  const publicConfig = toPublicTelegramConfig({
    enabled: true,
    token: "123456:secret-token-value",
    allowedChatIds: ["123"],
    cwd: "C:\\project",
  });

  assert.equal(publicConfig.tokenConfigured, true);
  assert.equal(publicConfig.tokenHint, "••••-value");
  assert.equal("token" in publicConfig, false);
});

test("disabled Telegram bridge can be saved without credentials", () => {
  assert.equal(validateTelegramConfig({
    enabled: false,
    token: "",
    allowedChatIds: [],
    cwd: "",
  }), null);
});

test("splits long Telegram messages without losing content", () => {
  const text = `${"a".repeat(3_900)}\n${"b".repeat(500)}`;
  const parts = splitTelegramMessage(text);

  assert.equal(parts.length, 2);
  assert.ok(parts.every((part) => part.length <= 4_096));
  assert.equal(parts.join("\n"), text);
});
