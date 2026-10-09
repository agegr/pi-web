import assert from "node:assert/strict";
import test from "node:test";

import {
  loadMinimapPreviewLocked,
  saveMinimapPreviewLocked,
} from "./minimap-preview-lock.ts";

function memoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

test("the minimap preview starts unlocked", () => {
  assert.equal(loadMinimapPreviewLocked(memoryStorage()), false);
  assert.equal(loadMinimapPreviewLocked(null), false);
});

test("the lock choice survives a remount", () => {
  const storage = memoryStorage();
  saveMinimapPreviewLocked(true, storage);
  assert.equal(loadMinimapPreviewLocked(storage), true);
  saveMinimapPreviewLocked(false, storage);
  assert.equal(loadMinimapPreviewLocked(storage), false);
});

test("storage errors fall back to unlocked and never throw", () => {
  const broken = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("quota"); },
  };
  assert.equal(loadMinimapPreviewLocked(broken), false);
  assert.doesNotThrow(() => saveMinimapPreviewLocked(true, broken));
});
