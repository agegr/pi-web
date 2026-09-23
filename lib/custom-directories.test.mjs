import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  addCustomDirectory,
  customDirectoryIdentity,
  isCustomDirectoryListed,
  listCustomDirectories,
  removeCustomDirectory,
  renameCustomDirectory,
} = await jiti.import("./custom-directories.ts");

// Same StorageLike wrapper shape as lib/pinned-projects.test.mjs.
function createStorage(values = new Map()) {
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

const KEY = "pi-web:custom-directories";
const LEGACY = "pi-web:pinned-projects";

test("empty storage lists no directories and never throws", () => {
  assert.deepEqual(listCustomDirectories(createStorage()), []);
  assert.equal(isCustomDirectoryListed("/repo", createStorage()), false);
});

test("add persists the entry at the head, most-recently-added first", () => {
  const storage = createStorage();
  addCustomDirectory("/a", storage);
  addCustomDirectory("/b", storage);
  const entries = listCustomDirectories(storage);
  assert.deepEqual(entries.map((entry) => entry.path), ["/b", "/a"]);
  assert.equal(typeof entries[0].addedAt, "string");
  assert.ok(entries[0].addedAt.length > 0);
  assert.equal(isCustomDirectoryListed("/a", storage), true);
});

test("adding an already-listed directory moves it to the head without duplicating", () => {
  const storage = createStorage();
  addCustomDirectory("/a", storage);
  addCustomDirectory("/b", storage);
  addCustomDirectory("/a", storage);
  const entries = listCustomDirectories(storage);
  assert.deepEqual(entries.map((entry) => entry.path), ["/a", "/b"]);
  // The re-add keeps the existing display name and original addedAt.
  renameCustomDirectory("/a", "My dir", storage);
  addCustomDirectory("/a", storage);
  assert.deepEqual(
    listCustomDirectories(storage).map((entry) => entry.displayName),
    ["My dir", undefined],
  );
});

test("identity dedupes trailing separators and Windows casing", () => {
  // The identity helper is client-safe (no node:path) but mirrors
  // project-identity's philosophy: trailing separators trimmed, case folded
  // only on Windows.
  assert.equal(customDirectoryIdentity("/a/b/", false), "/a/b");
  assert.equal(customDirectoryIdentity("C:\\Repo", true), "c:/repo");
  assert.equal(customDirectoryIdentity("c:/repo/", true), "c:/repo");
  assert.notEqual(customDirectoryIdentity("/A/B", false), "/a/b");

  const storage = createStorage();
  addCustomDirectory("/a/b/", storage);
  addCustomDirectory("/a/b", storage);
  assert.deepEqual(listCustomDirectories(storage).map((entry) => entry.path), ["/a/b"]);
});

test("remove deletes only the named directory (list operation only)", () => {
  const storage = createStorage();
  addCustomDirectory("/a", storage);
  addCustomDirectory("/b", storage);
  removeCustomDirectory("/a/", storage);
  assert.deepEqual(listCustomDirectories(storage).map((entry) => entry.path), ["/b"]);
  assert.equal(isCustomDirectoryListed("/a", storage), false);
  // Removing the last entry persists an empty list — the key's presence
  // stays as the migration marker (see writeList).
  removeCustomDirectory("/b", storage);
  assert.equal(storage.getItem(KEY), "[]");
  assert.deepEqual(listCustomDirectories(storage), []);
  // Removing an unlisted path is a no-op.
  removeCustomDirectory("/missing", storage);
  assert.deepEqual(listCustomDirectories(storage), []);
});

test("rename sets a display name and an empty value clears it", () => {
  const storage = createStorage();
  addCustomDirectory("/a", storage);
  renameCustomDirectory("/a", "Work stuff", storage);
  assert.deepEqual(
    listCustomDirectories(storage).map((entry) => entry.displayName),
    ["Work stuff"],
  );
  // Trailing whitespace is trimmed; an empty/whitespace value clears.
  renameCustomDirectory("/a", "  ", storage);
  assert.deepEqual(
    listCustomDirectories(storage).map((entry) => entry.displayName),
    [undefined],
  );
  // Renaming an unlisted path changes nothing.
  renameCustomDirectory("/missing", "Nope", storage);
  assert.deepEqual(listCustomDirectories(storage).map((entry) => entry.path), ["/a"]);
});

test("corrupt payloads degrade to an empty list and are repaired on add", () => {
  const corrupt = createStorage(new Map([[KEY, "{not json"]]));
  assert.deepEqual(listCustomDirectories(corrupt), []);
  const wrongShape = createStorage(new Map([[KEY, "{\"a\":1}"]]));
  assert.deepEqual(listCustomDirectories(wrongShape), []);
  const mixed = createStorage(new Map([[KEY, JSON.stringify([
    { path: "/a" }, 3, null, { path: "" }, { path: "/b", displayName: "B" },
  ])]]));
  const entries = listCustomDirectories(mixed);
  assert.deepEqual(entries.map((entry) => entry.path), ["/a", "/b"]);
  assert.deepEqual(entries.map((entry) => entry.displayName), [undefined, "B"]);

  addCustomDirectory("/c", corrupt);
  assert.deepEqual(listCustomDirectories(corrupt).map((entry) => entry.path), ["/c"]);
});

test("duplicated identities in a hand-edited payload keep the first entry", () => {
  const dup = createStorage(new Map([[KEY, JSON.stringify([
    { path: "/a", displayName: "first" },
    { path: "/a/", displayName: "second" },
  ])]]));
  assert.deepEqual(
    listCustomDirectories(dup).map((entry) => entry.displayName),
    ["first"],
  );
});

test("migration seeds from legacy {key, root} pins, preserving order", () => {
  const storage = createStorage(new Map([[LEGACY, JSON.stringify([
    { key: "/repo/a", root: "/repo/a" },
    { key: "/repo/b", root: "/display/B" },
  ])]]));
  const entries = listCustomDirectories(storage);
  assert.deepEqual(entries.map((entry) => entry.path), ["/repo/a", "/display/B"]);
  // The migration persists under the new key...
  assert.ok(storage.getItem(KEY) !== null);
  // ...and never writes or deletes the legacy key.
  assert.equal(storage.values.get(LEGACY), JSON.stringify([
    { key: "/repo/a", root: "/repo/a" },
    { key: "/repo/b", root: "/display/B" },
  ]));
});

test("migration accepts the legacy bare-string pin shape", () => {
  const storage = createStorage(new Map([[LEGACY, JSON.stringify(["/a", "/b"])]]));
  assert.deepEqual(
    listCustomDirectories(storage).map((entry) => entry.path),
    ["/a", "/b"],
  );
});

test("migration is idempotent and stops once the new key exists", () => {
  const values = new Map([[LEGACY, JSON.stringify([{ key: "/a", root: "/a" }])]]);
  const storage = createStorage(values);
  const first = listCustomDirectories(storage);
  assert.deepEqual(first.map((entry) => entry.path), ["/a"]);
  // A second read observes the persisted key, not a re-run migration.
  assert.deepEqual(listCustomDirectories(storage).map((entry) => entry.path), ["/a"]);
  // Changing the legacy payload after migration has no effect.
  values.set(LEGACY, JSON.stringify([{ key: "/z", root: "/z" }]));
  assert.deepEqual(listCustomDirectories(storage).map((entry) => entry.path), ["/a"]);
  // An explicit remove clears the new key; a later read does NOT re-migrate
  // from the legacy payload (the feature's own writes win).
  removeCustomDirectory("/a", storage);
  assert.deepEqual(listCustomDirectories(storage), []);
});

test("every accessor re-reads storage (no cached state)", () => {
  const values = new Map();
  addCustomDirectory("/a", createStorage(values));
  // A second, independent store instance — like a hot-reloaded module or a
  // page reload — must observe the same persisted data.
  assert.deepEqual(
    listCustomDirectories(createStorage(values)).map((entry) => entry.path),
    ["/a"],
  );
  // Mutating through one instance is visible through another.
  removeCustomDirectory("/a", createStorage(values));
  assert.deepEqual(listCustomDirectories(createStorage(values)), []);
});

test("an empty path is never added", () => {
  const storage = createStorage();
  addCustomDirectory("", storage);
  assert.deepEqual(listCustomDirectories(storage), []);
});

test("unavailable storage degrades to an empty list, never throws", () => {
  const broken = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
  };
  assert.doesNotThrow(() => listCustomDirectories(broken));
  assert.deepEqual(listCustomDirectories(broken), []);
  assert.doesNotThrow(() => addCustomDirectory("/a", broken));
  assert.doesNotThrow(() => removeCustomDirectory("/a", broken));
  assert.doesNotThrow(() => renameCustomDirectory("/a", "x", broken));
});
