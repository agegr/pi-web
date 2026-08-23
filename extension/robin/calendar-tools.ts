/**
 * The calendar tools: create and list.
 *
 * Server-only (loaded by the extension). calendar_list_events merges the local
 * event store with the read-only Google calendar so the agent never answers
 * "nothing scheduled" to someone whose day is full.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchEvents as fetchGoogleEvents, isConnected as googleConnected } from "./google-calendar.ts";
import {
  addDays,
  compareEvents,
  eventsInRange,
  formatEventTime,
  localDate,
  newId,
  normalizeDue,
  normalizeTime,
  readEvents,
  writeEvents,
  type CalendarEvent,
} from "./store.ts";
import { text } from "./toolkit.ts";

export function registerCalendarTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "calendar_create_event",
    label: "Create event",
    description:
      "Add an event to the user's calendar. Times are the user's local wall-clock time; resolve relative dates against the local date reported by calendar_list_events.",
    promptSnippet: "calendar_create_event — put an event on the user's calendar",
    promptGuidelines: [
      "An appointment with a time goes on the calendar with calendar_create_event; a task to finish goes on the todo list with todo_add.",
      "A date range — a trip, a conference, time off — is ONE event with endDate set, never one event per day.",
      "Events you create are stored locally. The Google calendar is read-only: you can see its events but cannot add to, change, or delete them.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "What the event is" }),
      date: Type.String({ description: "Local start date, YYYY-MM-DD" }),
      endDate: Type.Optional(
        Type.String({
          description:
            "Local last date, YYYY-MM-DD, INCLUSIVE. Set this for anything covering several days, e.g. a trip from the 19th to the 22nd is date=…-19, endDate=…-22. Omit for a single-day event.",
        }),
      ),
      start: Type.Optional(Type.String({ description: "Local start time HH:MM (24h). Omit for an all-day event." })),
      end: Type.Optional(Type.String({ description: "Local end time HH:MM (24h)" })),
      location: Type.Optional(Type.String({ description: "Where it happens" })),
    }),
    async execute(_toolCallId, params) {
      let date: string;
      let endDate: string | undefined;
      let start: string | undefined;
      let end: string | undefined;
      try {
        date = normalizeDue(params.date);
        if (params.endDate) endDate = normalizeDue(params.endDate);
        if (params.start) start = normalizeTime(params.start);
        if (params.end) end = normalizeTime(params.end);
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error));
      }
      if (endDate && endDate < date) return text(`endDate ${endDate} is before ${date}.`);
      if (end && !start) return text("An end time needs a start time too.");
      // Times only have to be ordered within a single day.
      if (start && end && !endDate && end < start) {
        return text(`End ${end} is before start ${start}.`);
      }

      const events = readEvents();
      const event: CalendarEvent = {
        id: newId(),
        title: params.title,
        date,
        ...(endDate && endDate > date ? { endDate } : {}),
        ...(start ? { start } : {}),
        ...(end ? { end } : {}),
        ...(params.location?.trim() ? { location: params.location.trim() } : {}),
        createdAt: new Date().toISOString(),
      };
      events.push(event);
      writeEvents(events);

      const sameDay = events.filter((e) => e.date === date).sort(compareEvents);
      return text(
        event.endDate
          ? `Added "${event.title}" from ${date} to ${event.endDate} (${formatEventTime(event)}).`
          : `Added "${event.title}" on ${date} at ${formatEventTime(event)}.\n`
            + `That day now has ${sameDay.length} event(s): ${sameDay.map((e) => `${formatEventTime(e)} ${e.title}`).join("; ")}`,
      );
    },
  });

  pi.registerTool({
    name: "calendar_list_events",
    label: "List events",
    description:
      "List the user's upcoming calendar events, including any from a connected Google calendar. Also reports the user's local date, which relative dates should be resolved against.",
    promptSnippet: "calendar_list_events — read the user's calendar",
    parameters: Type.Object({
      days: Type.Optional(Type.Number({ description: "How many days ahead to include, starting today (default 7)" })),
    }),
    async execute(_toolCallId, params) {
      const today = localDate();
      const span = Math.max(1, Math.min(params.days ?? 7, 365));
      const until = addDays(today, span - 1);

      // The dashboard merges Google events into its view, so this tool must do
      // the same. Reading only the local store made the agent answer "nothing
      // scheduled" to someone whose day was full — worse than having no tool.
      let events: CalendarEvent[] = readEvents();
      let warning = "";
      if (googleConnected()) {
        try {
          events = [...events, ...await fetchGoogleEvents(today, until)];
        } catch {
          warning = "\n(Could not reach Google Calendar; only locally created events are listed.)";
        }
      }

      const upcoming = eventsInRange(events, today, until);
      const header = `Today is ${today} (user's local date).`;
      if (upcoming.length === 0) {
        return text(`${header}\nNothing scheduled in the next ${span} day(s).${warning}`);
      }
      return text(
        `${header}\n`
        + upcoming
          .map((e) => {
            const span_ = e.endDate && e.endDate > e.date ? `${e.date}..${e.endDate}` : e.date;
            // Google entries cannot be edited or deleted from here; say so
            // rather than letting the model promise something it cannot do.
            const source = (e as { source?: string }).source === "google" ? "  [Google, read-only]" : "";
            return `${e.id}  ${span_} ${formatEventTime(e)}  ${e.title}${e.location ? ` @ ${e.location}` : ""}${source}`;
          })
          .join("\n")
        + warning,
      );
    },
  });
}
