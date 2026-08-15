import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareEvents,
  eventEndDate,
  eventsInRange,
  formatEventDay,
  formatEventTime,
  groupEventsByDate,
  isAllDayBand,
  isSpanning,
  normalizeTime,
  occursOn,
} from "./events.ts";

const event = (fields) => ({ id: "x", title: "e", date: "2026-08-14", createdAt: "", ...fields });

test("normalizeTime pads to HH:MM and rejects nonsense", () => {
  assert.equal(normalizeTime("9:05"), "09:05");
  assert.equal(normalizeTime("  15:00 "), "15:00");
  assert.equal(normalizeTime("00:00"), "00:00");
  assert.equal(normalizeTime("23:59"), "23:59");
  assert.throws(() => normalizeTime("24:00"), /valid time/);
  assert.throws(() => normalizeTime("12:60"), /valid time/);
  assert.throws(() => normalizeTime("3pm"), /HH:MM/);
  assert.throws(() => normalizeTime("1500"), /HH:MM/);
});

test("compareEvents puts all-day first, then orders by start", () => {
  const allDay = event({ id: "a", title: "Holiday" });
  const morning = event({ id: "b", title: "Standup", start: "09:00" });
  const evening = event({ id: "c", title: "Dinner", start: "19:00" });
  const sorted = [evening, morning, allDay].sort(compareEvents).map((e) => e.id);
  assert.deepEqual(sorted, ["a", "b", "c"]);
});

test("compareEvents orders across dates before times", () => {
  const late = event({ id: "a", date: "2026-08-14", start: "23:00" });
  const early = event({ id: "b", date: "2026-08-15", start: "01:00" });
  assert.deepEqual([early, late].sort(compareEvents).map((e) => e.id), ["a", "b"]);
});

test("eventsInRange is inclusive on both ends", () => {
  const events = [
    event({ id: "before", date: "2026-08-13" }),
    event({ id: "from", date: "2026-08-14" }),
    event({ id: "mid", date: "2026-08-16" }),
    event({ id: "to", date: "2026-08-18" }),
    event({ id: "after", date: "2026-08-19" }),
  ];
  assert.deepEqual(
    eventsInRange(events, "2026-08-14", "2026-08-18").map((e) => e.id),
    ["from", "mid", "to"],
  );
});

test("groupEventsByDate buckets chronologically and sorts within a day", () => {
  const events = [
    event({ id: "b", date: "2026-08-15", start: "10:00" }),
    event({ id: "a", date: "2026-08-14", start: "09:00" }),
    event({ id: "c", date: "2026-08-15" }),
  ];
  assert.deepEqual(
    groupEventsByDate(events).map((g) => [g.date, g.events.map((e) => e.id)]),
    [["2026-08-14", ["a"]], ["2026-08-15", ["c", "b"]]],
  );
});

test("groupEventsByDate does not mutate its input", () => {
  const events = [event({ id: "b", start: "10:00" }), event({ id: "a", start: "09:00" })];
  groupEventsByDate(events);
  assert.deepEqual(events.map((e) => e.id), ["b", "a"]);
});

test("eventEndDate ignores an endDate that is not actually later", () => {
  assert.equal(eventEndDate(event({})), "2026-08-14");
  assert.equal(eventEndDate(event({ endDate: "2026-08-16" })), "2026-08-16");
  assert.equal(eventEndDate(event({ endDate: "2026-08-14" })), "2026-08-14");
  assert.equal(eventEndDate(event({ endDate: "2026-08-10" })), "2026-08-14", "a bad endDate cannot invert the event");
});

test("isSpanning and occursOn cover the whole inclusive range", () => {
  const trip = event({ date: "2026-08-19", endDate: "2026-08-22" });
  assert.ok(isSpanning(trip));
  assert.ok(!isSpanning(event({})));
  assert.ok(!occursOn(trip, "2026-08-18"));
  assert.ok(occursOn(trip, "2026-08-19"));
  assert.ok(occursOn(trip, "2026-08-21"));
  assert.ok(occursOn(trip, "2026-08-22"), "the end date is inclusive");
  assert.ok(!occursOn(trip, "2026-08-23"));
});

test("isAllDayBand catches timed events that span days", () => {
  assert.ok(isAllDayBand(event({})), "no start time");
  assert.ok(!isAllDayBand(event({ start: "09:00" })));
  assert.ok(
    isAllDayBand(event({ start: "09:00", date: "2026-08-19", endDate: "2026-08-22" })),
    "a multi-day timed event has no position on a single day's grid",
  );
});

test("eventsInRange finds a span that merely overlaps the window", () => {
  const trip = event({ id: "trip", date: "2026-08-19", endDate: "2026-08-22" });
  const inside = event({ id: "inside", date: "2026-08-20" });
  const events = [trip, inside];
  // A window wholly inside the trip: the trip starts before it and ends after.
  assert.deepEqual(eventsInRange(events, "2026-08-20", "2026-08-20").map((e) => e.id), ["trip", "inside"]);
  assert.deepEqual(eventsInRange(events, "2026-08-22", "2026-08-25").map((e) => e.id), ["trip"]);
  assert.deepEqual(eventsInRange(events, "2026-08-23", "2026-08-25").map((e) => e.id), []);
  assert.deepEqual(eventsInRange(events, "2026-08-01", "2026-08-18").map((e) => e.id), []);
});

test("groupEventsByDate repeats a span on every day it covers", () => {
  const trip = event({ id: "trip", date: "2026-08-19", endDate: "2026-08-21" });
  const grouped = groupEventsByDate([trip]);
  assert.deepEqual(grouped.map((g) => g.date), ["2026-08-19", "2026-08-20", "2026-08-21"]);
  for (const group of grouped) assert.deepEqual(group.events.map((e) => e.id), ["trip"]);
});

test("formatEventTime covers all-day, open-ended, and ranged events", () => {
  assert.equal(formatEventTime(event({})), "All day");
  assert.equal(formatEventTime(event({ start: "09:00" })), "09:00");
  assert.equal(formatEventTime(event({ start: "09:00", end: "10:30" })), "09:00–10:30");
});

test("formatEventDay labels today and tomorrow relatively", () => {
  assert.equal(formatEventDay("2026-08-14", "2026-08-14"), "Today");
  assert.equal(formatEventDay("2026-08-15", "2026-08-14"), "Tomorrow");
  assert.equal(formatEventDay("2026-08-20", "2026-08-14"), "2026-08-20");
});
