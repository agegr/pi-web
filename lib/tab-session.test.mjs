import assert from "node:assert/strict";
import test from "node:test";
import {
  getTabOpen,
  setTabOpenSession,
  setTabOpenNewSession,
  clearTabOpenSession,
} from "./tab-session.ts";

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

test("returns null when this tab remembers nothing", () => {
  assert.equal(getTabOpen(createStorage()), null);
});

test("set then get round-trips the remembered session", () => {
  const storage = createStorage();
  setTabOpenSession("session-1", storage);
  assert.deepEqual(getTabOpen(storage), { kind: "session", sessionId: "session-1" });
  assert.equal(
    storage.values.get("pi-web:tab-open-session"),
    JSON.stringify({ kind: "session", sessionId: "session-1" }),
  );
});

test("replaces the previous session of the same tab", () => {
  const storage = createStorage();
  setTabOpenSession("session-1", storage);
  setTabOpenSession("session-2", storage);
  assert.deepEqual(getTabOpen(storage), { kind: "session", sessionId: "session-2" });
});

test("remembers a new-session composer for this tab", () => {
  const storage = createStorage();
  setTabOpenSession("session-1", storage);
  setTabOpenNewSession(" /work/project ", storage);
  assert.deepEqual(getTabOpen(storage), { kind: "new", cwd: "/work/project" });
});

test("reads a legacy bare session id", () => {
  const storage = createStorage({ "pi-web:tab-open-session": "legacy-session" });
  assert.deepEqual(getTabOpen(storage), { kind: "session", sessionId: "legacy-session" });
});

test("ignores an empty stored value", () => {
  const storage = createStorage({ "pi-web:tab-open-session": "" });
  assert.equal(getTabOpen(storage), null);
});

test("no-ops for an empty session id", () => {
  const storage = createStorage();
  setTabOpenSession("", storage);
  assert.equal(getTabOpen(storage), null);
});

test("no-ops for an empty new-session cwd", () => {
  const storage = createStorage();
  setTabOpenNewSession("  ", storage);
  assert.equal(getTabOpen(storage), null);
});

test("clears the remembered session only when the id matches", () => {
  const storage = createStorage();
  setTabOpenSession("session-1", storage);
  clearTabOpenSession("session-other", storage);
  assert.deepEqual(getTabOpen(storage), { kind: "session", sessionId: "session-1" });
  clearTabOpenSession("session-1", storage);
  assert.equal(getTabOpen(storage), null);
  assert.equal(storage.values.has("pi-web:tab-open-session"), false);
});

test("does not clear a remembered new-session composer", () => {
  const storage = createStorage();
  setTabOpenNewSession("/work/project", storage);
  clearTabOpenSession("session-1", storage);
  assert.deepEqual(getTabOpen(storage), { kind: "new", cwd: "/work/project" });
});

test("falls back to null / no-ops when browser storage is unavailable", () => {
  const unavailable = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.equal(getTabOpen(unavailable), null);
  assert.doesNotThrow(() => setTabOpenSession("session-1", unavailable));
  assert.doesNotThrow(() => setTabOpenNewSession("/work", unavailable));
  assert.doesNotThrow(() => clearTabOpenSession("session-1", unavailable));
});

test("uses window.sessionStorage by default", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage: createStorage() },
  });

  try {
    setTabOpenSession("session-1");
    assert.deepEqual(getTabOpen(), { kind: "session", sessionId: "session-1" });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});

test("falls back when window.access to sessionStorage throws", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const blockedWindow = {};
  Object.defineProperty(blockedWindow, "sessionStorage", {
    get() { throw new DOMException("blocked", "SecurityError"); },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: blockedWindow,
  });

  try {
    assert.equal(getTabOpen(), null);
    assert.doesNotThrow(() => setTabOpenSession("session-1"));
    assert.doesNotThrow(() => setTabOpenNewSession("/work"));
    assert.doesNotThrow(() => clearTabOpenSession("session-1"));
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});
