import assert from "node:assert/strict";
import test from "node:test";
import { createExpandedPathsMemory, EXPANDED_PATHS_MEMORY_LIMIT } from "./file-tree-expansion.ts";

test("a folder comes back with the directories it had open, an unknown one with none", () => {
  const memory = createExpandedPathsMemory();
  memory.save("/a", new Set(["/a/src", "/a/src/lib"]));
  assert.deepEqual([...memory.restore("/a")], ["/a/src", "/a/src/lib"]);
  assert.deepEqual([...memory.restore("/b")], []);
});

test("what is kept is a copy, both ways", () => {
  const memory = createExpandedPathsMemory();
  const open = new Set(["/a/src"]);
  memory.save("/a", open);
  open.add("/a/docs");
  const restored = memory.restore("/a");
  restored.add("/a/test");
  assert.deepEqual([...memory.restore("/a")], ["/a/src"]);
});

test("saving again replaces the folder's set, and an empty one forgets it", () => {
  const memory = createExpandedPathsMemory(2);
  memory.save("/a", new Set(["/a/src"]));
  memory.save("/a", new Set(["/a/docs"]));
  assert.deepEqual([...memory.restore("/a")], ["/a/docs"]);
  memory.save("/a", new Set());
  memory.save("/b", new Set(["/b/x"]));
  memory.save("/c", new Set(["/c/x"]));
  assert.deepEqual([...memory.restore("/b")], ["/b/x"], "a forgotten folder takes no room");
});

test("past the limit the folder left longest ago goes first", () => {
  assert.equal(EXPANDED_PATHS_MEMORY_LIMIT, 20);
  const memory = createExpandedPathsMemory(3);
  for (const cwd of ["/a", "/b", "/c"]) memory.save(cwd, new Set([`${cwd}/src`]));
  // Leaving /a again makes it the most recent.
  memory.save("/a", new Set(["/a/src"]));
  memory.save("/d", new Set(["/d/src"]));
  assert.deepEqual([...memory.restore("/b")], [], "/b was left longest ago");
  for (const cwd of ["/a", "/c", "/d"]) assert.deepEqual([...memory.restore(cwd)], [`${cwd}/src`]);
  memory.save("/e", new Set(["/e/src"]));
  assert.deepEqual([...memory.restore("/c")], []);
});
