import assert from "node:assert/strict";
import { test } from "node:test";
import { fromMinutes, layoutDayEvents, layoutSpanBars, toMinutes } from "./layout.ts";

const at = (id, start, end, extra = {}) => ({
  id, title: id, date: "2026-08-14", createdAt: "", start, ...(end ? { end } : {}), ...extra,
});
const span = (id, date, endDate) => ({ id, title: id, date, endDate, createdAt: "" });
const allDay = (id, date) => ({ id, title: id, date, createdAt: "" });

const week = [
  "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13",
  "2026-08-14", "2026-08-15", "2026-08-16",
];

test("toMinutes and fromMinutes round-trip", () => {
  assert.equal(toMinutes("00:00"), 0);
  assert.equal(toMinutes("09:30"), 570);
  assert.equal(toMinutes("23:59"), 1439);
  assert.equal(fromMinutes(570), "09:30");
  assert.equal(fromMinutes(0), "00:00");
  assert.equal(fromMinutes(-10), "00:00");
  assert.equal(fromMinutes(99_999), "24:00");
});

test("non-overlapping events each take the full width", () => {
  const placed = layoutDayEvents([at("a", "09:00", "10:00"), at("b", "11:00", "12:00")]);
  assert.deepEqual(placed.map((p) => [p.event.id, p.column, p.columns]), [["a", 0, 1], ["b", 0, 1]]);
});

test("two overlapping events split the width", () => {
  const placed = layoutDayEvents([at("a", "09:00", "11:00"), at("b", "10:00", "12:00")]);
  assert.deepEqual(placed.map((p) => [p.event.id, p.column, p.columns]), [["a", 0, 2], ["b", 1, 2]]);
});

test("a cluster shares one column count so edges line up", () => {
  // c overlaps b only, but all three are transitively one cluster.
  const placed = layoutDayEvents([
    at("a", "09:00", "10:30"),
    at("b", "10:00", "11:30"),
    at("c", "11:00", "12:00"),
  ]);
  assert.deepEqual(placed.map((p) => p.columns), [2, 2, 2]);
  assert.equal(placed.find((p) => p.event.id === "c").column, 0, "c reuses the column a vacated");
});

test("a freed column is reused rather than widening the cluster", () => {
  const placed = layoutDayEvents([
    at("a", "09:00", "10:00"),
    at("b", "09:00", "12:00"),
    at("c", "10:00", "11:00"),
  ]);
  assert.equal(Math.max(...placed.map((p) => p.columns)), 2);
});

test("touching events are separate clusters, not overlaps", () => {
  const placed = layoutDayEvents([at("a", "09:00", "10:00"), at("b", "10:00", "11:00")]);
  assert.deepEqual(placed.map((p) => p.columns), [1, 1]);
});

test("an event with no end gets a minimum height, and midnight is the ceiling", () => {
  const [open] = layoutDayEvents([at("a", "09:00")]);
  assert.equal(open.endMinutes - open.startMinutes, 30);

  const [late] = layoutDayEvents([at("b", "23:50", "23:55")]);
  assert.equal(late.endMinutes, 1440, "clamped to midnight rather than overflowing the grid");
});

test("all-day and spanning events are excluded from the time grid", () => {
  const placed = layoutDayEvents([
    allDay("allday", "2026-08-14"),
    at("trip", "09:00", "10:00", { endDate: "2026-08-16" }),
    at("normal", "09:00", "10:00"),
  ]);
  assert.deepEqual(placed.map((p) => p.event.id), ["normal"]);
});

test("span bars clip to the week and flag where they continue", () => {
  const { bars, lanes } = layoutSpanBars([span("trip", "2026-08-12", "2026-08-19")], week);
  assert.equal(lanes, 1);
  assert.deepEqual(
    bars.map((b) => [b.event.id, b.startIndex, b.endIndex, b.continuesBefore, b.continuesAfter]),
    [["trip", 2, 6, false, true]],
  );
});

test("a bar starting before the week is clipped at the left edge", () => {
  const { bars } = layoutSpanBars([span("trip", "2026-08-05", "2026-08-11")], week);
  assert.deepEqual(
    bars.map((b) => [b.startIndex, b.endIndex, b.continuesBefore, b.continuesAfter]),
    [[0, 1, true, false]],
  );
});

test("overlapping bars stack into lanes, longest on top", () => {
  const { bars, lanes } = layoutSpanBars([
    span("short", "2026-08-12", "2026-08-13"),
    span("long", "2026-08-10", "2026-08-16"),
  ], week);
  assert.equal(lanes, 2);
  assert.equal(bars.find((b) => b.event.id === "long").lane, 0);
  assert.equal(bars.find((b) => b.event.id === "short").lane, 1);
});

test("a short bar fits beside a longer one placed first", () => {
  // The trip is longest so it is placed first, but it starts on Wednesday —
  // the Monday birthday must still fit in the same lane, not push a new one.
  const { bars, lanes } = layoutSpanBars([
    span("trip", "2026-08-12", "2026-08-15"),
    allDay("birthday", "2026-08-10"),
  ], week);
  assert.equal(lanes, 1, "no overlap, so one lane is enough");
  assert.deepEqual(bars.map((b) => b.lane), [0, 0]);
});

test("bars that do not overlap share a lane", () => {
  const { bars, lanes } = layoutSpanBars([
    span("a", "2026-08-10", "2026-08-11"),
    span("b", "2026-08-13", "2026-08-14"),
  ], week);
  assert.equal(lanes, 1);
  assert.deepEqual(bars.map((b) => b.lane), [0, 0]);
});

test("single-day all-day events also get a bar", () => {
  const { bars, lanes } = layoutSpanBars([allDay("birthday", "2026-08-14")], week);
  assert.equal(lanes, 1);
  assert.deepEqual(bars.map((b) => [b.startIndex, b.endIndex]), [[4, 4]]);
});

test("events outside the week are dropped", () => {
  const { bars, lanes } = layoutSpanBars([span("past", "2026-07-01", "2026-07-05")], week);
  assert.deepEqual(bars, []);
  assert.equal(lanes, 0);
});

test("an empty day list is handled", () => {
  assert.deepEqual(layoutSpanBars([allDay("a", "2026-08-14")], []), { bars: [], lanes: 0 });
});
