import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  isThinkingExpandedByDefault,
  setThinkingExpandedByDefault,
  THINKING_EXPANDED_EVENT,
} = await jiti.import("./thinking-expansion-preference.ts");
const store = await jiti.import("./pi-web-settings-store.ts");

function installWindow() {
  const events = new Set();
  const listeners = new Set();
  globalThis.window = {
    dispatchEvent: (event) => {
      events.add(event.type);
      for (const handler of listeners) handler(event);
      return true;
    },
    addEventListener: (type, handler) => {
      if (type === THINKING_EXPANDED_EVENT) listeners.add(handler);
    },
    removeEventListener: (_type, handler) => listeners.delete(handler),
  };
  return { events, listeners };
}

test.beforeEach(() => store.resetPiWebSettingsForTests());

test("collapsed until the server says otherwise", () => {
  installWindow();
  assert.equal(isThinkingExpandedByDefault(), false);
});

test("the store's value is the preference, and a change announces itself", async () => {
  const { events } = installWindow();
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    settings: { thinkingExpandedDefault: true, quoteSelection: false, enterSendMode: "enter" },
  }), { status: 200 });
  try {
    await store.ensurePiWebSettingsLoaded();
    assert.equal(isThinkingExpandedByDefault(), true);

    const written = setThinkingExpandedByDefault(false);
    // Optimistic: the switch and every open block follow before the write returns.
    assert.equal(isThinkingExpandedByDefault(), false);
    assert.ok(events.has(THINKING_EXPANDED_EVENT));
    // Awaited so the write lands inside this test; left pending, its response
    // would read as the store's value after the next test's reset.
    await written;
  } finally {
    globalThis.fetch = previous;
  }
});

test("no browser storage is touched any more", () => {
  const { events } = installWindow();
  let reads = 0;
  Object.defineProperty(globalThis.window, "localStorage", {
    get() { reads++; throw new Error("localStorage must not be read"); },
  });
  assert.equal(isThinkingExpandedByDefault(), false);
  assert.doesNotThrow(() => setThinkingExpandedByDefault(true));
  assert.equal(reads, 0);
  void events;
});
