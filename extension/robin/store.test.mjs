// Pin a timezone west of UTC so the local/UTC date split is actually exercised.
// Must be set before any Date is constructed.
process.env.TZ = "America/Los_Angeles";

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  dueBucket,
  formatTodo,
  localDate,
  normalizeDue,
  normalizeTodoColor,
  parseLocalDate,
  pruneCompletedTodos,
} from "./store.ts";
import { addMonths, isSameMonth, monthGrid, startOfMonth, startOfWeek, weekDays, weeksFrom } from "./dates.ts";

const todo = (fields) => ({ id: "x", title: "t", done: false, createdAt: "", ...fields });

test("localDate follows the local day, not the UTC one", () => {
  // 21:19 PDT on Aug 14 is already Aug 15 in UTC — the exact case that made
  // "tomorrow" render as "today" in the dashboard.
  const evening = new Date(2026, 7, 14, 21, 19);
  assert.equal(evening.toISOString().slice(0, 10), "2026-08-15");
  assert.equal(localDate(evening), "2026-08-14");
});

test("parseLocalDate builds local midnight, not UTC midnight", () => {
  const parsed = parseLocalDate("2026-08-15");
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 7);
  assert.equal(parsed.getDate(), 15);
  assert.equal(parsed.getHours(), 0);
});

test("parseLocalDate rejects malformed and impossible dates", () => {
  assert.throws(() => parseLocalDate("2026-8-15"));
  assert.throws(() => parseLocalDate("15/08/2026"));
  assert.throws(() => parseLocalDate("2026-02-31"));
});

test("addDays rolls over months, years, and DST", () => {
  assert.equal(addDays("2026-08-14", 1), "2026-08-15");
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  // Spring-forward boundary: 2026-03-08 is the PDT switch.
  assert.equal(addDays("2026-03-07", 1), "2026-03-08");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
});

test("normalizeDue keeps calendar dates and resolves timestamps locally", () => {
  assert.equal(normalizeDue("2026-08-15"), "2026-08-15");
  assert.equal(normalizeDue("  2026-08-15  "), "2026-08-15");
  // Same instant as the regression above: UTC says the 15th, the user meant the 14th.
  assert.equal(normalizeDue("2026-08-15T04:19:00.000Z"), "2026-08-14");
  assert.throws(() => normalizeDue("next thursday"));
});

test("todo colours reuse the calendar palette", () => {
  assert.equal(normalizeTodoColor("  Plum "), "plum");
  assert.throws(() => normalizeTodoColor("red"), /Unknown todo colour/);
  assert.throws(() => normalizeTodoColor("#a1b2c3"), /Unknown todo colour/);
});

test("dueBucket classifies against the supplied local today", () => {
  const today = "2026-08-14";
  assert.equal(dueBucket("2026-08-13", today), "overdue");
  assert.equal(dueBucket("2026-08-14", today), "today");
  assert.equal(dueBucket("2026-08-15", today), "tomorrow");
  assert.equal(dueBucket("2026-09-01", today), "upcoming");
  assert.equal(dueBucket(undefined, today), "none");
});

test("startOfWeek snaps back to Monday", () => {
  // 2026-08-14 is a Friday; 08-16 a Sunday; 08-17 the next Monday.
  assert.equal(startOfWeek("2026-08-14"), "2026-08-10");
  assert.equal(startOfWeek("2026-08-10"), "2026-08-10");
  assert.equal(startOfWeek("2026-08-16"), "2026-08-10");
  assert.equal(startOfWeek("2026-08-17"), "2026-08-17");
});

test("weekDays returns seven consecutive days from Monday", () => {
  assert.deepEqual(weekDays("2026-08-14"), [
    "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13",
    "2026-08-14", "2026-08-15", "2026-08-16",
  ]);
});

test("addMonths clamps onto short months and rolls the year", () => {
  assert.equal(addMonths("2026-08-14", 1), "2026-09-14");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29"); // leap year
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(addMonths("2026-01-15", -1), "2025-12-15");
});

test("startOfMonth and isSameMonth", () => {
  assert.equal(startOfMonth("2026-08-14"), "2026-08-01");
  assert.ok(isSameMonth("2026-08-01", "2026-08-31"));
  assert.ok(!isSameMonth("2026-08-31", "2026-09-01"));
});

test("monthGrid covers the whole month in whole weeks", () => {
  for (const month of ["2026-08-14", "2026-02-10", "2028-02-10", "2026-11-03"]) {
    const grid = monthGrid(month);
    assert.equal(grid.length % 7, 0, `${month}: grid must be whole weeks`);
    assert.equal(startOfWeek(grid[0]), grid[0], `${month}: must start on a Monday`);

    const inMonth = grid.filter((day) => isSameMonth(day, month));
    const first = startOfMonth(month);
    const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
    assert.equal(inMonth.length, daysInMonth, `${month}: every day of the month appears once`);
    assert.equal(inMonth[0], first);

    // Consecutive, no gaps or repeats.
    for (let index = 1; index < grid.length; index += 1) {
      assert.equal(grid[index], addDays(grid[index - 1], 1));
    }
  }
});

test("monthGrid for August 2026 spans six weeks", () => {
  const grid = monthGrid("2026-08-14");
  assert.equal(grid.length, 42);
  assert.equal(grid[0], "2026-07-27");
  assert.equal(grid[41], "2026-09-06");
});

test("formatTodo labels relative due dates and drops them once done", () => {
  const today = "2026-08-14";
  assert.match(formatTodo(todo({ due: "2026-08-14" }), today), /due today/);
  assert.match(formatTodo(todo({ due: "2026-08-15" }), today), /due tomorrow/);
  assert.match(formatTodo(todo({ due: "2026-08-13" }), today), /overdue/);
  assert.equal(formatTodo(todo({ due: "2026-08-13", done: true }), today), "[x] x  t");
});

test("completed todos are retained for one week", () => {
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  const open = todo({ id: "open", createdAt: "2020-01-01T00:00:00.000Z" });
  const recent = todo({ id: "recent", done: true, completedAt: "2026-08-08T12:00:01.000Z" });
  const expired = todo({ id: "expired", done: true, completedAt: "2026-08-07T12:00:00.000Z" });

  assert.deepEqual(pruneCompletedTodos([open, recent, expired], now), [open, recent]);
});

test("weeksFrom returns whole weeks starting on the containing Monday", () => {
  const days = weeksFrom("2026-08-14", 4); // a Friday
  assert.equal(days.length, 28);
  assert.equal(days[0], "2026-08-10", "starts on that week's Monday");
  assert.equal(days[27], "2026-09-06");
  assert.equal(startOfWeek(days[0]), days[0]);
  for (let i = 1; i < days.length; i += 1) {
    assert.equal(days[i], addDays(days[i - 1], 1));
  }
});

test("weeksFrom spans month and year boundaries without gaps", () => {
  const days = weeksFrom("2026-12-30", 4);
  assert.equal(days.length, 28);
  assert.equal(days[0], "2026-12-28");
  assert.equal(days[27], "2027-01-24");
});
