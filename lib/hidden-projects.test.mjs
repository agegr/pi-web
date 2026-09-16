import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getHiddenProjects, setHiddenProjects } = await jiti.import("./hidden-projects.ts");

const STORAGE_KEY = "pi-web:hidden-projects";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("returns no hidden projects when nothing is stored", () => {
  assert.deepEqual(getHiddenProjects(createStorage()), []);
});

test("set then get round-trips the hidden keys", () => {
  const storage = createStorage();
  setHiddenProjects(["C:\\Users\\Alex\\Temp", "D:\\Scratch"], storage);
  assert.deepEqual(getHiddenProjects(storage), ["C:\\Users\\Alex\\Temp", "D:\\Scratch"]);
});

test("hiding nothing removes the storage key entirely", () => {
  const storage = createStorage();
  setHiddenProjects(["root-a"], storage);
  setHiddenProjects([], storage);
  assert.deepEqual(getHiddenProjects(storage), []);
  assert.equal(storage.values.has(STORAGE_KEY), false);
});

test("ignores a corrupt stored list", () => {
  const storage = createStorage({ [STORAGE_KEY]: "[not-json" });
  assert.deepEqual(getHiddenProjects(storage), []);
});

test("ignores a stored list of the wrong shape", () => {
  assert.deepEqual(getHiddenProjects(createStorage({ [STORAGE_KEY]: `{"root-a":true}` })), []);
  assert.deepEqual(getHiddenProjects(createStorage({ [STORAGE_KEY]: `"root-a"` })), []);
});

test("drops unusable entries without losing the valid ones", () => {
  const storage = createStorage({ [STORAGE_KEY]: `["root-a", "", 42, null, "root-b"]` });
  assert.deepEqual(getHiddenProjects(storage), ["root-a", "root-b"]);
});

test("falls back to no hidden projects when browser storage is unavailable", () => {
  const unavailable = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.deepEqual(getHiddenProjects(unavailable), []);
  assert.doesNotThrow(() => setHiddenProjects(["root-a"], unavailable));
});

test("falls back when browser storage access throws", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const blockedWindow = {};
  Object.defineProperty(blockedWindow, "localStorage", {
    get() { throw new DOMException("blocked", "SecurityError"); },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: blockedWindow,
  });

  try {
    assert.deepEqual(getHiddenProjects(), []);
    assert.doesNotThrow(() => setHiddenProjects(["root-a"]));
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});
