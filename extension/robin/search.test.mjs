import assert from "node:assert/strict";
import { test } from "node:test";
import { searchDashboard } from "./search.ts";

const data = {
  links: [
    { id: "l1", title: "Gmail", url: "https://mail.google.com", group: "日常入口", createdAt: "" },
    { id: "l2", title: "Machine Learning", url: "https://example.com/ml", group: "AI", createdAt: "" },
  ],
  todos: [
    { id: "t1", title: "Apply to Acme", done: false, due: "2026-08-20", createdAt: "" },
  ],
  events: [
    { id: "e1", title: "Office hours", date: "2026-08-20", location: "Wean Hall", createdAt: "" },
  ],
};

test("searchDashboard searches titles and collection metadata", () => {
  assert.equal(searchDashboard(data, "gmail")[0]?.kind, "link");
  assert.equal(searchDashboard(data, "日常入口")[0]?.kind, "link");
  assert.equal(searchDashboard(data, "2026-08-20").length, 2);
  assert.equal(searchDashboard(data, "Wean")[0]?.kind, "event");
});

test("searchDashboard ranks title matches first and respects its limit", () => {
  const withMetadataMatch = {
    ...data,
    todos: [...data.todos, { id: "t2", title: "Read notes", done: false, due: "Machine", createdAt: "" }],
  };
  const results = searchDashboard(withMetadataMatch, "Machine", 1);
  assert.deepEqual(results.map(({ kind, item }) => [kind, item.id]), [["link", "l2"]]);
  assert.deepEqual(searchDashboard(data, "   "), []);
});
