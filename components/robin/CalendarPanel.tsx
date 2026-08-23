"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  addDays,
  parseLocalDate,
  startOfWeek,
  weekDays,
  weeksFrom,
} from "@/extension/robin/dates";
import { eventsInRange, type DashboardEvent } from "@/extension/robin/events";
import type { Todo } from "@/extension/robin/store";
import { AgendaView, MonthView, type CalendarView } from "./CalendarViews";
import { WeekGrid } from "./WeekGrid";
import { GoogleConnect } from "./GoogleConnect";
import { EventDetailsDialog } from "./EventDetailsDialog";
import { requestRefresh } from "./refreshBus";
import { mutate, usePolledResource } from "./usePolledResource";

interface EventsResponse {
  events: DashboardEvent[];
  /** Local calendar date resolved on the server, where events were written. */
  today: string;
  google?: { connected: boolean; error?: string };
}

interface TodosResponse {
  todos: Todo[];
}

const AGENDA_DAYS = 7;
/** The month view is a rolling four-week window, not a calendar month. */
const MONTH_WEEKS = 4;
const VIEW_STORAGE_KEY = "robin-calendar-view";
const VIEWS: { id: CalendarView; key: string }[] = [
  { id: "agenda", key: "robin.calendar.agenda" },
  { id: "week", key: "robin.calendar.week" },
  { id: "month", key: "robin.calendar.month" },
];

function readStoredView(): CalendarView {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "agenda" || stored === "week" || stored === "month") return stored;
  } catch {
    // Private mode or blocked storage: the default is fine.
  }
  return "week";
}

