import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  loadCollapsedSessionIds,
  saveCollapsedSessionIds,
  setSessionTreeCollapsed,
} = await jiti.import("./session-tree-collapse.ts");

function memoryStorage(initial = new Map()) {
  return {
    values: initial,
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, value); },
  };
}

test("collapsed session ids round-trip through local storage", () => {
  const storage = memoryStorage();
  let ids = setSessionTreeCollapsed(new Set(), "parent", true);
  ids = setSessionTreeCollapsed(ids, "nested", true);
  saveCollapsedSessionIds(ids, storage);
  assert.deepEqual([...loadCollapsedSessionIds(storage)], ["parent", "nested"]);

  ids = setSessionTreeCollapsed(ids, "parent", false);
  saveCollapsedSessionIds(ids, storage);
  assert.deepEqual([...loadCollapsedSessionIds(storage)], ["nested"]);
});

test("invalid storage is ignored and persisted ids stay bounded", () => {
  const storage = memoryStorage(new Map([["pi-session-tree-collapsed-v1", "not-json"]]));
  assert.deepEqual([...loadCollapsedSessionIds(storage)], []);

  let ids = new Set();
  for (let index = 0; index < 520; index += 1) {
    ids = setSessionTreeCollapsed(ids, `session-${index}`, true);
  }
  assert.equal(ids.size, 512);
  assert.equal(ids.has("session-0"), false);
  assert.equal(ids.has("session-519"), true);
});

test("storage failures do not break in-memory collapse state", () => {
  const storage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("full"); },
  };
  assert.deepEqual([...loadCollapsedSessionIds(storage)], []);
  assert.doesNotThrow(() => saveCollapsedSessionIds(new Set(["session"]), storage));
});
