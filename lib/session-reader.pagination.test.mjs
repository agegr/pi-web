// Pagination at the data boundary: a linear session (no branching) degrades into
// a single chain whose depth equals its entry count. The old full-forest read
// forced O(n) work and was the trigger for #509 (Maximum call stack size
// exceeded) and #555 (full-history transfer). Slicing bounds both to O(tail).
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { sliceActiveBranch, buildSessionContext } = await jiti.import("./session-reader.ts");

// Build a linear chain of n entries: e0 -> e1 -> ... -> e(n-1).
function linearChain(n) {
  const entries = [];
  for (let i = 0; i < n; i++) {
    entries.push({
      id: `e${i}`,
      parentId: i === 0 ? null : `e${i - 1}`,
      type: "message",
      timestamp: new Date(1000 + i * 1000).toISOString(),
      message: { role: i % 2 === 0 ? "user" : "assistant", content: `msg ${i}` },
    });
  }
  return entries;
}

test("sliceActiveBranch returns the most-recent `tail` ancestors, in time order", () => {
  const entries = linearChain(100);
  const sliced = sliceActiveBranch(entries, "e99", 50);
  assert.equal(sliced.length, 50);
  assert.equal(sliced[0].id, "e50");
  assert.equal(sliced[sliced.length - 1].id, "e99");
});

test("sliceActiveBranch walks from leaf back toward root, not forward", () => {
  const entries = linearChain(10);
  const sliced = sliceActiveBranch(entries, "e5", 3);
  assert.deepEqual(sliced.map((e) => e.id), ["e3", "e4", "e5"]);
});

test("sliceActiveBranch defaults to the last entry when leafId is null", () => {
  const entries = linearChain(7);
  const sliced = sliceActiveBranch(entries, null, 3);
  assert.deepEqual(sliced.map((e) => e.id), ["e4", "e5", "e6"]);
});

test("deep linear chain (5000 entries) slices without overflowing the stack", () => {
  const entries = linearChain(5000);
  // The recursion that #509 hit lived in any path-walk over the full chain.
  // An iterative slice over 5000 entries must not throw Maximum call stack size.
  const sliced = sliceActiveBranch(entries, "e4999", 50);
  assert.equal(sliced.length, 50);
  assert.equal(sliced[sliced.length - 1].id, "e4999");
});

test("buildSessionContext with tail returns only the tail window", () => {
  const entries = linearChain(300);
  const ctx = buildSessionContext(entries, "e299", { tail: 50 });
  assert.equal(ctx.messages.length, 50);
  assert.equal(ctx.entryIds.length, 50);
  assert.equal(ctx.entryIds[0], "e250");
  assert.equal(ctx.entryIds[ctx.entryIds.length - 1], "e299");
});

test("buildSessionContext without tail still returns the full chain", () => {
  const entries = linearChain(20);
  const ctx = buildSessionContext(entries, "e19");
  assert.equal(ctx.messages.length, 20);
});
