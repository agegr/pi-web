"use client";

import { useI18n } from "@/hooks/useI18n";
import { groupAgendaItems } from "@/extension/robin/agenda";
import { parseLocalDate, addDays } from "@/extension/robin/dates";
import {
  compareEvents,
  eventEndDate,
  formatEventTime,
  isAllDayBand,
  isReadOnlyEvent,
  type DashboardEvent,
} from "@/extension/robin/events";
import { layoutSpanBars } from "@/extension/robin/layout";
import type { Todo } from "@/extension/robin/store";
import { useTodayInView } from "./useTodayInView";

export type CalendarView = "agenda" | "week" | "month";

interface ViewProps {
  events: DashboardEvent[];
  today: string;
  onDelete: (event: DashboardEvent) => void;
}

interface AgendaViewProps extends ViewProps {
  todos: Todo[];
  onCompleteTodo: (todo: Todo) => void;
}

/** Grids are laid out for a wide viewport; narrow screens scroll rather than crush. */
const GRID_SCROLL = "overflow-x-auto";
const GRID_MIN_WIDTH = "min-w-[42rem]";

/** Relative day headings, translated here rather than in the shared module
 *  that the English-only agent tools also use. */
function dayHeading(date: string, today: string, locale: string, t: (key: string) => string): string {
  if (date === today) return t("robin.calendar.relativeToday");
  if (date === addDays(today, 1)) return t("robin.calendar.relativeTomorrow");
  // Anything further out reads better as a weekday than as an ISO string.
  return parseLocalDate(date).toLocaleDateString(locale, { weekday: "long", month: "short", day: "numeric" });
}

function dayNumber(date: string): string {
  return String(parseLocalDate(date).getDate());
}

function weekdayLabel(date: string, locale: string): string {
  return parseLocalDate(date).toLocaleDateString(locale, { weekday: "short" });
}

