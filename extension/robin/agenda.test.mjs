import assert from "node:assert/strict";
import { test } from "node:test";
import { groupAgendaItems } from "./agenda.ts";

const event = (id, date) => ({ id, title: id, date, createdAt: "" });
const todo = (id, due, done = false) => ({ id, title: id, due, done, createdAt: "" });

test("groupAgendaItems merges dated open todos with calendar days", () => {
  const days = groupAgendaItems(
    [event("meeting", "2026-08-18")],
    [todo("prepare", "2026-08-18"), todo("apply", "2026-08-19")],
  );

  assert.deepEqual(days.map(({ date, events, todos }) => [
    date,
    events.map(({ id }) => id),
    todos.map(({ id }) => id),
  ]), [
    ["2026-08-18", ["meeting"], ["prepare"]],
    ["2026-08-19", [], ["apply"]],
  ]);
});

test("groupAgendaItems omits completed and undated todos", () => {
  const days = groupAgendaItems([], [todo("done", "2026-08-18", true), todo("someday")]);
  assert.deepEqual(days, []);
});
