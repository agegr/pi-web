import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const store = await jiti.import("./pi-web-settings-store.ts");
const { DEFAULT_PI_WEB_SETTINGS, PI_WEB_SETTINGS_VERSION } = await jiti.import("./pi-web-settings-shared.ts");

/** A scripted fetch: each call answers the next entry (a body, or a status to fail with). */
function installFetch(t, responses) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ?? null, cache: init?.cache });
    const next = responses.shift();
    if (next === undefined) throw new Error("no scripted response left");
    if (typeof next === "number") return new Response("{}", { status: next });
    return new Response(JSON.stringify(next), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = previous; });
  return calls;
}

function installWindow(t) {
  const events = [];
  const previous = globalThis.window;
  globalThis.window = { dispatchEvent: (event) => { events.push(event.type); return true; } };
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
  return events;
}

test.beforeEach(() => store.resetPiWebSettingsForTests());

test("the page starts on the server's defaults", () => {
  assert.deepEqual(store.getPiWebSettingsSnapshot(), { ...DEFAULT_PI_WEB_SETTINGS });
});

test("the first load reads every setting and tells the subscribers", async (t) => {
  const calls = installFetch(t, [{ settings: { thinkingExpandedDefault: true, quoteSelection: true, enterSendMode: "ctrlEnter" } }]);
  let notified = 0;
  const unsubscribe = store.subscribePiWebSettings(() => notified++);

  await store.ensurePiWebSettingsLoaded();

  assert.deepEqual(store.getPiWebSettingsSnapshot(), { thinkingExpandedDefault: true, quoteSelection: true, enterSendMode: "ctrlEnter" });
  assert.equal(notified, 1);
  assert.deepEqual(calls[0], { url: "/api/pi-web-settings", method: "GET", body: null, cache: "no-store" });
  // Once per page: a second caller shares the same read.
  await store.ensurePiWebSettingsLoaded();
  assert.equal(calls.length, 1);
  unsubscribe();
});

test("a failed read keeps the defaults and remembers why", async (t) => {
  installFetch(t, [500]);
  await store.ensurePiWebSettingsLoaded();
  assert.deepEqual(store.getPiWebSettingsSnapshot(), { ...DEFAULT_PI_WEB_SETTINGS });
  assert.equal(store.getPiWebSettingsError(), "HTTP 500");
});

test("a write shows the new value at once, sends one key, and adopts the server's answer", async (t) => {
  const calls = installFetch(t, [
    { settings: { ...DEFAULT_PI_WEB_SETTINGS } },
    { settings: { ...DEFAULT_PI_WEB_SETTINGS, enterSendMode: "ctrlEnter" } },
  ]);
  await store.ensurePiWebSettingsLoaded();

  const pending = store.setPiWebSetting("enterSendMode", "ctrlEnter");
  // Optimistic: the composer reads the new mode before the write returns.
  assert.equal(store.getPiWebSettingsSnapshot().enterSendMode, "ctrlEnter");
  assert.equal(await pending, true);

  assert.equal(calls[1].method, "PUT");
  assert.deepEqual(JSON.parse(calls[1].body), { enterSendMode: "ctrlEnter" });
  assert.equal(store.getPiWebSettingsSnapshot().enterSendMode, "ctrlEnter");
  assert.equal(store.getPiWebSettingsError(), null);
});

test("a refused write puts the previous value back and reports it", async (t) => {
  installFetch(t, [{ settings: { ...DEFAULT_PI_WEB_SETTINGS } }, 409]);
  await store.ensurePiWebSettingsLoaded();

  assert.equal(await store.setPiWebSetting("quoteSelection", true), false);
  assert.equal(store.getPiWebSettingsSnapshot().quoteSelection, false);
  assert.equal(store.getPiWebSettingsError(), "HTTP 409");
});

test("the thinking default announces itself to the blocks on screen, and only when it changes", async (t) => {
  const events = installWindow(t);
  installFetch(t, [
    { settings: { ...DEFAULT_PI_WEB_SETTINGS } },
    { settings: { ...DEFAULT_PI_WEB_SETTINGS, thinkingExpandedDefault: true } },
    { settings: { ...DEFAULT_PI_WEB_SETTINGS, thinkingExpandedDefault: true, quoteSelection: true } },
  ]);
  await store.ensurePiWebSettingsLoaded();
  assert.deepEqual(events, [], "nothing changed on the first read");

  await store.setPiWebSetting("thinkingExpandedDefault", true);
  assert.deepEqual(events, ["pi-thinking-expanded-changed"]);

  // Another setting does not touch the blocks.
  await store.setPiWebSetting("quoteSelection", true);
  assert.deepEqual(events, ["pi-thinking-expanded-changed"]);
});

test("a refresh reads again, as returning to the page does", async (t) => {
  const calls = installFetch(t, [
    { settings: { ...DEFAULT_PI_WEB_SETTINGS } },
    { settings: { ...DEFAULT_PI_WEB_SETTINGS, thinkingExpandedDefault: true } },
  ]);
  await store.ensurePiWebSettingsLoaded();
  await store.refreshPiWebSettings();
  assert.equal(calls.length, 2);
  assert.equal(store.getPiWebSettingsSnapshot().thinkingExpandedDefault, true);
});

test("a response without the known shape is a failure, not a silent default", async (t) => {
  installFetch(t, [{ settings: { version: PI_WEB_SETTINGS_VERSION, enterSendMode: "enter" } }, { settings: "nope" }]);
  await store.ensurePiWebSettingsLoaded();
  assert.equal(await store.setPiWebSetting("quoteSelection", true), false);
  assert.equal(store.getPiWebSettingsError(), "Malformed settings");
  assert.equal(store.getPiWebSettingsSnapshot().quoteSelection, false);
});