export function CalendarPanel() {
  const { t, locale } = useI18n();
  const { data, error, refresh } = usePolledResource<EventsResponse>("/api/robin/events");
  const {
    data: todosData,
    error: todosError,
    refresh: refreshTodos,
  } = usePolledResource<TodosResponse>("/api/robin/todos");
  // Resolved in an effect so server and client render the same first pass.
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<DashboardEvent | null>(null);

  useEffect(() => setView(readStoredView()), []);

  const today = data?.today ?? "";
  // The anchor follows today until the user navigates away from it.
  const activeAnchor = anchor ?? today;

  const chooseView = (next: CalendarView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Not worth surfacing; the view still changes for this session.
    }
  };

  const range = useMemo(() => {
    if (!activeAnchor) return null;
    if (view === "agenda") return { from: today, to: addDays(today, AGENDA_DAYS - 1) };
    if (view === "week") {
      const days = weekDays(activeAnchor);
      return { from: days[0] as string, to: days[6] as string };
    }
    const grid = weeksFrom(activeAnchor, MONTH_WEEKS);
    return { from: grid[0] as string, to: grid[grid.length - 1] as string };
  }, [view, activeAnchor, today]);

  const visible = useMemo(
    () => (range ? eventsInRange(data?.events ?? [], range.from, range.to) : []),
    [data, range],
  );

  const visibleTodos = useMemo(
    () => range
      ? (todosData?.todos ?? []).filter((todo) => !todo.done && todo.due
        && todo.due >= range.from && todo.due <= range.to)
      : [],
    [todosData, range],
  );

  const heading = useMemo(() => {
    if (!activeAnchor || !range) return "";
    if (view === "agenda") return t("robin.calendar.agendaRange", { days: String(AGENDA_DAYS) });
    // A rolling window is named by its range; a month name would be a lie.
    const from = parseLocalDate(range.from);
    const to = parseLocalDate(range.to);
    const format = (value: Date, withYear: boolean) =>
      value.toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
        ...(withYear ? { year: "numeric" } : {}),
      });
    return `${format(from, false)} – ${format(to, true)}`;
  }, [view, activeAnchor, range, t, locale]);

  async function run(action: () => Promise<void>): Promise<boolean> {
    try {
      setActionError(null);
      await action();
      await refresh();
      return true;
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
      return false;
    }
  }

  const step = (direction: -1 | 1) => {
    if (!activeAnchor) return;
    const weeks = view === "month" ? MONTH_WEEKS : 1;
    setAnchor(addDays(startOfWeek(activeAnchor), direction * 7 * weeks));
  };

  const addEvent = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !date) return;
    void run(async () => {
      await mutate("/api/robin/events", "POST", {
        title,
        date,
        ...(endDate ? { endDate } : {}),
        ...(start ? { start } : {}),
        ...(end ? { end } : {}),
      });
      setTitle("");
      setEndDate("");
      setStart("");
      setEnd("");
      setAdding(false);
    });
  };

  const deleteEvent = (event: DashboardEvent) =>
    run(() => mutate("/api/robin/events", "DELETE", { id: event.id }));

  const completeTodo = (todo: Todo) => {
    void (async () => {
      try {
        setActionError(null);
        await mutate("/api/robin/todos", "PATCH", { id: todo.id, done: true });
        await refreshTodos();
        requestRefresh();
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
  };

  const navigable = view !== "agenda";
  const offToday = navigable && activeAnchor !== "" && anchor !== null;

  return (
    <section
      className="pi-card flex flex-col gap-3 p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="pi-label">{t("robin.calendar.title")}</h2>
          <span className="pi-meta">{heading}</span>
        </div>
        <div className="flex items-center gap-1 font-mono">
          {navigable && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={t("robin.calendar.previous")}
                className="ui-action ui-action--outline-soft px-2 py-0.5 text-xs"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setAnchor(null)}
                disabled={!offToday}
                className="ui-action ui-action--outline-soft px-2 py-0.5 text-xs disabled:opacity-40"
              >
                {t("robin.calendar.today")}
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={t("robin.calendar.next")}
                className="ui-action ui-action--outline-soft px-2 py-0.5 text-xs"
              >
                ›
              </button>
            </>
          )}
          {/* No box around the group: the active view already reads from its
              surface and left stripe, and a border here put a third line
              through an already busy row. */}
          <div className="ml-3 flex gap-1.5">
            {VIEWS.map(({ id, key }) => (
              <button
                key={id}
                type="button"
                onClick={() => chooseView(id)}
                className={`ui-action px-2 py-0.5 text-xs${view === id ? " pi-active-stripe" : ""}`}
                data-active={view === id ? "true" : undefined}
                data-state={view === id ? undefined : "dim"}
              >
                {t(key)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setAdding((value) => !value);
              if (!date) setDate(today);
            }}
            className="ui-action pi-chrome-label pi-bracket ml-2 text-xs"
          >
            {adding ? t("robin.common.cancel") : t("robin.common.add")}
          </button>
        </div>
      </header>

      {adding && (
        <form onSubmit={addEvent} className="flex flex-col gap-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("robin.calendar.eventPlaceholder")}
            autoFocus
            className="rounded px-2 py-1 text-sm outline-none"
            style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
          <div className="flex flex-wrap gap-2">
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="rounded px-2 py-1 text-sm outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
            />
            {/* Inclusive last day; blank means the event is a single day. */}
            <input
              type="date"
              value={endDate}
              min={date || undefined}
              onChange={(event) => setEndDate(event.target.value)}
              title={t("robin.calendar.endDateHint")}
              className="rounded px-2 py-1 text-sm outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
            />
            {/* Blank start means an all-day event. */}
            <input
              type="time"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              className="rounded px-2 py-1 text-sm outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
            />
            <input
              type="time"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              disabled={!start}
              className="rounded px-2 py-1 text-sm outline-none disabled:opacity-40"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
            />
            <button
              type="submit"
              disabled={!title.trim() || !date}
              className="ui-action ui-action--outline pi-bracket px-3 disabled:opacity-40"
              data-state="accent"
            >
              {t("robin.common.save")}
            </button>
          </div>
        </form>
      )}

      {(error || todosError || actionError) && (
        <p className="text-xs" style={{ color: "var(--accent)" }}>{actionError ?? error ?? todosError}</p>
      )}

      {today && view === "agenda" && (
        <AgendaView
          events={visible}
          todos={visibleTodos}
          today={today}
          onSelectEvent={setSelectedEvent}
          onCompleteTodo={completeTodo}
        />
      )}
      {today && view === "week" && (
        <WeekGrid
          events={visible}
          today={today}
          anchor={activeAnchor}
          onSelectEvent={setSelectedEvent}
        />
      )}
      {today && view === "month" && (
        <MonthView
          events={visible}
          today={today}
          days={weeksFrom(activeAnchor, MONTH_WEEKS)}
          onSelectDay={(day) => {
            setAnchor(day);
            chooseView("week");
          }}
          onSelectEvent={setSelectedEvent}
        />
      )}

      <GoogleConnect status={data?.google} onChanged={refresh} />

      {selectedEvent && (
        <EventDetailsDialog
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onDelete={deleteEvent}
        />
      )}
    </section>
  );
}
