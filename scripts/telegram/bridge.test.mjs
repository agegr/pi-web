import assert from "node:assert/strict";
import { test } from "node:test";
import { askAssistant, handleMessage, pollOnce, readConfig } from "./bridge.ts";

const config = (over = {}) => ({
  token: "TOKEN",
  allowlist: [42],
  piWebUrl: "http://127.0.0.1:30141",
  ...over,
});

/** Records every call and replies from a scripted queue keyed by URL fragment. */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined, init });
    for (const [fragment, responder] of Object.entries(routes)) {
      if (String(url).includes(fragment)) {
        const value = typeof responder === "function" ? responder(calls.length) : responder;
        return {
          ok: value.ok ?? true,
          status: value.status ?? 200,
          json: async () => value.body,
        };
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetch, calls };
}

const deps = (fetch, logs = []) => ({
  fetch,
  log: (message) => logs.push(message),
  now: () => 0,
});

test("an unlisted chat reaches neither the agent nor Telegram", async () => {
  const { fetch, calls } = fakeFetch({});
  const logs = [];
  await handleMessage(config(), deps(fetch, logs), {
    updateId: 1, chatId: 999, from: "stranger", text: "delete all my todos",
  });

  assert.deepEqual(calls, [], "no agent call, and no reply that would confirm the bot exists");
  assert.match(logs.join("\n"), /refused/);
});

test("discovery mode reports the chat id and still refuses to act", async () => {
  const { fetch, calls } = fakeFetch({});
  const logs = [];
  await handleMessage(config({ allowlist: [] }), deps(fetch, logs), {
    updateId: 1, chatId: 12345, from: "bruce", text: "hi",
  });

  assert.deepEqual(calls, []);
  const output = logs.join("\n");
  assert.match(output, /discovery/);
  assert.match(output, /12345/, "the id must be shown so it can be added");
  assert.match(output, /TELEGRAM_ALLOWED_CHAT_IDS=12345/);
});

test("an allowed chat is forwarded and answered", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/assistant": { body: { reply: "Added todo: buy milk.", usedTools: ["todo_add"] } },
    "sendMessage": { body: { ok: true } },
  });
  await handleMessage(config(), deps(fetch), {
    updateId: 1, chatId: 42, from: "bruce", text: "remember to buy milk",
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/api\/robin\/assistant$/);
  assert.equal(calls[0].body.message, "remember to buy milk");
  assert.match(calls[1].url, /sendMessage$/);
  assert.equal(calls[1].body.chat_id, 42);
  assert.equal(calls[1].body.text, "Added todo: buy milk.\n\n— added a todo");
});

test("an agent failure is reported back to the authorized sender", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/assistant": { ok: false, status: 500, body: { error: "The assistant took too long to respond." } },
    "sendMessage": { body: { ok: true } },
  });
  const logs = [];
  await handleMessage(config(), deps(fetch, logs), {
    updateId: 1, chatId: 42, from: "bruce", text: "x",
  });

  const sent = calls.find((call) => call.url.includes("sendMessage"));
  assert.match(sent.body.text, /Something went wrong: The assistant took too long/);
  assert.match(logs.join("\n"), /\[error\]/);
});

test("a long reply is sent as several messages", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/assistant": { body: { reply: "x".repeat(9000), usedTools: [] } },
    "sendMessage": { body: { ok: true } },
  });
  await handleMessage(config(), deps(fetch), { updateId: 1, chatId: 42, from: "b", text: "x" });

  const sends = calls.filter((call) => call.url.includes("sendMessage"));
  assert.equal(sends.length, 3);
  for (const send of sends) assert.ok(send.body.text.length <= 4096);
});

test("pollOnce advances the offset past everything it saw", async () => {
  const { fetch, calls } = fakeFetch({
    "getUpdates": {
      body: {
        ok: true,
        result: [
          { update_id: 100, message: { chat: { id: 42 }, from: {}, text: "hi" } },
          { update_id: 101, message: { chat: { id: 42 }, sticker: {} } },
        ],
      },
    },
    "/api/robin/assistant": { body: { reply: "hello", usedTools: [] } },
    "sendMessage": { body: { ok: true } },
  });

  const next = await pollOnce(config(), deps(fetch), null);
  assert.equal(next, 102);
  assert.equal(calls[0].body.offset, undefined, "the first poll has no offset");
  assert.deepEqual(calls[0].body.allowed_updates, ["message"]);
});

test("pollOnce keeps the previous offset when nothing arrives", async () => {
  const { fetch } = fakeFetch({ "getUpdates": { body: { ok: true, result: [] } } });
  assert.equal(await pollOnce(config(), deps(fetch), 500), 500);
});

test("the pi-web password is sent as basic auth when configured", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/assistant": { body: { reply: "ok", usedTools: [] } },
  });
  await askAssistant(config({ password: "s3cret" }), deps(fetch), "hi");
  const header = calls[0].init.headers.Authorization;
  assert.equal(Buffer.from(header.replace("Basic ", ""), "base64").toString(), "pi:s3cret");
});

const noStored = { allowedChatIds: [] };

test("readConfig demands a token and defaults the rest", () => {
  assert.throws(() => readConfig({}, noStored), /No Telegram bot token/);

  const parsed = readConfig({ TELEGRAM_BOT_TOKEN: "T", TELEGRAM_ALLOWED_CHAT_IDS: "1,2" }, noStored);
  assert.equal(parsed.piWebUrl, "http://127.0.0.1:30141");
  assert.deepEqual(parsed.allowlist, [1, 2]);
  assert.equal(parsed.password, undefined);

  const custom = readConfig({ TELEGRAM_BOT_TOKEN: "T", PI_WEB_URL: "http://box:8080/" }, noStored);
  assert.equal(custom.piWebUrl, "http://box:8080", "a trailing slash would double up in request paths");
});

test("settings saved in the dashboard override the environment", () => {
  // Otherwise editing on the settings page would appear to do nothing.
  const config = readConfig(
    { TELEGRAM_BOT_TOKEN: "env-token", TELEGRAM_ALLOWED_CHAT_IDS: "1" },
    { botToken: "stored-token", allowedChatIds: [42] },
  );
  assert.equal(config.token, "stored-token");
  assert.deepEqual(config.allowlist, [42]);
});

test("the environment still works when nothing is stored", () => {
  const config = readConfig(
    { TELEGRAM_BOT_TOKEN: "env-token", TELEGRAM_ALLOWED_CHAT_IDS: "7" },
    { allowedChatIds: [] },
  );
  assert.equal(config.token, "env-token");
  assert.deepEqual(config.allowlist, [7]);
});
