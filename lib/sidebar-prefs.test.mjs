import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  forgetRetiredSidebarKeys,
  loadFilesCollapsed,
  loadGroupExpansion,
  loadNonGitCwds,
  loadPinnedCollapsed,
  loadShowIgnoredFiles,
  loadSidebarTab,
  rememberCwdGitStatus,
  saveFilesCollapsed,
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

test("defaults to the sessions tab, open pins, no explicit group choices, an open files section and ignored files hidden", () => {
  const storage = createStorage();
  assert.equal(loadSidebarTab(storage), "sessions");
  assert.equal(loadPinnedCollapsed(storage), false);
  assert.deepEqual(loadGroupExpansion(storage), {});
  assert.equal(loadFilesCollapsed(storage), false);
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

test("saves and restores the files section's collapse, apart from the tab", () => {
  const storage = createStorage({ "pi-web:sidebar-tab": "files" });
  saveFilesCollapsed(true, storage);
  assert.equal(storage.values.get("pi-web:sidebar-files-collapsed"), "true");
  assert.equal(loadFilesCollapsed(storage), true);
  saveFilesCollapsed(false, storage);
  assert.equal(loadFilesCollapsed(storage), false);
  assert.equal(loadFilesCollapsed(createStorage({ "pi-web:sidebar-files-collapsed": "yes" })), false);
  // The tabs keep their own choice: folding the section never picks a tab.
  assert.equal(loadSidebarTab(storage), "files");
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
  assert.deepEqual([...storage.values.keys()], ["pi-web:sidebar-groups-v2"]);
  assert.deepEqual(loadGroupExpansion(storage), { "/work/a": true, "C:\\work\\b": false });

  const odd = createStorage({ "pi-web:sidebar-groups-v2": '{"/a":true,"/b":"yes","/c":1,"__proto__":true}' });
  const loaded = loadGroupExpansion(odd);
  assert.deepEqual(loaded, { "/a": true });
  assert.equal(Object.getPrototypeOf(loaded), Object.prototype);

  for (const raw of ["not json", "[true]", "null", "7"]) {
    // A v2 that is there but unreadable is no reason to read the old key.
    const malformed = createStorage({ "pi-web:sidebar-groups-v2": raw, "pi-web:sidebar-groups": '{"/old":false}' });
    assert.deepEqual(loadGroupExpansion(malformed), {}, raw);
  }
});

test("the old group choices move to v2 once, collapses only", () => {
  // The old keep-open saved every group that stopped being current as open:
  // those cannot be told from the user's own, so only collapses move.
  const storage = createStorage({
    "pi-web:sidebar-groups": '{"/visited":true,"/closed":false,"/also-visited":true,"C:\\\\closed":false,"/bad":"no"}',
  });
  assert.deepEqual(loadGroupExpansion(storage), { "/closed": false, "C:\\closed": false });
  assert.equal(storage.values.get("pi-web:sidebar-groups-v2"), '{"/closed":false,"C:\\\\closed":false}');
  // The old key goes with the retired ones, after the load; v2 is read from then on.
  forgetRetiredSidebarKeys(storage);
  assert.equal(storage.values.has("pi-web:sidebar-groups"), false);
  assert.deepEqual(loadGroupExpansion(storage), { "/closed": false, "C:\\closed": false });

  // A later write keeps to v2 and never brings the old key back.
  saveGroupExpansion({ "/closed": false, "/opened": true }, storage);
  assert.deepEqual(loadGroupExpansion(storage), { "/closed": false, "/opened": true });
  assert.deepEqual([...storage.values.keys()], ["pi-web:sidebar-groups-v2"]);

  // Once v2 exists the old key is never read, even if it was left behind.
  const leftOver = createStorage({ "pi-web:sidebar-groups-v2": '{"/new":true}', "pi-web:sidebar-groups": '{"/old":false}' });
  assert.deepEqual(loadGroupExpansion(leftOver), { "/new": true });

  // Nothing to move: no v2 is written for a browser that never had choices.
  const fresh = createStorage();
  assert.deepEqual(loadGroupExpansion(fresh), {});
  assert.deepEqual([...fresh.values.keys()], []);
  // An old key with expansions only or unreadable: an empty v2, so it is not looked at again.
  for (const raw of ['{"/visited":true}', "not json"]) {
    const old = createStorage({ "pi-web:sidebar-groups": raw });
    assert.deepEqual(loadGroupExpansion(old), {}, raw);
    assert.equal(old.values.get("pi-web:sidebar-groups-v2"), "{}", raw);
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

test("folders found outside git are kept newest last, leave once found in git, at most 50", () => {
  const storage = createStorage();
  assert.deepEqual(loadNonGitCwds(storage), []);
  rememberCwdGitStatus("/home/a/pi-cwd/20261010", false, storage);
  rememberCwdGitStatus("/tmp/scratch", false, storage);
  assert.deepEqual(loadNonGitCwds(storage), ["/home/a/pi-cwd/20261010", "/tmp/scratch"]);
  // Found again: it becomes the newest.
  rememberCwdGitStatus("/home/a/pi-cwd/20261010", false, storage);
  assert.deepEqual(loadNonGitCwds(storage), ["/tmp/scratch", "/home/a/pi-cwd/20261010"]);
  // It became a repository: it leaves.
  rememberCwdGitStatus("/tmp/scratch", true, storage);
  assert.deepEqual(loadNonGitCwds(storage), ["/home/a/pi-cwd/20261010"]);

  // Nothing changes, nothing is written: a git folder not listed, the newest
  // listed again.
  let writes = 0;
  const counting = { ...storage, setItem(key, value) { writes++; storage.setItem(key, value); } };
  rememberCwdGitStatus("/repo", true, counting);
  rememberCwdGitStatus("/home/a/pi-cwd/20261010", false, counting);
  assert.equal(writes, 0);

  // Another tab's folders stay: each write reads what is saved first.
  storage.setItem("pi-web:sidebar-non-git-cwds", JSON.stringify(["/other-tab"]));
  rememberCwdGitStatus("/mine", false, storage);
  assert.deepEqual(loadNonGitCwds(storage), ["/other-tab", "/mine"]);

  for (let index = 0; index < 55; index++) rememberCwdGitStatus(`/d/${index}`, false, storage);
  const kept = loadNonGitCwds(storage);
  assert.equal(kept.length, 50);
  assert.equal(kept[0], "/d/5");
  assert.equal(kept.at(-1), "/d/54");

  // Malformed saves read as none, or keep their strings only.
  assert.deepEqual(loadNonGitCwds(createStorage({ "pi-web:sidebar-non-git-cwds": "{" })), []);
  assert.deepEqual(loadNonGitCwds(createStorage({ "pi-web:sidebar-non-git-cwds": '{"/a":true}' })), []);
  assert.deepEqual(loadNonGitCwds(createStorage({ "pi-web:sidebar-non-git-cwds": '["/a",1,"",null,"/b"]' })), ["/a", "/b"]);
  // An empty cwd is never kept.
  rememberCwdGitStatus("", false, storage);
  assert.equal(loadNonGitCwds(storage).includes(""), false);
});

test("the keys of the old sessions/explorer split and the old group choices are dropped, and nothing else", () => {
  const storage = createStorage({
    "pi-web:file-explorer:open": "false",
    "pi-web:sidebar-session-pane-height": "320",
    "pi-web:sidebar-groups": '{"/a":true}',
    "pi-web:sidebar-tab": "files",
    "pi-web:sidebar-groups-v2": '{"/b":false}',
  });
  forgetRetiredSidebarKeys(storage);
  assert.deepEqual([...storage.values.keys()], ["pi-web:sidebar-tab", "pi-web:sidebar-groups-v2"]);
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
  assert.equal(loadFilesCollapsed(unavailable), false);
  assert.doesNotThrow(() => saveSidebarTab("files", unavailable));
  assert.doesNotThrow(() => saveFilesCollapsed(true, unavailable));
  assert.doesNotThrow(() => saveShowIgnoredFiles(true, unavailable));
  assert.doesNotThrow(() => savePinnedCollapsed(true, unavailable));
  assert.doesNotThrow(() => saveGroupExpansion({ "/a": true }, unavailable));
  assert.deepEqual(loadNonGitCwds(unavailable), []);
  assert.deepEqual(loadNonGitCwds(null), []);
  assert.doesNotThrow(() => rememberCwdGitStatus("/a", false, unavailable));
  assert.doesNotThrow(() => rememberCwdGitStatus("/a", false, null));
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
    assert.equal(loadFilesCollapsed(), false);
    assert.doesNotThrow(() => saveSidebarTab("files"));
    assert.doesNotThrow(() => saveFilesCollapsed(true));
    assert.doesNotThrow(() => saveShowIgnoredFiles(true));
    assert.doesNotThrow(() => savePinnedCollapsed(true));
    assert.doesNotThrow(() => saveGroupExpansion({ "/a": false }));
    assert.deepEqual(loadNonGitCwds(), []);
    assert.doesNotThrow(() => rememberCwdGitStatus("/a", false));
    assert.doesNotThrow(() => forgetRetiredSidebarKeys());
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});
