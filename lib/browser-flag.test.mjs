import assert from "node:assert/strict";
import test from "node:test";

import { loadBrowserFlag, saveBrowserFlag } from "./browser-flag.ts";

function memoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

test("a flag is off until saved on", () => {
  assert.equal(loadBrowserFlag("k", memoryStorage()), false);
  assert.equal(loadBrowserFlag("k", null), false);
});

test("a flag keeps its own key", () => {
  const storage = memoryStorage();
  saveBrowserFlag("a", true, storage);
  assert.equal(loadBrowserFlag("a", storage), true);
  assert.equal(loadBrowserFlag("b", storage), false);
  saveBrowserFlag("a", false, storage);
  assert.equal(loadBrowserFlag("a", storage), false);
});

test("storage errors fall back to off and never throw", () => {
  const broken = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("quota"); },
  };
  assert.equal(loadBrowserFlag("k", broken), false);
  assert.doesNotThrow(() => saveBrowserFlag("k", true, broken));
});
