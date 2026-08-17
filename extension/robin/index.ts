/**
 * Robin dashboard extension — spike.
 *
 * Proves the end-to-end loop the personal dashboard depends on: the agent
 * calls a registered tool, the tool mutates a store on disk, and the web UI
 * reads that same store.
 *
 * Loaded by pi from ~/.pi/agent/extensions/robin (symlink to this directory).
 * No build step: jiti imports the TypeScript directly and aliases `typebox` and
 * the pi SDK packages to pi's own copies, so nothing needs installing.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchPageMetadata, nameFromUrl } from "./fetch-title.ts";
import { storeIcon } from "./icons.ts";
import { fetchEvents as fetchGoogleEvents, isConnected as googleConnected } from "./google-calendar.ts";
import {
  addDays,
  compareEvents,
  eventsInRange,
  findTodo,
  formatEventTime,
  formatTodo,
  localDate,
  newId,
  normalizeDue,
  normalizeTime,
  normalizeUrl,
  readEvents,
  readLinks,
  readTodos,
  todosPath,
  writeEvents,
  writeLinks,
  writeTodos,
  type CalendarEvent,
  type Link,
  type Todo,
} from "./store.ts";

function text(message: string) {
  return { content: [{ type: "text" as const, text: message }], details: {} };
}

const robin = (pi: ExtensionAPI) => {
  pi.registerTool({
    name: "todo_add",
    label: "Add todo",
    description:
      "Add a task to the user's personal todo list. Use this whenever the user mentions something they need to do later.",
    promptSnippet: "todo_add — record a task on the user's todo list",
    promptGuidelines: [
      "When the user mentions something they intend to do later, record it with todo_add instead of only acknowledging it.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Short description of the task" }),
      due: Type.Optional(
        Type.String({
          description:
            "Due date as YYYY-MM-DD in the user's local timezone, if they gave one. Resolve relative dates against the local date reported by todo_list, not UTC.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      let due: string | undefined;
      if (params.due) {
        try {
          due = normalizeDue(params.due);
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error));
        }
      }

      const todos = readTodos();
      const today = localDate();
      const todo: Todo = {
        id: newId(),
        title: params.title,
        done: false,
        ...(due ? { due } : {}),
        createdAt: new Date().toISOString(),
      };
      todos.push(todo);
      writeTodos(todos);

      const open = todos.filter((t) => !t.done).length;
      return text(`Added ${formatTodo(todo, today)}\n${open} open todo(s).`);
    },
  });

  pi.registerTool({
    name: "todo_list",
    label: "List todos",
    description: "List the user's todos. Returns ids, which other todo tools accept.",
    promptSnippet: "todo_list — read the user's todo list",
    parameters: Type.Object({
      includeDone: Type.Optional(Type.Boolean({ description: "Include completed todos (default false)" })),
    }),
    async execute(_toolCallId, params) {
      const todos = readTodos();
      const today = localDate();
      const visible = params.includeDone ? todos : todos.filter((t) => !t.done);
      // The local date is stated explicitly so relative dates ("tomorrow") are
      // resolved against the user's day, not the model's assumed UTC one.
      const header = `Today is ${today} (user's local date).`;
      if (visible.length === 0) {
        return text(`${header}\n${params.includeDone ? "No todos." : "No open todos."}`);
      }
      return text(`${header}\n${visible.map((t) => formatTodo(t, today)).join("\n")}`);
    },
  });

  pi.registerTool({
    name: "todo_complete",
    label: "Complete todo",
    description:
      "Mark a todo as done. Identify it by id (from todo_list) or by a distinctive part of its title.",
    promptSnippet: "todo_complete — mark a todo as done",
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: "Todo id from todo_list" })),
      title: Type.Optional(Type.String({ description: "Part of the todo title, if the id is unknown" })),
    }),
    async execute(_toolCallId, params) {
      const todos = readTodos();
      const found = findTodo(todos, params);
      if ("error" in found) return text(found.error);

      const today = localDate();
      if (found.todo.done) return text(`Already done: ${formatTodo(found.todo, today)}`);
      found.todo.done = true;
      found.todo.completedAt = new Date().toISOString();
      writeTodos(todos);

      const open = todos.filter((t) => !t.done).length;
      return text(`Completed ${formatTodo(found.todo, today)}\n${open} open todo(s) left.`);
    },
  });

  pi.registerTool({
    name: "link_add",
    label: "Save link",
    description:
      "Save a URL to the user's link collection. Use this when they ask to bookmark, save, or remember a site or app, or when they paste a bare URL. Omit the title to have the page's own title looked up.",
    promptSnippet: "link_add — save a URL to the user's link collection",
    promptGuidelines: [
      "When the user pastes a bare URL with no instructions, save it with link_add and tell them what the page turned out to be.",
      "Never guess a link's title from its URL. Pass title only when the user stated the name themselves; otherwise omit it so link_add fetches the real page title.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "The URL. A bare host like example.com/x is fine." }),
      title: Type.Optional(
        Type.String({
          description:
            "Only when the user explicitly named it. Omit otherwise — the page's real <title> is fetched, which is more accurate than anything inferred from the URL.",
        }),
      ),
      group: Type.Optional(
        Type.String({ description: 'Section to file it under, e.g. "Apps" or "Reading"' }),
      ),
    }),
    async execute(_toolCallId, params) {
      let url: string;
      try {
        // Also rejects javascript:/data: — these end up in an href on the dashboard.
        url = normalizeUrl(params.url);
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error));
      }

      // Looking the title up is what turns a pasted URL into something the
      // user recognises in the panel; the hostname is only the fallback.
      const given = params.title?.trim();
      const { title: fetched, iconUrl } = await fetchPageMetadata(url);
      const title = given || fetched || nameFromUrl(url);

      const id = newId();
      const icon = iconUrl ? await storeIcon(id, iconUrl) : null;

      const links = readLinks();
      const link: Link = {
        id,
        title,
        url,
        ...(params.group?.trim() ? { group: params.group.trim() } : {}),
        ...(icon ? { icon } : {}),
        iconCheckedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      links.push(link);
      writeLinks(links);
      // Naming the source keeps the model from reporting a title it guessed as
      // though the page had confirmed it.
      const provenance = fetched
        ? " (title read from the page)"
        : given
          ? ""
          : " (the page gave no usable title — a login wall or error page —"
            + " so this name comes from the URL; the user can rename it by"
            + " double-clicking it on the dashboard)";
      return text(
        `Saved "${link.title}" → ${link.url}${link.group ? ` under ${link.group}` : ""}${provenance}`,
      );
    },
  });

  pi.registerTool({
    name: "link_list",
    label: "List links",
    description: "List the user's saved links and app shortcuts.",
    promptSnippet: "link_list — read the user's saved links",
    parameters: Type.Object({}),
    async execute() {
      const links = readLinks();
      if (links.length === 0) return text("No links saved.");
      return text(
        links.map((l) => `${l.id}  ${l.title} — ${l.url}${l.group ? ` [${l.group}]` : ""}`).join("\n"),
      );
    },
  });

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

  // Confirms the extension actually loaded, and where its data went.
  pi.registerCommand("robin-status", {
    description: "Show Robin store location and todo counts",
    handler: async (_args, ctx) => {
      const todos = readTodos();
      const open = todos.filter((t) => !t.done).length;
      ctx.ui.notify(`Robin store: ${todosPath()} — ${todos.length} todo(s), ${open} open.`);
    },
  });
};

export default robin;
