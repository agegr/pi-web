import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getPinnedProjects,
  getPinnedProjectKeys,
  isProjectPinned,
  pinProject,
  unpinProject,
} = await jiti.import("./pinned-projects.ts");

// Wraps a Map in the StorageLike shape. When given an existing Map it wraps
// THAT map (not a copy) so two wrappers behave like two localStorage
// instances over the same backing store — a page reload or hot-reloaded
// module observing the same persisted data.
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

const KEY = "pi-web:pinned-projects";

test("no pins by default", () => {
  assert.deepEqual(getPinnedProjects(createStorage()), []);
  assert.deepEqual(getPinnedProjectKeys(createStorage()), []);
  assert.equal(isProjectPinned("/repo", createStorage()), false);
});

test("pin then read round-trips key and display root", () => {
  const storage = createStorage();
  pinProject("/repo", "/repo", storage);
  assert.deepEqual(getPinnedProjects(storage), [{ key: "/repo", root: "/repo" }]);
  assert.deepEqual(getPinnedProjectKeys(storage), ["/repo"]);
  assert.equal(isProjectPinned("/repo", storage), true);
  assert.equal(isProjectPinned("/other", storage), false);
});

test("zero-session pins survive: the display root is persisted, not derived", () => {
  const storage = createStorage();
  // The stable key can differ from the display root (e.g. case-folded
  // Windows identity keys); a project with no loaded sessions must still be
  // renderable and selectable from the persisted root alone.
  pinProject("c:/repo", "C:\\Repo", storage);
  assert.deepEqual(getPinnedProjects(storage), [{ key: "c:/repo", root: "C:\\Repo" }]);
});

test("most recently pinned comes first", () => {
  const storage = createStorage();
  pinProject("/a", "/a", storage);
  pinProject("/b", "/b", storage);
  pinProject("/c", "/c", storage);
  assert.deepEqual(getPinnedProjectKeys(storage), ["/c", "/b", "/a"]);

  // re-pinning an existing key moves it to the front without duplicating
  pinProject("/a", "/a", storage);
  assert.deepEqual(getPinnedProjectKeys(storage), ["/a", "/c", "/b"]);
});

test("re-pinning refreshes the display root", () => {
  const storage = createStorage();
  pinProject("/a", "/old-root", storage);
  pinProject("/a", "/new-root", storage);
  assert.deepEqual(getPinnedProjects(storage), [{ key: "/a", root: "/new-root" }]);
});

test("unpin removes only the named key", () => {
  const storage = createStorage();
  pinProject("/a", "/a", storage);
  pinProject("/b", "/b", storage);
  unpinProject("/a", storage);
  assert.deepEqual(getPinnedProjectKeys(storage), ["/b"]);
  assert.equal(isProjectPinned("/a", storage), false);
});

test("unpinning the last pin clears the storage key entirely", () => {
  const storage = createStorage();
  pinProject("/a", "/a", storage);
  unpinProject("/a", storage);
  assert.equal(storage.getItem(KEY), null);
  assert.deepEqual(getPinnedProjects(storage), []);
});

test("unpin of an unpinned key is a no-op", () => {
  const storage = createStorage();
  pinProject("/a", "/a", storage);
  unpinProject("/missing", storage);
  assert.deepEqual(getPinnedProjectKeys(storage), ["/a"]);
});

test("every accessor re-reads storage (no cached state)", () => {
  const storage = createStorage();
  pinProject("/a", "/a", storage);
  // A second, independent store instance — like a hot-reloaded module or a
  // page reload — must observe the same persisted data.
  assert.deepEqual(getPinnedProjects(createStorage(storage.values)), [{ key: "/a", root: "/a" }]);
  // Mutating through one instance is visible through another.
  unpinProject("/a", createStorage(storage.values));
  assert.deepEqual(getPinnedProjects(storage), []);
});

test("legacy bare-string payloads are accepted", () => {
  // Pins written by the previous store shape (a plain array of keys) must
  // survive; the key doubles as the display root.
  const legacy = createStorage(new Map([[KEY, "[\"/a\",\"/b\"]"]]));
  assert.deepEqual(getPinnedProjects(legacy), [
    { key: "/a", root: "/a" },
    { key: "/b", root: "/b" },
  ]);
  // And a new pin merges with them without losing the legacy entries.
  pinProject("/c", "/c", legacy);
  assert.deepEqual(getPinnedProjectKeys(legacy), ["/c", "/a", "/b"]);
});

test("corrupt payloads degrade to no pins", () => {
  const corrupt = createStorage(new Map([[KEY, "{not json"]]));
  assert.deepEqual(getPinnedProjects(corrupt), []);

  const wrongShape = createStorage(new Map([[KEY, "{\"a\":1}"]]));
  assert.deepEqual(getPinnedProjects(wrongShape), []);

  const mixed = createStorage(new Map([[KEY, "[\"/a\", 3, null, \"\", {\"key\":\"/b\"}]"]]));
  assert.deepEqual(getPinnedProjects(mixed), [
    { key: "/a", root: "/a" },
    { key: "/b", root: "/b" },
  ]);

  // A corrupt payload is repaired on the next pin.
  pinProject("/b", "/b", corrupt);
  assert.deepEqual(getPinnedProjectKeys(corrupt), ["/b"]);
});

test("duplicated keys in a hand-edited payload keep the first entry", () => {
  const dup = createStorage(new Map([[KEY, JSON.stringify([
    { key: "/a", root: "/first" },
    { key: "/a", root: "/second" },
  ])]]));;
  assert.deepEqual(getPinnedProjects(dup), [{ key: "/a", root: "/first" }]);
});

test("an empty key is never pinned", () => {
  const storage = createStorage();
  pinProject("", "/root", storage);
  assert.deepEqual(getPinnedProjects(storage), []);
  assert.equal(isProjectPinned("", storage), false);
});

test("an empty display root falls back to the key", () => {
  const storage = createStorage();
  pinProject("/a", "", storage);
  assert.deepEqual(getPinnedProjects(storage), [{ key: "/a", root: "/a" }]);
});
