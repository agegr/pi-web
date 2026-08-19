import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

// Point the store at a scratch directory before importing it.
const dir = mkdtempSync(join(tmpdir(), "robin-settings-"));
process.env.ROBIN_DATA_DIR = dir;

const {
  clearGoogleCredentials,
  clearTelegram,
  describeGoogle,
  describeSecret,
  describeTelegram,
  googleCredentials,
  parseChatIds,
  secretsPath,
  setDailyAgenda,
  setGmailDigest,
  setGoogleCredentials,
  setTelegramChatIds,
  setTelegramToken,
  telegramSettings,
} = await import("./settings.ts");
const {
  readAssistantSessionId,
  readDailyAgendaSessionId,
  writeAssistantSessionId,
  writeDailyAgendaSessionId,
} = await import("./store.ts");

after(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  clearGoogleCredentials();
  clearTelegram();
  delete process.env.ROBIN_GOOGLE_CLIENT_ID;
  delete process.env.ROBIN_GOOGLE_CLIENT_SECRET;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_ALLOWED_CHAT_IDS;
});

test("describeSecret never reveals the value", () => {
  const status = describeSecret("8123456789:AAHsuperSecretTail", "file");
  assert.equal(status.set, true);
  assert.equal(status.hint, "Tail");
  assert.equal(status.length, "8123456789:AAHsuperSecretTail".length);
  // The full value must not appear anywhere in the summary.
  assert.ok(!JSON.stringify(status).includes("superSecret"));
});

test("an unset secret describes as absent with no hint", () => {
  assert.deepEqual(describeSecret(undefined, undefined), { set: false });
});

test("stored google credentials round-trip and are reported as file-sourced", () => {
  setGoogleCredentials("  id-123.apps.googleusercontent.com  ", "  secret-abcd  ");
  assert.deepEqual(googleCredentials(), {
    clientId: "id-123.apps.googleusercontent.com",
    clientSecret: "secret-abcd",
  });
  const described = describeGoogle();
  assert.equal(described.clientId.source, "file");
  assert.equal(described.clientSecret.hint, "abcd");
});

test("the environment is a fallback, and the file overrides it", () => {
  process.env.ROBIN_GOOGLE_CLIENT_ID = "env-id";
  process.env.ROBIN_GOOGLE_CLIENT_SECRET = "env-secret";
  assert.equal(googleCredentials().clientId, "env-id");
  assert.equal(describeGoogle().clientId.source, "env");

  // A value typed into the UI has to win, or editing appears to do nothing.
  setGoogleCredentials("file-id", "file-secret");
  assert.equal(googleCredentials().clientId, "file-id");
  assert.equal(describeGoogle().clientId.source, "file");
});

test("clearing google credentials falls back to the environment again", () => {
  process.env.ROBIN_GOOGLE_CLIENT_ID = "env-id";
  process.env.ROBIN_GOOGLE_CLIENT_SECRET = "env-secret";
  setGoogleCredentials("file-id", "file-secret");
  clearGoogleCredentials();
  assert.equal(googleCredentials().clientId, "env-id");
});

test("telegram token and chat ids are stored independently", () => {
  setTelegramToken("8123:AAtoken");
  setTelegramChatIds([42, -1001234567890]);
  const settings = telegramSettings();
  assert.equal(settings.botToken, "8123:AAtoken");
  assert.deepEqual(settings.allowedChatIds, [42, -1001234567890]);

  // Setting the token again must not wipe the chat ids.
  setTelegramToken("9999:BBtoken");
  assert.deepEqual(telegramSettings().allowedChatIds, [42, -1001234567890]);
});

test("chat ids are returned in full because they are not secret", () => {
  setTelegramChatIds([42]);
  assert.deepEqual(describeTelegram().allowedChatIds, [42]);
});

test("daily agenda settings round-trip and validate times", () => {
  const agenda = { enabled: true, time: "07:30", locale: "zh" };
  setDailyAgenda(agenda);
  assert.deepEqual(telegramSettings().dailyAgenda, agenda);
  assert.throws(
    () => setDailyAgenda({ ...agenda, time: "25:00" }),
    /must be HH:MM/,
  );
});

test("gmail digest settings round-trip and keep an empty query from crashing", () => {
  const digest = { enabled: true, time: "09:15", locale: "zh", chatIds: [42], query: "is:unread" };
  setGmailDigest(digest);
  assert.deepEqual(telegramSettings().gmailDigest, digest);
  assert.throws(
    () => setGmailDigest({ ...digest, time: "25:00" }),
    /must be HH:MM/,
  );
  // An edited file with no query must fall back, not reach a `.trim()` on undefined.
  setGmailDigest({ ...digest, query: "" });
  assert.equal(telegramSettings().gmailDigest.query, "newer_than:1d");
});

test("interactive and read-only assistants keep separate sessions", () => {
  writeAssistantSessionId("interactive");
  writeDailyAgendaSessionId("daily-agenda");
  assert.equal(readAssistantSessionId(), "interactive");
  assert.equal(readDailyAgendaSessionId(), "daily-agenda");
});

test("the telegram token is only ever summarised", () => {
  setTelegramToken("8123456789:AAHverySecret1234");
  const described = describeTelegram();
  assert.equal(described.botToken.set, true);
  assert.equal(described.botToken.hint, "1234");
  assert.ok(!JSON.stringify(described).includes("verySecret"));
});

test("an empty stored chat list falls back to the environment", () => {
  process.env.TELEGRAM_ALLOWED_CHAT_IDS = "7,8";
  assert.deepEqual(telegramSettings().allowedChatIds, [7, 8]);
  setTelegramChatIds([9]);
  assert.deepEqual(telegramSettings().allowedChatIds, [9]);
});

test("parseChatIds handles negatives and rejects junk", () => {
  assert.deepEqual(parseChatIds("42, -1001234567890"), [42, -1001234567890]);
  assert.deepEqual(parseChatIds(undefined), []);
  assert.throws(() => parseChatIds("42,abc"), /Not a numeric chat id/);
});

test("the secrets file is not readable by other users", () => {
  setTelegramToken("8123:AAtoken");
  const mode = statSync(secretsPath()).mode & 0o777;
  assert.equal(mode, 0o600, `expected 0600, got ${mode.toString(8)}`);
});
