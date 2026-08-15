"use client";

import { isSameMonth, monthGrid, parseLocalDate } from "@/extension/robin/dates";
import {
  compareEvents,
  eventEndDate,
  formatEventDay,
  formatEventTime,
  groupEventsByDate,
  isAllDayBand,
  isReadOnlyEvent,
  type DashboardEvent,
} from "@/extension/robin/events";
import { layoutSpanBars } from "@/extension/robin/layout";

export type CalendarView = "agenda" | "week" | "month";

interface ViewProps {
  events: DashboardEvent[];
  today: string;
  onDelete: (event: DashboardEvent) => void;
}

/** Grids are laid out for a wide viewport; narrow screens scroll rather than crush. */
const GRID_SCROLL = "overflow-x-auto";
const GRID_MIN_WIDTH = "min-w-[42rem]";

function dayNumber(date: string): string {
  return String(parseLocalDate(date).getDate());
}

function weekdayLabel(date: string): string {
  return parseLocalDate(date).toLocaleDateString(undefined, { weekday: "short" });
}

/** Google entries carry a dot; they cannot be edited from here. */
function EventChip({ event, onDelete }: { event: DashboardEvent; onDelete?: () => void }) {
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
        {event.start ?? "all-day"}
      </span>
      <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text)" }}>{event.title}</span>
      {onDelete && !readOnly && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${event.title}`}
          className="shrink-0 opacity-0 transition-opacity group-hover/chip:opacity-100"
          style={{ color: "var(--text-dim)" }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function AgendaView({ events, today, onDelete }: ViewProps) {
  const grouped = groupEventsByDate(events);
  // Today always gets a row, even when empty: on a daily dashboard "nothing on
  // today" is itself the answer, and omitting the day reads as a load failure.
  const days = grouped.some((group) => group.date === today)
    ? grouped
    : [{ date: today, events: [] as DashboardEvent[] }, ...grouped];

  return (
    <div className="flex flex-col gap-3">
      {days.map(({ date, events: dayEvents }) => (
        <div key={date} className="flex flex-col gap-1">
          <h3
            className="text-xs font-medium uppercase tracking-wide"
            style={{ color: date === today ? "var(--accent)" : "var(--text-dim)" }}
          >
            {formatEventDay(date, today)}
          </h3>
          {dayEvents.length === 0 && (
            <p className="px-2 py-1 text-sm" style={{ color: "var(--text-dim)" }}>Nothing scheduled.</p>
          )}
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
                  aria-label={`Delete ${event.title}`}
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
    </div>
  );
}

const MONTH_CHIP_LIMIT = 2;
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
  anchor,
  onSelectDay,
}: {
  days: string[];
  events: DashboardEvent[];
  today: string;
  anchor: string;
  onSelectDay: (date: string) => void;
}) {
  const { bars, lanes } = layoutSpanBars(events, days);
  const barsHeight = lanes * BAR_HEIGHT;

  return (
    <div className="relative">
      <div className="grid grid-cols-7 gap-px">
        {days.map((date) => {
          const chips = events
            .filter((event) => !isAllDayBand(event) && event.date === date)
            .sort(compareEvents);
          const spanning = events.filter((event) => isAllDayBand(event)
            && date >= event.date && date <= eventEndDate(event)).length;
          const isToday = date === today;
          const outside = !isSameMonth(date, anchor);
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelectDay(date)}
              title={`${date} — ${chips.length + spanning} event(s)`}
              className="flex min-h-24 flex-col gap-0.5 rounded p-1 text-left"
              style={{
                background: isToday ? "var(--bg-hover)" : "transparent",
                border: `1px solid ${isToday ? "var(--accent)" : "var(--border)"}`,
                opacity: outside ? 0.45 : 1,
                paddingTop: DAY_NUMBER_HEIGHT + barsHeight + 2,
              }}
            >
              {chips.slice(0, MONTH_CHIP_LIMIT).map((event) => (
                <EventChip key={event.id} event={event} />
              ))}
              {chips.length > MONTH_CHIP_LIMIT && (
                <span className="px-1 text-xs" style={{ color: "var(--text-dim)" }}>
                  +{chips.length - MONTH_CHIP_LIMIT} more
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
              opacity: isSameMonth(date, anchor) ? 1 : 0.45,
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
  anchor,
  onSelectDay,
}: Omit<ViewProps, "onDelete"> & { anchor: string; onSelectDay: (date: string) => void }) {
  const grid = monthGrid(anchor);
  const weeks = Array.from(
    { length: grid.length / 7 },
    (_, index) => grid.slice(index * 7, index * 7 + 7),
  );

  return (
    <div className={GRID_SCROLL}>
      <div className={`flex flex-col gap-px ${GRID_MIN_WIDTH}`}>
        <div className="grid grid-cols-7 gap-px">
          {(weeks[0] ?? []).map((date) => (
            <div key={date} className="px-1 text-xs" style={{ color: "var(--text-dim)" }}>
              {weekdayLabel(date)}
            </div>
          ))}
        </div>
        {weeks.map((days) => (
          <MonthWeekRow
            key={days[0]}
            days={days}
            events={events}
            today={today}
            anchor={anchor}
            onSelectDay={onSelectDay}
          />
        ))}
      </div>
    </div>
  );
}
