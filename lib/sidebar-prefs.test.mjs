import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  forgetRetiredSidebarKeys,
  loadGroupExpansion,
  loadPinnedCollapsed,
  loadShowIgnoredFiles,
  loadSidebarTab,
  saveGroupExpansion,
  savePinnedCollapsed,
  saveShowIgnoredFiles,
  saveSidebarTab,
} = await jiti.import("./sidebar-prefs.ts");

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

const unavailable = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); },
};

test("defaults to the sessions tab, open pins, no explicit group choices and ignored files hidden", () => {
  const storage = createStorage();
  assert.equal(loadSidebarTab(storage), "sessions");
  assert.equal(loadPinnedCollapsed(storage), false);
  assert.deepEqual(loadGroupExpansion(storage), {});
  assert.equal(loadShowIgnoredFiles(storage), false);
});

test("saves and restores the sidebar tab", () => {
  const storage = createStorage();
  saveSidebarTab("files", storage);
  assert.equal(storage.values.get("pi-web:sidebar-tab"), "files");
  assert.equal(loadSidebarTab(storage), "files");
  saveSidebarTab("sessions", storage);
  assert.equal(loadSidebarTab(storage), "sessions");
  assert.equal(loadSidebarTab(createStorage({ "pi-web:sidebar-tab": "bogus" })), "sessions");
});

test("saves and restores the pinned section state", () => {
  const storage = createStorage();
  savePinnedCollapsed(true, storage);
  assert.equal(storage.values.get("pi-web:sidebar-pins-collapsed"), "true");
  assert.equal(loadPinnedCollapsed(storage), true);
  savePinnedCollapsed(false, storage);
  assert.equal(loadPinnedCollapsed(storage), false);
});

test("saves and restores the ignored-files switch", () => {
  const storage = createStorage();
  saveShowIgnoredFiles(true, storage);
  assert.equal(storage.values.get("pi-web:sidebar-files-show-ignored"), "true");
  assert.equal(loadShowIgnoredFiles(storage), true);
  saveShowIgnoredFiles(false, storage);
  assert.equal(loadShowIgnoredFiles(storage), false);
});

test("group choices round-trip and drop malformed entries", () => {
  const storage = createStorage();
  saveGroupExpansion({ "/work/a": true, "C:\\work\\b": false }, storage);
  assert.deepEqual(loadGroupExpansion(storage), { "/work/a": true, "C:\\work\\b": false });

  const odd = createStorage({ "pi-web:sidebar-groups": '{"/a":true,"/b":"yes","/c":1,"__proto__":true}' });
  const loaded = loadGroupExpansion(odd);
  assert.deepEqual(loaded, { "/a": true });
  assert.equal(Object.getPrototypeOf(loaded), Object.prototype);

  for (const raw of ["not json", "[true]", "null", "7"]) {
    assert.deepEqual(loadGroupExpansion(createStorage({ "pi-web:sidebar-groups": raw })), {}, raw);
  }
});

test("group choices keep the 300 most recently inserted keys", () => {
  const storage = createStorage();
  const value = {};
  for (let index = 0; index < 305; index++) value[`/p/${index}`] = index % 2 === 0;
  saveGroupExpansion(value, storage);

  const loaded = loadGroupExpansion(storage);
  const keys = Object.keys(loaded);
  assert.equal(keys.length, 300);
  assert.equal(keys[0], "/p/5");
  assert.equal(keys.at(-1), "/p/304");
  assert.equal(loaded["/p/304"], true);
});

test("the keys of the old sessions/explorer split are dropped, and nothing else", () => {
  const storage = createStorage({
    "pi-web:file-explorer:open": "false",
    "pi-web:sidebar-session-pane-height": "320",
    "pi-web:sidebar-tab": "files",
  });
  forgetRetiredSidebarKeys(storage);
  assert.deepEqual([...storage.values.keys()], ["pi-web:sidebar-tab"]);
  // A storage without removeItem, or one that refuses, is left as it is.
  assert.doesNotThrow(() => forgetRetiredSidebarKeys({ getItem: () => null, setItem() {} }));
  assert.doesNotThrow(() => forgetRetiredSidebarKeys(unavailable));
  assert.doesNotThrow(() => forgetRetiredSidebarKeys(null));
});

test("falls back to defaults when browser storage is unavailable", () => {
  assert.equal(loadSidebarTab(unavailable), "sessions");
  assert.equal(loadPinnedCollapsed(unavailable), false);
  assert.deepEqual(loadGroupExpansion(unavailable), {});
  assert.equal(loadShowIgnoredFiles(unavailable), false);
  assert.doesNotThrow(() => saveSidebarTab("files", unavailable));
  assert.doesNotThrow(() => saveShowIgnoredFiles(true, unavailable));
  assert.doesNotThrow(() => savePinnedCollapsed(true, unavailable));
  assert.doesNotThrow(() => saveGroupExpansion({ "/a": true }, unavailable));
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
    assert.equal(loadSidebarTab(), "sessions");
    assert.equal(loadPinnedCollapsed(), false);
    assert.deepEqual(loadGroupExpansion(), {});
    assert.equal(loadShowIgnoredFiles(), false);
    assert.doesNotThrow(() => saveSidebarTab("files"));
    assert.doesNotThrow(() => saveShowIgnoredFiles(true));
    assert.doesNotThrow(() => savePinnedCollapsed(true));
    assert.doesNotThrow(() => saveGroupExpansion({ "/a": false }));
    assert.doesNotThrow(() => forgetRetiredSidebarKeys());
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});
