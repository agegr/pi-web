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

test("buildSessionContext excludeLeaf pages upward without duplicating `before`", () => {
  // User path: client has [e48..e52], requests the page before e48 (older).
  // excludeLeaf must start from e47's parent so e48 is NOT re-fetched.
  const entries = linearChain(100);
  const page1 = buildSessionContext(entries, "e52", { tail: 5 }).entryIds;
  assert.deepEqual(page1, ["e48", "e49", "e50", "e51", "e52"]);
  const oldest = page1[0]; // e48
  const page2 = buildSessionContext(entries, oldest, { tail: 5, excludeLeaf: true }).entryIds;
  assert.equal(page2[page2.length - 1], "e47");
  assert.ok(!page2.includes(oldest), "page2 must not duplicate the `before` boundary");
  // Adjacent pages share no id -> prepending never double-renders.
  assert.ok(page1.every((id) => !page2.includes(id)));
});

test("buildSessionContext accepts a large tail and returns the whole chain", () => {
  const entries = linearChain(5000);
  const ctx = buildSessionContext(entries, "e4999", { tail: 5000 });
  assert.equal(ctx.messages.length, 5000);
  // NOTE: the 1000 cap is enforced at the route layer (Math.min(rawTail, 1000)),
  // see app/api/sessions/[id]/{route,context/route}.test.mjs.
});

test("real sessions may store assistant content as a string (deferThinking guard)", () => {
  // Regression for the long-session 500: entryToUiMessage calls content.map in
  // the deferThinking branch, but real assistant content can be a plain string.
  const entries = [
    { id: "u1", parentId: null, type: "message", timestamp: new Date(1).toISOString(),
      message: { role: "user", content: "hi" } },
    { id: "a1", parentId: "u1", type: "message", timestamp: new Date(2).toISOString(),
      message: { role: "assistant", content: "a string reply, not a block array" } },
  ];
  const ctx = buildSessionContext(entries, "a1", { deferThinking: true, tail: 50 });
  assert.equal(ctx.messages.length, 2);
  assert.equal(ctx.messages[1].content, "a string reply, not a block array");
});
