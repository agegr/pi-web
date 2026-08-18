import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countReviewActions,
  isMailCategory,
  normalizeAction,
  normalizeCategory,
} from "./mail.ts";

test("category normalisation accepts the known set and falls back to other", () => {
  assert.equal(isMailCategory("interview"), true);
  assert.equal(isMailCategory("bogus"), false);
  assert.equal(normalizeCategory("interview"), "interview");
  assert.equal(normalizeCategory("  "), "other");
  assert.equal(normalizeCategory(undefined), "other");
});

test("action normalisation accepts none/todo/event/both and falls back to none", () => {
  assert.equal(normalizeAction("todo"), "todo");
  assert.equal(normalizeAction("both"), "both");
  assert.equal(normalizeAction("maybe"), "none");
  assert.equal(normalizeAction(undefined), "none");
});

test("countReviewActions tallies todos and events, and a both item counts in each", () => {
  const review = {
    day: "2026-08-17",
    reviewedAt: "2026-08-17T08:00:00.000Z",
    items: [
      { id: "a", threadId: "a", from: "", subject: "", snippet: "", date: "", category: "other", summary: "", action: "none" },
      { id: "b", threadId: "b", from: "", subject: "", snippet: "", date: "", category: "deadline", summary: "", action: "todo" },
      { id: "c", threadId: "c", from: "", subject: "", snippet: "", date: "", category: "appointment", summary: "", action: "event" },
      { id: "d", threadId: "d", from: "", subject: "", snippet: "", date: "", category: "interview", summary: "", action: "both" },
    ],
  };
  assert.deepEqual(countReviewActions(review), { todos: 2, events: 2 });
});
