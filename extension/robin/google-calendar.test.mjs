// Pin a timezone west of UTC so the zoned-instant conversion is exercised.
process.env.TZ = "America/Los_Angeles";

import assert from "node:assert/strict";
import { test } from "node:test";
import { mapGoogleEvent } from "./google-calendar.ts";

const map = (item) => mapGoogleEvent(item, "Work");

test("a one-day all-day event does not become two days", () => {
  // Google's all-day end is exclusive: the 18th means "through the 17th".
  const event = map({ id: "a", summary: "Holiday", start: { date: "2026-08-17" }, end: { date: "2026-08-18" } });
  assert.equal(event.date, "2026-08-17");
  assert.equal(event.endDate, undefined);
  assert.equal(event.start, undefined);
  assert.equal(event.end, undefined);
  assert.equal(event.source, "google");
  assert.equal(event.calendar, "Work");
  assert.equal(event.id, "google:a");
});

test("a multi-day all-day event converts the exclusive end to an inclusive one", () => {
  // A trip shown in Google as 19th–23rd exclusive covers the 19th to the 22nd.
  const event = map({ id: "trip", summary: "Chicago", start: { date: "2026-08-19" }, end: { date: "2026-08-23" } });
  assert.equal(event.date, "2026-08-19");
  assert.equal(event.endDate, "2026-08-22");
});

test("a multi-day timed event keeps an inclusive end date", () => {
  const event = map({
    id: "conf",
    summary: "Conference",
    start: { dateTime: "2026-08-19T16:00:00Z" }, // 09:00 local on the 19th
    end: { dateTime: "2026-08-21T01:00:00Z" }, // 18:00 local on the 20th
  });
  assert.equal(event.date, "2026-08-19");
  assert.equal(event.start, "09:00");
  assert.equal(event.endDate, "2026-08-20", "timed ends are already inclusive");
  assert.equal(event.end, undefined, "the end time belongs to a different day");
});

test("a timed event is resolved into local wall-clock time", () => {
  // 22:00Z on the 15th is 15:00 on the 15th in Los Angeles (UTC-7 in August).
  const event = map({
    id: "b",
    summary: "Design review",
    start: { dateTime: "2026-08-15T22:00:00Z" },
    end: { dateTime: "2026-08-15T23:30:00Z" },
  });
  assert.equal(event.date, "2026-08-15");
  assert.equal(event.start, "15:00");
  assert.equal(event.end, "16:30");
});

test("an instant whose UTC date differs from the local one lands on the local day", () => {
  // 02:00Z on the 16th is 19:00 on the 15th locally — the day the user sees it.
  const event = map({ id: "c", summary: "Late call", start: { dateTime: "2026-08-16T02:00:00Z" } });
  assert.equal(event.date, "2026-08-15");
  assert.equal(event.start, "19:00");
});

test("an offset other than Z is honoured", () => {
  // 09:00+09:00 (Tokyo) is 00:00Z, which is 17:00 the previous day in LA.
  const event = map({ id: "d", summary: "Tokyo standup", start: { dateTime: "2026-08-16T09:00:00+09:00" } });
  assert.equal(event.date, "2026-08-15");
  assert.equal(event.start, "17:00");
});

test("an end on a later day is dropped rather than shown as a backwards range", () => {
  const event = map({
    id: "e",
    summary: "Overnight",
    start: { dateTime: "2026-08-15T05:00:00Z" }, // 22:00 local on the 14th
    end: { dateTime: "2026-08-15T15:00:00Z" }, // 08:00 local on the 15th
  });
  assert.equal(event.date, "2026-08-14");
  assert.equal(event.start, "22:00");
  assert.equal(event.end, undefined, "a range crossing midnight would render as 22:00–08:00");
});

test("cancelled events and events without a start are skipped", () => {
  assert.equal(map({ id: "f", status: "cancelled", start: { date: "2026-08-17" } }), null);
  assert.equal(map({ id: "g", summary: "No start" }), null);
  assert.equal(map({ id: "h", start: { dateTime: "not-a-time" } }), null);
});

test("a missing summary falls back rather than rendering blank", () => {
  assert.equal(map({ id: "i", start: { date: "2026-08-17" } }).title, "(no title)");
  assert.equal(map({ id: "j", summary: "   ", start: { date: "2026-08-17" } }).title, "(no title)");
});

test("location is carried through when present", () => {
  assert.equal(map({ id: "k", summary: "x", location: "  Room B  ", start: { date: "2026-08-17" } }).location, "Room B");
  assert.equal(map({ id: "l", summary: "x", location: "  ", start: { date: "2026-08-17" } }).location, undefined);
});

test("event details carry safe calendar and meeting links", () => {
  const event = map({
    id: "details",
    summary: "Design review",
    description: "<b>Bring the latest draft.</b><br><a href=\"https://docs.example/draft\">https://docs.example/draft</a>",
    htmlLink: "https://calendar.google.com/event?eid=abc",
    hangoutLink: "https://meet.google.com/abc-defg-hij",
    organizer: { displayName: "  Ada  ", email: "ada@example.com" },
    start: { date: "2026-08-17" },
  });
  assert.equal(event.description, "Bring the latest draft.\nhttps://docs.example/draft");
  assert.equal(event.url, "https://calendar.google.com/event?eid=abc");
  assert.equal(event.meetingUrl, "https://meet.google.com/abc-defg-hij");
  assert.equal(event.organizer, "Ada");
});

test("unsafe links are dropped and a video conference entry is used as fallback", () => {
  const event = map({
    id: "links",
    summary: "Call",
    htmlLink: "javascript:alert(1)",
    hangoutLink: "data:text/html,nope",
    conferenceData: {
      entryPoints: [
        { entryPointType: "phone", uri: "tel:+15551234567" },
        { entryPointType: "video", uri: "https://zoom.us/j/123" },
      ],
    },
    start: { date: "2026-08-17" },
  });
  assert.equal(event.url, undefined);
  assert.equal(event.meetingUrl, "https://zoom.us/j/123");
});

test("a standard google colourId maps to a palette key; a custom one is dropped", () => {
  assert.equal(map({ id: "m", summary: "Standup", start: { dateTime: "2026-08-17T15:00:00Z" }, colorId: "7" }).colorKey, "teal");
  assert.equal(map({ id: "n", summary: "Custom", start: { date: "2026-08-17" }, end: { date: "2026-08-18" }, colorId: "zz" }).colorKey, undefined);
  assert.equal(map({ id: "o", summary: "No colour", start: { date: "2026-08-17" } }).colorKey, undefined);
});
