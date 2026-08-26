import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { findRowIndexForEntry, isRenderedRow, resolveJumpElement } = await createJiti(import.meta.url)
  .import("./chat-jump.ts");

test("only user and assistant messages count as scrollable rows", () => {
  assert.equal(isRenderedRow("user"), true);
  assert.equal(isRenderedRow("assistant"), true);
  assert.equal(isRenderedRow("toolResult"), false);
  assert.equal(isRenderedRow("bashExecution"), false);
  assert.equal(isRenderedRow("compactionSummary"), false);
});

test("maps an entry to its own row index", () => {
  const roles = ["user", "assistant", "user", "assistant"];
  const entryIds = ["e0", "e1", "e2", "e3"];
  assert.equal(findRowIndexForEntry(roles, entryIds, "e0"), 0);
  assert.equal(findRowIndexForEntry(roles, entryIds, "e1"), 1);
  assert.equal(findRowIndexForEntry(roles, entryIds, "e3"), 3);
});

test("maps a non-rendered entry to the nearest earlier row", () => {
  const roles = ["user", "assistant", "toolResult", "toolResult", "assistant"];
  const entryIds = ["u1", "a1", "t1", "t2", "a2"];
  // Tool results have no row of their own: fall back to the assistant above.
  assert.equal(findRowIndexForEntry(roles, entryIds, "t1"), 1);
  assert.equal(findRowIndexForEntry(roles, entryIds, "t2"), 1);
  assert.equal(findRowIndexForEntry(roles, entryIds, "a2"), 2);
});

test("reports -1 for unknown entries and for entries with no row before them", () => {
  assert.equal(findRowIndexForEntry(["user"], ["u1"], "missing"), -1);
  assert.equal(findRowIndexForEntry(["compactionSummary", "user"], ["c1", "u1"], "c1"), -1);
});

test("prefers the exact element and otherwise walks back to the nearest rendered row", () => {
  const exact = { id: "exact" };
  const rows = [{ id: "row0" }, null, null];
  assert.equal(resolveJumpElement(rows, 2, exact), exact);
  // Collapsed process group: only the group container at a lower index exists.
  assert.equal(resolveJumpElement(rows, 2, null), rows[0]);
  assert.equal(resolveJumpElement(rows, 99, null), rows[0]);
  assert.equal(resolveJumpElement([null, null], 1, null), null);
  assert.equal(resolveJumpElement([], -1, null), null);
});
