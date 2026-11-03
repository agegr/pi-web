import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./useShowProviderNames.ts", import.meta.url), "utf8");
const script = new Script(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText);
const KEY = "pi-web:show-provider-names";

// A fresh module per fixture: the store caches the choice at module level. The
// stand-in useSyncExternalStore subscribes once, as a mounted component does,
// and renders the server snapshot where there is no window.
function fixture({ initial = {}, blocked = false, server = false } = {}) {
  const stored = new Map(Object.entries(initial));
  const events = new Map();
  let unsubscribe = null;
  let notifications = 0;
  const storage = {
    getItem(key) { if (blocked) throw new Error("blocked"); return stored.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error("blocked"); stored.set(key, value); },
  };
  const exports = {};
  script.runInNewContext({
    exports,
    require(id) {
      if (id !== "react") throw new Error(`Unexpected import ${id}`);
      return {
        useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
          if (server) return getServerSnapshot();
          unsubscribe ??= subscribe(() => notifications++);
          return getSnapshot();
        },
      };
    },
    ...(!server && {
      window: {
        localStorage: storage,
        addEventListener(type, listener) { assert.equal(events.has(type), false); events.set(type, listener); },
        removeEventListener(type, listener) { assert.equal(events.get(type), listener); events.delete(type); },
      },
    }),
  });
  return {
    ...exports,
    stored,
    events,
    get notifications() { return notifications; },
    unmount() { unsubscribe?.(); unsubscribe = null; },
  };
}

test("only a saved \"true\" turns provider names on", () => {
  const store = fixture();
  for (const [raw, expected] of [[null, false], ["false", false], ["true", true], ["1", false], ["TRUE", false], ["", false]]) {
    assert.equal(store.parseShowProviderNames(raw), expected, String(raw));
  }
  assert.equal(store.SHOW_PROVIDER_NAMES_STORAGE_KEY, KEY);
  assert.equal(store.SHOW_PROVIDER_NAMES_DEFAULT, false);
});

test("the server renders off without touching browser APIs", () => {
  const store = fixture({ server: true, initial: { [KEY]: "true" } });
  assert.equal(store.useShowProviderNames(), false);
});

test("a saved choice is restored, and a new one is saved and announced", () => {
  const store = fixture({ initial: { [KEY]: "true" } });
  assert.equal(store.useShowProviderNames(), true);
  store.setShowProviderNames(false);
  assert.equal(store.useShowProviderNames(), false);
  assert.equal(store.stored.get(KEY), "false");
  assert.equal(store.notifications, 1);
  store.setShowProviderNames(false);
  assert.equal(store.notifications, 1, "the same choice again changes nothing");
});

test("another tab's choice for this key, or a cleared storage, is followed", () => {
  const store = fixture();
  assert.equal(store.useShowProviderNames(), false);
  const onStorage = store.events.get("storage");
  store.stored.set(KEY, "true");
  onStorage({ key: "pi-web:sidebar-tab" });
  assert.equal(store.useShowProviderNames(), false, "another key is not this choice");
  assert.equal(store.notifications, 0);
  onStorage({ key: KEY });
  assert.equal(store.useShowProviderNames(), true);
  assert.equal(store.notifications, 1);
  store.stored.clear();
  onStorage({ key: null });
  assert.equal(store.useShowProviderNames(), false);
  assert.equal(store.notifications, 2);
  store.unmount();
  assert.equal(store.events.size, 0, "the last consumer stops listening");
});

test("a choice made while nobody listened is read again by the next consumer", () => {
  const store = fixture();
  assert.equal(store.useShowProviderNames(), false);
  store.unmount();
  store.stored.set(KEY, "true");
  assert.equal(store.useShowProviderNames(), true);
});

test("blocked storage leaves the default, and a choice still applies for the page", () => {
  const store = fixture({ blocked: true });
  assert.equal(store.useShowProviderNames(), false);
  store.setShowProviderNames(true);
  assert.equal(store.useShowProviderNames(), true);
  assert.equal(store.notifications, 1);
});
