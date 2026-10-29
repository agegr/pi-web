import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// No module cache: each import is another copy of the module, as each route bundle holds one.
const jiti = createJiti(import.meta.url, { moduleCache: false });
const filesRoute = await jiti.import("./file-watch-registry.ts");
const debugRoute = await jiti.import("./file-watch-registry.ts");
const REGISTRY = Symbol.for("pi-web:file-watch-streams");

test("a watch counts once until it is released, however often release runs, across module copies", () => {
  const baseline = debugRoute.countFileWatches();
  const first = filesRoute.registerFileWatch();
  const second = filesRoute.registerFileWatch();
  assert.equal(debugRoute.countFileWatches(), baseline + 2);

  first();
  first();
  assert.equal(debugRoute.countFileWatches(), baseline + 1, "a repeated release lets go of nothing else");
  second();
  assert.equal(debugRoute.countFileWatches(), baseline);
  second();
  assert.equal(debugRoute.countFileWatches(), baseline);
});

test("counting reads no registry into being", () => {
  const previous = globalThis[REGISTRY];
  try {
    delete globalThis[REGISTRY];
    assert.equal(debugRoute.countFileWatches(), 0);
    assert.equal(REGISTRY in globalThis, false);
    const release = filesRoute.registerFileWatch();
    assert.equal(debugRoute.countFileWatches(), 1);
    release();
    assert.equal(debugRoute.countFileWatches(), 0);
  } finally {
    if (previous === undefined) delete globalThis[REGISTRY];
    else globalThis[REGISTRY] = previous;
  }
});
