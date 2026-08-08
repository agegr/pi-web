import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getLastOpenSession,
  setLastOpenSession,
  clearLastOpen,
  workspaceKeyOf,
} = await jiti.import("./workspace-memory.ts");

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

test("returns null for an unknown workspace", () => {
  assert.equal(getLastOpenSession("root-a", createStorage()), null);
});

test("set then get round-trips the remembered session", () => {
  const storage = createStorage();
  setLastOpenSession("root-a", "session-1", storage);
  assert.equal(getLastOpenSession("root-a", storage), "session-1");
});

test("workspaces are remembered independently", () => {
  const storage = createStorage();
  setLastOpenSession("root-a", "session-a", storage);
  setLastOpenSession("root-b", "session-b", storage);
  assert.equal(getLastOpenSession("root-a", storage), "session-a");
  assert.equal(getLastOpenSession("root-b", storage), "session-b");
});

test("clearLastOpen removes only the named workspace", () => {
  const storage = createStorage();
  setLastOpenSession("root-a", "session-a", storage);
  setLastOpenSession("root-b", "session-b", storage);
  clearLastOpen("root-a", storage);
  assert.equal(getLastOpenSession("root-a", storage), null);
  assert.equal(getLastOpenSession("root-b", storage), "session-b");
});

test("clearing the last entry removes the storage key entirely", () => {
  const storage = createStorage();
  setLastOpenSession("root-a", "session-a", storage);
  clearLastOpen("root-a", storage);
  assert.equal(getLastOpenSession("root-a", storage), null);
  assert.equal(storage.values.has("pi-web:last-open-by-workspace"), false);
});

test("ignores a corrupt stored map", () => {
  const storage = createStorage({ "pi-web:last-open-by-workspace": "{not-json" });
  assert.equal(getLastOpenSession("root-a", storage), null);
});

test("ignores a stored map of the wrong shape", () => {
  const storage = createStorage({ "pi-web:last-open-by-workspace": `"just a string"` });
  assert.equal(getLastOpenSession("root-a", storage), null);
});

test("recovers from an array-shaped stored map", () => {
  const storage = createStorage({ "pi-web:last-open-by-workspace": "[]" });
  setLastOpenSession("root-a", "session-a", storage);
  assert.equal(getLastOpenSession("root-a", storage), "session-a");
});

test("ignores an empty or non-string session id", () => {
  const storage = createStorage({
    "pi-web:last-open-by-workspace": `{"root-a": "", "root-b": 42, "root-c": "ok"}`,
  });
  assert.equal(getLastOpenSession("root-a", storage), null);
  assert.equal(getLastOpenSession("root-b", storage), null);
  assert.equal(getLastOpenSession("root-c", storage), "ok");
});

test("falls back to null / no-ops when browser storage is unavailable", () => {
  const unavailable = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.equal(getLastOpenSession("root-a", unavailable), null);
  assert.doesNotThrow(() => setLastOpenSession("root-a", "session-a", unavailable));
  assert.doesNotThrow(() => clearLastOpen("root-a", unavailable));
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
    assert.equal(getLastOpenSession("root-a"), null);
    assert.doesNotThrow(() => setLastOpenSession("root-a", "session-a"));
    assert.doesNotThrow(() => clearLastOpen("root-a"));
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});

test("workspaceKeyOf prefers projectRoot over cwd", () => {
  assert.equal(workspaceKeyOf({ cwd: "/repos/a/worktrees/b", projectRoot: "/repos/a" }), "/repos/a");
  assert.equal(workspaceKeyOf({ cwd: "/plain/dir", projectRoot: null }), "/plain/dir");
  assert.equal(workspaceKeyOf({ cwd: "/plain/dir" }), "/plain/dir");
});
