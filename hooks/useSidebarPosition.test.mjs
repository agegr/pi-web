import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./useSidebarPosition.ts", import.meta.url), "utf8");
const script = new Script(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText);
const KEY = "pi-web:sidebar-position";

// A fresh module per fixture, with the same subscription/server stand-in as useFilesPlacement.
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

test("only a saved right selects the right side; missing or invalid values default left", () => {
  const store = fixture();
  for (const [raw, expected] of [[null, "left"], ["left", "left"], ["right", "right"], ["Right", "left"], ["", "left"], ["tab", "left"]]) {
    assert.equal(store.parseSidebarPosition(raw), expected, String(raw));
  }
  assert.equal(store.SIDEBAR_POSITION_STORAGE_KEY, KEY);
  assert.equal(store.SIDEBAR_POSITION_DEFAULT, "left");
});

test("the server renders left without touching browser APIs", () => {
  const store = fixture({ server: true, initial: { [KEY]: "right" } });
  assert.equal(store.useSidebarPosition(), "left");
});

test("a saved choice is restored, and a new one is saved and announced", () => {
  const store = fixture({ initial: { [KEY]: "right" } });
  assert.equal(store.useSidebarPosition(), "right");
  store.setSidebarPosition("left");
  assert.equal(store.useSidebarPosition(), "left");
  assert.equal(store.stored.get(KEY), "left");
  assert.equal(store.notifications, 1);
  store.setSidebarPosition("left");
  assert.equal(store.notifications, 1, "the same choice again changes nothing");
});

test("another tab's choice for this key, or cleared storage, is followed", () => {
  const store = fixture();
  assert.equal(store.useSidebarPosition(), "left");
  const onStorage = store.events.get("storage");
  store.stored.set(KEY, "right");
  onStorage({ key: "pi-web:sidebar-files-placement" });
  assert.equal(store.useSidebarPosition(), "left");
  assert.equal(store.notifications, 0);
  onStorage({ key: KEY });
  assert.equal(store.useSidebarPosition(), "right");
  assert.equal(store.notifications, 1);
  onStorage({ key: KEY });
  assert.equal(store.notifications, 1, "an unchanged value does not notify");
  store.stored.clear();
  onStorage({ key: null });
  assert.equal(store.useSidebarPosition(), "left");
  assert.equal(store.notifications, 2);
  store.unmount();
  assert.equal(store.events.size, 0, "the last consumer stops listening");
});

test("invalid stored values and removal restore left", () => {
  const store = fixture({ initial: { [KEY]: "right" } });
  assert.equal(store.useSidebarPosition(), "right");
  store.stored.set(KEY, "invalid");
  store.events.get("storage")({ key: KEY });
  assert.equal(store.useSidebarPosition(), "left");
  store.setSidebarPosition("right");
  store.stored.delete(KEY);
  store.events.get("storage")({ key: KEY });
  assert.equal(store.useSidebarPosition(), "left");
});

test("a choice made while nobody listened is read again by the next consumer", () => {
  const store = fixture();
  assert.equal(store.useSidebarPosition(), "left");
  store.unmount();
  store.stored.set(KEY, "right");
  assert.equal(store.useSidebarPosition(), "right");
});

test("blocked storage leaves the default, and a choice still applies for the page", () => {
  const store = fixture({ blocked: true });
  assert.equal(store.useSidebarPosition(), "left");
  store.setSidebarPosition("right");
  assert.equal(store.useSidebarPosition(), "right");
  assert.equal(store.notifications, 1);
});
