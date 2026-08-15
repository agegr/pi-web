"use client";

import { useEffect, useRef, useState } from "react";
import { parseLocalDate, weekDays } from "@/extension/robin/dates";
import {
  formatEventTime,
  isReadOnlyEvent,
  occursOn,
  type DashboardEvent,
} from "@/extension/robin/events";
import {
  layoutDayEvents,
  layoutSpanBars,
  MINUTES_PER_DAY,
  toMinutes,
} from "@/extension/robin/layout";

/** Tall enough that a 30-minute block still fits its title. */
const HOUR_HEIGHT = 44;
const PX_PER_MINUTE = HOUR_HEIGHT / 60;
const TIME_GUTTER = "3.5rem";
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
/** Where the grid is scrolled on open — early enough to catch a 7am start. */
const INITIAL_SCROLL_HOUR = 7;

function weekdayLabel(date: string): string {
  return parseLocalDate(date).toLocaleDateString(undefined, { weekday: "short" });
}

function useNowMinutes(): number {
  const [minutes, setMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => clearInterval(timer);
  }, []);
  return minutes;
}

export function WeekGrid({
  events,
  today,
  anchor,
  onDelete,
}: {
  events: DashboardEvent[];
  today: string;
  anchor: string;
  onDelete: (event: DashboardEvent) => void;
}) {
  const days = weekDays(anchor);
  const { bars, lanes } = layoutSpanBars(events, days);
  const nowMinutes = useNowMinutes();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);

  // Scroll to the working day once per week shown, not on every re-render —
  // otherwise the poll would yank the view back while the user is scrolling.
  useEffect(() => {
    if (scrolledFor.current === anchor) return;
    scrolledFor.current = anchor;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const earliest = events.reduce<number | null>((lowest, event) => {
      if (!event.start) return lowest;
      const minutes = toMinutes(event.start);
      return lowest === null || minutes < lowest ? minutes : lowest;
    }, null);
    const target = Math.min(earliest ?? INITIAL_SCROLL_HOUR * 60, INITIAL_SCROLL_HOUR * 60);
    scroller.scrollTop = Math.max(0, target * PX_PER_MINUTE - HOUR_HEIGHT / 2);
  }, [anchor, events]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[44rem]">
        {/* Day headings */}
        <div
          className="grid gap-px"
          style={{ gridTemplateColumns: `${TIME_GUTTER} repeat(7, minmax(0, 1fr))` }}
        >
          <div />
          {days.map((date) => {
            const isToday = date === today;
            return (
              // Weekday and number stay adjacent; spread apart they read as
              // belonging to the neighbouring column.
              <div key={date} className="flex items-baseline gap-1 px-1 pb-1">
                <span className="text-xs" style={{ color: "var(--text-dim)" }}>{weekdayLabel(date)}</span>
                <span
                  className="text-xs font-medium tabular-nums"
                  style={{ color: isToday ? "var(--accent)" : "var(--text-muted)" }}
                >
                  {parseLocalDate(date).getDate()}
                </span>
              </div>
            );
          })}
        </div>

        {/* All-day / multi-day band */}
        {lanes > 0 && (
          <div
            className="grid gap-px border-y py-1"
            style={{
              gridTemplateColumns: `${TIME_GUTTER} repeat(7, minmax(0, 1fr))`,
              borderColor: "var(--border)",
            }}
          >
            <div className="pr-1 text-right text-xs" style={{ color: "var(--text-dim)" }}>all-day</div>
            <div className="relative col-span-7" style={{ height: lanes * 22 }}>
              <div className="absolute inset-0 grid grid-cols-7 gap-px">
                {days.map((date) => (
                  <div key={date} style={{ background: date === today ? "var(--bg-subtle)" : "transparent" }} />
                ))}
              </div>
              {bars.map((bar) => (
                <button
                  key={bar.event.id}
                  type="button"
                  onClick={() => !isReadOnlyEvent(bar.event) && onDelete(bar.event)}
                  title={`${bar.event.title}${bar.event.calendar ? ` — ${bar.event.calendar}` : ""}`}
                  className="absolute truncate px-1.5 text-left text-xs leading-5"
                  style={{
                    left: `calc(${(bar.startIndex / 7) * 100}% + 1px)`,
                    width: `calc(${((bar.endIndex - bar.startIndex + 1) / 7) * 100}% - 2px)`,
                    top: bar.lane * 22,
                    height: 20,
                    background: isReadOnlyEvent(bar.event) ? "var(--bg-selected)" : "var(--accent)",
                    color: isReadOnlyEvent(bar.event) ? "var(--text)" : "#fff",
                    // Square off the edge that runs past this week.
                    borderRadius: `${bar.continuesBefore ? 0 : 4}px ${bar.continuesAfter ? 0 : 4}px ${bar.continuesAfter ? 0 : 4}px ${bar.continuesBefore ? 0 : 4}px`,
                    opacity: 0.9,
                  }}
                >
                  {bar.continuesBefore && "‹ "}
                  {bar.event.title}
                  {bar.continuesAfter && " ›"}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Time grid */}
        <div ref={scrollerRef} className="relative max-h-[32rem] overflow-y-auto">
          <div
            className="grid gap-px"
            style={{ gridTemplateColumns: `${TIME_GUTTER} repeat(7, minmax(0, 1fr))` }}
          >
            {/* Hour gutter */}
            <div>
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="relative pr-1 text-right text-xs tabular-nums"
                  style={{ height: HOUR_HEIGHT, color: "var(--text-dim)" }}
                >
                  <span className="absolute right-1 -top-1.5">{hour === 0 ? "" : `${String(hour).padStart(2, "0")}:00`}</span>
                </div>
              ))}
            </div>

            {days.map((date) => {
              const dayEvents = events.filter((event) => occursOn(event, date));
              const placed = layoutDayEvents(dayEvents);
              const isToday = date === today;
              return (
                <div
                  key={date}
                  className="relative"
                  style={{
                    height: HOURS.length * HOUR_HEIGHT,
                    background: isToday ? "var(--bg-subtle)" : "transparent",
                  }}
                >
                  {HOURS.map((hour) => (
                    <div
                      key={hour}
                      className="absolute inset-x-0 border-t"
                      style={{ top: hour * HOUR_HEIGHT, borderColor: "var(--border)", opacity: 0.5 }}
                    />
                  ))}

                  {isToday && nowMinutes < MINUTES_PER_DAY && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-10"
                      style={{ top: nowMinutes * PX_PER_MINUTE, borderTop: "2px solid var(--accent)" }}
                      aria-hidden
                    />
                  )}

                  {placed.map(({ event, startMinutes, endMinutes, column, columns }) => {
                    const readOnly = isReadOnlyEvent(event);
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => !readOnly && onDelete(event)}
                        title={`${formatEventTime(event)} ${event.title}${event.location ? ` @ ${event.location}` : ""}`}
                        className="absolute overflow-hidden rounded px-1 text-left text-xs leading-tight"
                        style={{
                          top: startMinutes * PX_PER_MINUTE,
                          height: Math.max((endMinutes - startMinutes) * PX_PER_MINUTE - 2, 14),
                          left: `calc(${(column / columns) * 100}% + 1px)`,
                          width: `calc(${(1 / columns) * 100}% - 2px)`,
                          background: readOnly ? "var(--bg-selected)" : "var(--accent)",
                          color: readOnly ? "var(--text)" : "#fff",
                          borderLeft: readOnly ? "2px solid var(--text-dim)" : "none",
                        }}
                      >
                        <span className="block truncate font-medium">{event.title}</span>
                        <span className="block truncate opacity-80">{formatEventTime(event)}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
