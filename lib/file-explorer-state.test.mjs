import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { loadExplorerOpen, saveExplorerOpen } = await jiti.import("./file-explorer-state.ts");

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
  };
}

test("defaults to an open file explorer", () => {
  assert.equal(loadExplorerOpen(createStorage()), true);
});

test("saves and restores the file explorer panel state", () => {
  const storage = createStorage();

  saveExplorerOpen(false, storage);
  assert.equal(loadExplorerOpen(storage), false);

  saveExplorerOpen(true, storage);
  assert.equal(loadExplorerOpen(storage), true);
});

test("falls back to open when browser storage is unavailable", () => {
  const unavailable = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };

  assert.equal(loadExplorerOpen(unavailable), true);
  assert.doesNotThrow(() => saveExplorerOpen(false, unavailable));
});

test("falls back when accessing browser storage throws", () => {
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
    assert.equal(loadExplorerOpen(), true);
    assert.doesNotThrow(() => saveExplorerOpen(false));
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});
