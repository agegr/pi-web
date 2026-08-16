import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { createTextDeltaBatcher } = await jiti.import("./text-delta-batcher.ts");

function harness() {
  const emitted = [];
  const cancelled = [];
  let frame = null;
  let nextId = 1;
  const batcher = createTextDeltaBatcher(
    (callback) => { frame = callback; return nextId++; },
    (id) => { cancelled.push(id); },
    (event) => { emitted.push(event); },
  );
  return { batcher, emitted, cancelled, runFrame: () => { const callback = frame; frame = null; callback?.(16); } };
}

const delta = (contentIndex, text) => ({ type: "text_delta", contentIndex, delta: text });

test("coalesces same-block text into one scheduled emission", () => {
  const h = harness();
  h.batcher.push(delta(0, "a"));
  h.batcher.push(delta(0, "b"));
  assert.equal(h.emitted.length, 0);
  h.runFrame();
  assert.deepEqual(h.emitted, [delta(0, "ab")]);
});

test("flushes synchronously at an ordering boundary", () => {
  const h = harness();
  h.batcher.push(delta(0, "before"));
  h.batcher.push(delta(1, "after"));
  assert.deepEqual(h.emitted, [delta(0, "before")]);
  h.runFrame();
  assert.deepEqual(h.emitted, [delta(0, "before"), delta(1, "after")]);
});

test("flush preserves final text and dispose drops stale frames", () => {
  const h = harness();
  h.batcher.push(delta(0, "final"));
  h.batcher.flush();
  assert.deepEqual(h.emitted, [delta(0, "final")]);
  h.batcher.push(delta(0, "stale"));
  h.batcher.dispose();
  h.runFrame();
  assert.deepEqual(h.emitted, [delta(0, "final")]);
  assert.deepEqual(h.cancelled, [1, 2], "flush cancels the pending frame; dispose cancels the stale one");
});
