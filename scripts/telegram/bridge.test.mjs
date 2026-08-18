import assert from "node:assert/strict";
import { test } from "node:test";
import {
  askAssistant,
  dailyAgendaRunKey,
  handleMessage,
  pendingDailyAgendaChatIds,
  pollOnce,
  readConfig,
  sendDailyAgenda,
} from "./bridge.ts";

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
          arrayBuffer: async () => value.buffer ?? new ArrayBuffer(0),
        };
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetch, calls };
}

const deps = (fetch, logs = [], delivery = { current: null }) => ({
  fetch,
  log: (message) => logs.push(message),
  now: () => 0,
  readDailyAgendaDelivery: () => delivery.current,
  markDailyAgendaSent: (date, chatId) => {
    const chatIds = delivery.current?.date === date ? delivery.current.chatIds : [];
    delivery.current = { date, chatIds: [...chatIds, chatId] };
  },
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

test("a photo is downloaded and forwarded to the assistant as an image", async () => {
  const { fetch, calls } = fakeFetch({
    "getFile": { body: { ok: true, result: { file_path: "photos/file_1.jpg" } } },
    "file/botTOKEN/photos/file_1.jpg": { buffer: new TextEncoder().encode("JPEGDATA").buffer },
    "/api/robin/assistant": { body: { reply: "That is a screenshot.", usedTools: [] } },
    "sendMessage": { body: { ok: true } },
  });
  await handleMessage(config(), deps(fetch), {
    updateId: 1,
    chatId: 42,
    from: "bruce",
    text: "what is this?",
    photos: [{ fileId: "big-id", width: 400, height: 400 }],
  });

  const getFile = calls.find((call) => call.url.includes("getFile"));
  assert.equal(getFile.body.file_id, "big-id", "getFile must ask for the photo's file id");

  const assistant = calls.find((call) => call.url.includes("/api/robin/assistant"));
  assert.equal(assistant.body.message, "what is this?");
  assert.equal(assistant.body.images.length, 1);
  assert.equal(assistant.body.images[0].type, "image");
  assert.equal(assistant.body.images[0].mimeType, "image/jpeg");
  assert.equal(assistant.body.images[0].data, Buffer.from("JPEGDATA").toString("base64"));
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

test("daily agenda becomes due on the machine-local date after its configured time", () => {
  const schedule = { enabled: true, time: "08:00", locale: "zh" };
  assert.equal(dailyAgendaRunKey(schedule, new Date(2026, 7, 17, 7, 59).getTime()), null);
  assert.equal(dailyAgendaRunKey(schedule, new Date(2026, 7, 17, 8, 0).getTime()), "2026-08-17");
  assert.equal(dailyAgendaRunKey({ ...schedule, enabled: false }, new Date(2026, 7, 17, 8, 0).getTime()), null);
});

test("already delivered chats stay skipped after a restart or partial broadcast", () => {
  assert.deepEqual(
    pendingDailyAgendaChatIds([42, 43], "2026-08-17", { date: "2026-08-17", chatIds: [42] }),
    [43],
  );
  assert.deepEqual(
    pendingDailyAgendaChatIds([42, 43], "2026-08-18", { date: "2026-08-17", chatIds: [42, 43] }),
    [42, 43],
  );
});

test("daily agenda asks for both sources and broadcasts to allowed chats", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/assistant": { body: { reply: "今日简报", usedTools: ["todo_list", "calendar_list_events"] } },
    "sendMessage": { body: { ok: true } },
  });
  const dailyConfig = config({
    allowlist: [42, 43],
    dailyAgenda: { enabled: true, time: "08:00", locale: "zh" },
  });
  const delivery = { current: null };
  await sendDailyAgenda(dailyConfig, deps(fetch, [], delivery), "2026-08-17");

  assert.match(calls[0].body.message, /todo_list/);
  assert.match(calls[0].body.message, /calendar_list_events/);
  assert.equal(calls[0].body.readOnly, true);
  assert.deepEqual(
    calls.filter((call) => call.url.includes("sendMessage")).map((call) => call.body.chat_id),
    [42, 43],
  );
  assert.deepEqual(delivery.current, { date: "2026-08-17", chatIds: [42, 43] });
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
