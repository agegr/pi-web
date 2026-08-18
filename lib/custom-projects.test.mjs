import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  loadCustomProjects,
  removeCustomProject,
  saveCustomProject,
} = await jiti.import("./custom-projects.ts");

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

test("returns an empty list when storage has no entries", () => {
  const storage = createStorage();
  assert.deepEqual(loadCustomProjects(storage), []);
});

test("round-trips pinned projects through save and load", () => {
  const storage = createStorage();
  saveCustomProject({ key: "alpha", root: "/tmp/a" }, storage);
  saveCustomProject({ key: "beta", root: "/tmp/b" }, storage);

  const entries = loadCustomProjects(storage);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.key).sort(), ["alpha", "beta"]);
  for (const entry of entries) {
    assert.match(entry.addedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(typeof entry.root, "string");
  }
});

test("save replaces an existing entry with the same key rather than duplicating it", () => {
  const storage = createStorage();
  saveCustomProject({ key: "alpha", root: "/tmp/a" }, storage);
  saveCustomProject({ key: "alpha", root: "/tmp/a-renamed" }, storage);

  const entries = loadCustomProjects(storage);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].root, "/tmp/a-renamed");
});

test("remove deletes only the requested key", () => {
  const storage = createStorage();
  saveCustomProject({ key: "alpha", root: "/tmp/a" }, storage);
  saveCustomProject({ key: "beta", root: "/tmp/b" }, storage);

  removeCustomProject("alpha", storage);

  const entries = loadCustomProjects(storage);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "beta");
});

test("drops the storage key entirely when the last entry is removed", () => {
  const storage = createStorage();
  saveCustomProject({ key: "alpha", root: "/tmp/a" }, storage);
  assert.ok(storage.values.has("pi-web:custom-project-paths"));

  removeCustomProject("alpha", storage);
  assert.equal(storage.values.has("pi-web:custom-project-paths"), false);
});

test("drops malformed entries without throwing", () => {
  const storage = createStorage({
    "pi-web:custom-project-paths": JSON.stringify([
      { key: "ok", root: "/tmp/ok", addedAt: "2026-08-18T00:00:00.000Z" },
      { key: "missing-root" },
      null,
      "string",
      { key: 42, root: true, addedAt: [] },
    ]),
  });

  const entries = loadCustomProjects(storage);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "ok");
});

test("returns an empty list when storage raises on access", () => {
  const blocked = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.deepEqual(loadCustomProjects(blocked), []);
  assert.doesNotThrow(() => saveCustomProject({ key: "a", root: "/a" }, blocked));
  assert.doesNotThrow(() => removeCustomProject("a", blocked));
});

test("returns an empty list when localStorage is undefined (SSR)", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
  try {
    assert.deepEqual(loadCustomProjects(), []);
    assert.doesNotThrow(() => saveCustomProject({ key: "a", root: "/a" }));
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});