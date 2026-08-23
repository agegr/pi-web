/**
 * Calendar events for the Robin dashboard.
 *
 * Pure logic only — no node builtins, because the dashboard imports these into
 * client components. File access lives in ./store.ts.
 *
 * ## Why events store wall-clock time, not instants
 *
 * An event is `{ date: "2026-08-17", start: "15:00" }` — a *floating* local
 * date and time — rather than a UTC instant. For a personal calendar that is
 * the meaning people intend: "the 3pm meeting" is at 3pm on the clock in front
 * of you, and it should not drift.
 *
 * Storing an instant instead would reintroduce the bug already fixed for todo
 * due dates, plus a worse one: an instant computed today for a date on the far
 * side of a DST change renders an hour off once the offset shifts. Wall-clock
 * values are immune, because no conversion ever happens.
 *
 * The trade-off, recorded here so it stays a decision rather than an accident:
 * a floating event does not survive the user changing timezone, and syncing to
 * Google Calendar (which stores zoned instants) would need an explicit
 * timezone field added to this type. That is the migration point to revisit.
 */
import { addDays } from "./dates.ts";

export interface CalendarEvent {
  id: string;
  title: string;
  /** Local calendar date the event starts on, YYYY-MM-DD. */
  date: string;
  /**
   * Last local date the event covers, **inclusive**. Absent means a single day.
   *
   * Inclusive rather than exclusive because that is what a person means by
   * "the 19th to the 22nd", and it is what both the UI and the agent tool take
   * as input. Google's API uses an exclusive end for all-day events, so the
   * mapper in google-calendar.ts converts.
   */
  endDate?: string;
  /** Local wall-clock start, HH:MM (24h). Absent means an all-day event. */
  start?: string;
  /** Local wall-clock end, HH:MM (24h). Only meaningful alongside `start`. */
  end?: string;
  location?: string;
  /** Plain-text notes supplied by the calendar provider. */
  description?: string;
  /** Canonical page for the event, such as Google Calendar's event page. */
  url?: string;
  /** Direct video-call URL when the provider exposes one. */
  meetingUrl?: string;
  /** Display name or email address of the event organizer. */
  organizer?: string;
  /** UTC instant, ISO 8601. */
  createdAt: string;
}

/** Last day the event covers, inclusive. */
export function eventEndDate(event: CalendarEvent): string {
  return event.endDate && event.endDate > event.date ? event.endDate : event.date;
}

/** True when the event covers more than one calendar day. */
export function isSpanning(event: CalendarEvent): boolean {
  return eventEndDate(event) !== event.date;
}

/**
 * Events that occupy the all-day strip rather than the time grid: anything
 * without a start time, and anything spanning days. A multi-day timed event has
 * no sensible position on a single day's grid, so it becomes a bar — which is
 * also how Google renders it.
 */
export function isAllDayBand(event: CalendarEvent): boolean {
  return !event.start || isSpanning(event);
}

export function occursOn(event: CalendarEvent, date: string): boolean {
  return date >= event.date && date <= eventEndDate(event);
}

/**
 * An event as the dashboard sees it: entries from the Robin store plus
 * read-only ones pulled from a connected Google calendar. `source` exists only
 * on the wire — nothing with a non-local source is ever written to the store.
 */
export interface DashboardEvent extends CalendarEvent {
  source?: "local" | "google";
  /** Name of the originating calendar, for events that came from one. */
  calendar?: string;
  /**
   * A key into the event palette (see eventColors.ts), set from Google's
   * `colorId` when resolvable. Absent for local events and custom Google
   * colours — the renderer falls back to a hash of the title.
   */
  colorKey?: string;
}

export function isReadOnlyEvent(event: DashboardEvent): boolean {
  return event.source === "google";
}

/** Coerce a supplied time into HH:MM (24h), rejecting anything ambiguous. */
export function normalizeTime(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) throw new Error(`Not a HH:MM time: ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Not a valid time: ${value}`);
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

/**
 * The ordering and grouping helpers are generic over the event type so a
 * DashboardEvent keeps its `source` and `calendar` through them.
 */

/** All-day events sort first, then by start time, then by title. */
export function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  if (!a.start && b.start) return -1;
  if (a.start && !b.start) return 1;
  if (a.start && b.start && a.start !== b.start) return a.start.localeCompare(b.start);
  return a.title.localeCompare(b.title);
}

/**
 * Events overlapping [from, to], both inclusive local calendar dates.
 *
 * Interval overlap, not a match on the start date: a trip from the 19th to the
 * 22nd is part of a range covering the 20th even though it starts before it.
 */
export function eventsInRange<T extends CalendarEvent>(events: T[], from: string, to: string): T[] {
  return events
    .filter((event) => event.date <= to && eventEndDate(event) >= from)
    .sort(compareEvents);
}

/**
 * Group events into per-day buckets, chronologically.
 *
 * A spanning event appears under **every** day it covers, so per-day views show
 * it as ongoing rather than only on the day it began. Callers that want one
 * entry per event (the agenda list) should filter on `event.date === date`.
 * Days with no events are omitted.
 */
export function groupEventsByDate<T extends CalendarEvent>(events: T[]): { date: string; events: T[] }[] {
  const byDate = new Map<string, T[]>();
  for (const event of [...events].sort(compareEvents)) {
    let cursor = event.date;
    const last = eventEndDate(event);
    while (cursor <= last) {
      const existing = byDate.get(cursor);
      if (existing) existing.push(event);
      else byDate.set(cursor, [event]);
      cursor = addDays(cursor, 1);
    }
  }
  return [...byDate]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({ date, events: items }));
}

/** "09:00–10:30", "09:00", or "All day". */
export function formatEventTime(event: CalendarEvent): string {
  if (!event.start) return "All day";
  return event.end ? `${event.start}–${event.end}` : event.start;
}

/** Day heading relative to today where that reads better. */
export function formatEventDay(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return date;
}