/** Google entries carry a dot; they cannot be edited from here. */
function EventChip({ event, onDelete, t }: {
  event: DashboardEvent;
  onDelete?: () => void;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const readOnly = isReadOnlyEvent(event);
  return (
    <div
      className="group/chip flex items-baseline gap-1.5 rounded px-1.5 py-0.5 text-xs"
      style={{ background: "var(--bg-subtle)" }}
      title={`${formatEventTime(event)} ${event.title}${event.calendar ? ` — ${event.calendar}` : ""}`}
    >
      {readOnly && (
        <span aria-hidden className="shrink-0" style={{ color: "var(--text-dim)" }}>•</span>
      )}
      <span className="shrink-0 tabular-nums" style={{ color: "var(--text-dim)" }}>
        {event.start ?? t("robin.calendar.allDay")}
      </span>
      <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text)" }}>{event.title}</span>
      {onDelete && !readOnly && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={t("robin.calendar.deleteEvent", { title: event.title })}
          className="shrink-0 opacity-0 transition-opacity group-hover/chip:opacity-100"
          style={{ color: "var(--text-dim)" }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** Days shown in full; the rest of the window collapses to one line each. */
const AGENDA_DETAIL_DAYS = 3;

export function AgendaView({
  events,
  todos,
  today,
  onDelete,
  onCompleteTodo,
}: AgendaViewProps) {
  const { t, locale } = useI18n();
  const grouped = groupAgendaItems(events, todos);
  // Today always gets a row, even when empty: on a daily dashboard "nothing on
  // today" is itself the answer, and omitting the day reads as a load failure.
  const withToday = grouped.some((group) => group.date === today)
    ? grouped
    : [{ date: today, events: [] as DashboardEvent[], todos: [] as Todo[] }, ...grouped];

  // Detail only covers the days you can still act on. Everything further out
  // becomes a one-line-per-day brief: enough to notice a busy Thursday without
  // reading the whole week.
  const detailUntil = addDays(today, AGENDA_DETAIL_DAYS - 1);
  const days = withToday.filter((group) => group.date <= detailUntil);
  const rest = withToday.filter((group) => group.date > detailUntil
    && group.events.length + group.todos.length > 0);

  return (
    <div className="flex flex-col gap-3">
      {days.map(({ date, events: dayEvents, todos: dayTodos }) => (
        <div key={date} className="flex flex-col gap-1">
          <h3
            className="text-xs font-medium uppercase tracking-wide"
            style={{ color: date === today ? "var(--accent)" : "var(--text-dim)" }}
          >
            {dayHeading(date, today, locale, t)}
          </h3>
          {dayEvents.length + dayTodos.length === 0 && (
            <p className="px-2 py-1 text-sm" style={{ color: "var(--text-dim)" }}>{t("robin.calendar.nothingScheduled")}</p>
          )}
          {dayTodos.map((todo) => (
            <label
              key={`todo:${todo.id}`}
              className="flex min-h-8 cursor-pointer items-center gap-3 rounded px-2 py-1"
              style={{ background: "var(--bg-subtle)" }}
            >
              <span
                className="shrink-0 text-xs"
                style={{ color: "var(--text-muted)", minWidth: "5.5rem" }}
              >
                {t("robin.todos.title")}
              </span>
              <input
                type="checkbox"
                checked={todo.done}
                onChange={() => onCompleteTodo(todo)}
                aria-label={t("robin.todos.complete", { title: todo.title })}
                className="shrink-0 cursor-pointer"
              />
              <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text)" }}>
                {todo.title}
              </span>
            </label>
          ))}
          {dayEvents.map((event) => (
            <div
              key={event.id}
              className="group flex items-center gap-3 rounded px-2 py-1"
              style={{ background: "var(--bg-subtle)" }}
            >
              <span
                className="shrink-0 text-xs tabular-nums"
                style={{ color: "var(--text-muted)", minWidth: "5.5rem" }}
              >
                {formatEventTime(event)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text)" }}>
                {event.title}
                {event.location && <span style={{ color: "var(--text-dim)" }}> @ {event.location}</span>}
                {isReadOnlyEvent(event) && (
                  <span style={{ color: "var(--text-dim)" }}> · {event.calendar ?? "Google"}</span>
                )}
              </span>
              {!isReadOnlyEvent(event) && (
                <button
                  type="button"
                  onClick={() => onDelete(event)}
                  aria-label={t("robin.calendar.deleteEvent", { title: event.title })}
                  className="shrink-0 px-1 text-xs opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: "var(--text-dim)" }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      ))}

      {rest.length > 0 && (
        <div className="flex flex-col gap-1 border-t pt-2" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-dim)" }}>
            {t("robin.calendar.restOfWeek")}
          </h3>
          {rest.map(({ date, events: dayEvents, todos: dayTodos }) => (
            <div key={date} className="flex items-baseline gap-2 px-2 py-0.5 text-xs">
              <span className="shrink-0" style={{ color: "var(--text-muted)", minWidth: "4.5rem" }}>
                {parseLocalDate(date).toLocaleDateString(locale, { weekday: "short", day: "numeric" })}
              </span>
              <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-dim)" }}>
                {[
                  ...dayEvents.map((event) => event.title),
                  ...dayTodos.map((todo) => `${t("robin.todos.title")}: ${todo.title}`),
                ].join("、")}
              </span>
              <span className="shrink-0 tabular-nums" style={{ color: "var(--text-dim)" }}>
                {dayEvents.length + dayTodos.length}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const MONTH_CHIP_LIMIT = 4;
const BAR_HEIGHT = 18;
const DAY_NUMBER_HEIGHT = 18;

/**
 * One week of the month grid.
 *
 * Multi-day and all-day events are drawn as bars spanning the row, so a trip
 * reads as one continuous thing rather than as a copy sitting in each day.
 * Timed single-day events stay as chips inside their own cell. The cells
 * reserve `lanes` worth of vertical space so the bars never cover them.
 */
function MonthWeekRow({
  days,
  events,
  today,
  onSelectDay,
  t,
}: {
  days: string[];
  events: DashboardEvent[];
  today: string;
  onSelectDay: (date: string) => void;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const { bars, lanes } = layoutSpanBars(events, days);
  const barsHeight = lanes * BAR_HEIGHT;
  // The window always opens on today's week, but when today falls late in it
  // most of the row is already past — marking the row is what makes "this is
  // your current week" readable at a glance.
  const isCurrentWeek = days.length > 0 && (days[0] as string) <= today
    && today <= (days[days.length - 1] as string);

  return (
    <div
      className="relative"
      style={isCurrentWeek
        ? { borderLeft: "2px solid var(--accent)", paddingLeft: 4, marginLeft: -6 }
        : { paddingLeft: 4, marginLeft: -6 }}
    >
      <div className="grid grid-cols-7 gap-px">
        {days.map((date) => {
          const chips = events
            .filter((event) => !isAllDayBand(event) && event.date === date)
            .sort(compareEvents);
          const spanning = events.filter((event) => isAllDayBand(event)
            && date >= event.date && date <= eventEndDate(event)).length;
          const isToday = date === today;
          // A rolling window has no "outside the month"; what is worth dimming
          // is the part of the week already behind you.
          const past = date < today;
          return (
            <button
              key={date}
              type="button"
              data-date={date}
              onClick={() => onSelectDay(date)}
              title={t("robin.calendar.dayTooltip", { date, count: String(chips.length + spanning) })}
              className="flex min-h-32 flex-col gap-0.5 rounded p-1 text-left"
              style={{
                background: isToday ? "var(--bg-hover)" : "transparent",
                border: `1px solid ${isToday ? "var(--accent)" : "var(--border)"}`,
                opacity: past ? 0.5 : 1,
                paddingTop: DAY_NUMBER_HEIGHT + barsHeight + 2,
              }}
            >
              {chips.slice(0, MONTH_CHIP_LIMIT).map((event) => (
                <EventChip key={event.id} event={event} t={t} />
              ))}
              {chips.length > MONTH_CHIP_LIMIT && (
                <span className="px-1 text-xs" style={{ color: "var(--text-dim)" }}>
                  {t("robin.calendar.more", { count: String(chips.length - MONTH_CHIP_LIMIT) })}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Day numbers sit above the bars, inside each cell's reserved space. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 grid grid-cols-7 gap-px">
        {days.map((date) => (
          <span
            key={date}
            className="px-1.5 pt-1 text-xs tabular-nums"
            style={{
              color: date === today ? "var(--accent)" : "var(--text-muted)",
              opacity: date < today ? 0.5 : 1,
            }}
          >
            {dayNumber(date)}
          </span>
        ))}
      </div>

      {bars.map((bar) => (
        <button
          key={bar.event.id}
          type="button"
          onClick={() => onSelectDay(bar.event.date)}
          title={`${bar.event.title}${bar.event.calendar ? ` — ${bar.event.calendar}` : ""}`}
          className="absolute truncate px-1.5 text-left text-xs leading-4"
          style={{
            left: `calc(${(bar.startIndex / 7) * 100}% + 2px)`,
            width: `calc(${((bar.endIndex - bar.startIndex + 1) / 7) * 100}% - 4px)`,
            top: DAY_NUMBER_HEIGHT + bar.lane * BAR_HEIGHT + 2,
            height: BAR_HEIGHT - 2,
            background: isReadOnlyEvent(bar.event) ? "var(--bg-selected)" : "var(--accent)",
            color: isReadOnlyEvent(bar.event) ? "var(--text)" : "#fff",
            // Square off whichever edge runs past this week.
            borderRadius: `${bar.continuesBefore ? 0 : 4}px ${bar.continuesAfter ? 0 : 4}px ${bar.continuesAfter ? 0 : 4}px ${bar.continuesBefore ? 0 : 4}px`,
          }}
        >
          {bar.continuesBefore && "‹ "}
          {bar.event.title}
          {bar.continuesAfter && " ›"}
        </button>
      ))}
    </div>
  );
}

export function MonthView({
  events,
  today,
  days: grid,
  onSelectDay,
}: Omit<ViewProps, "onDelete"> & { days: string[]; onSelectDay: (date: string) => void }) {
  const { t, locale } = useI18n();
  const scrollerRef = useTodayInView(grid[0] ?? "", today);
  const weeks = Array.from(
    { length: Math.ceil(grid.length / 7) },
    (_, index) => grid.slice(index * 7, index * 7 + 7),
  );

  return (
    <div className={GRID_SCROLL} ref={scrollerRef}>
      <div className={`flex flex-col gap-px ${GRID_MIN_WIDTH}`}>
        <div className="grid grid-cols-7 gap-px">
          {(weeks[0] ?? []).map((date) => (
            <div key={date} className="px-1 text-xs" style={{ color: "var(--text-dim)" }}>
              {weekdayLabel(date, locale)}
            </div>
          ))}
        </div>
        {weeks.map((days) => (
          <MonthWeekRow
            key={days[0]}
            days={days}
            events={events}
            today={today}
            onSelectDay={onSelectDay}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}
