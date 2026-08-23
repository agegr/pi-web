"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { parseLocalDate, weekDays } from "@/extension/robin/dates";
import {
  formatEventTime,
  occursOn,
  type DashboardEvent,
} from "@/extension/robin/events";
import {
  layoutDayEvents,
  layoutSpanBars,
  MINUTES_PER_DAY,
  toMinutes,
} from "@/extension/robin/layout";
import { spanSurface, timedSurface } from "./eventSurface";
import { useTodayInView } from "./useTodayInView";

/** Tall enough that a 30-minute block still fits its title. */
const HOUR_HEIGHT = 44;
const PX_PER_MINUTE = HOUR_HEIGHT / 60;
const TIME_GUTTER = "3.5rem";
/** The window shown when the week is empty — a normal waking day. */
const DEFAULT_FIRST_HOUR = 7;
const DEFAULT_LAST_HOUR = 22;

/**
 * The hours worth drawing.
 *
 * The grid renders only this range instead of all 24 hours inside its own
 * scroller. A tall inner scroller sitting in the middle of a scrolling page
 * swallows the wheel: the pointer lands on the grid, the grid consumes the
 * gesture, and the page underneath never moves. Sizing the grid to its content
 * removes the second scroller entirely — and the range always widens to cover
 * every event, so nothing is ever hidden by the trim.
 */
function visibleHourRange(events: DashboardEvent[]): { first: number; last: number } {
  let first = DEFAULT_FIRST_HOUR;
  let last = DEFAULT_LAST_HOUR;
  for (const event of events) {
    if (!event.start) continue;
    first = Math.min(first, Math.floor(toMinutes(event.start) / 60));
    const endMinutes = event.end ? toMinutes(event.end) : toMinutes(event.start) + 60;
    last = Math.max(last, Math.min(23, Math.ceil(endMinutes / 60)));
  }
  return { first: Math.max(0, first), last: Math.min(23, last) };
}

function weekdayLabel(date: string, locale: string): string {
  return parseLocalDate(date).toLocaleDateString(locale, { weekday: "short" });
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
  onSelectEvent,
}: {
  events: DashboardEvent[];
  today: string;
  anchor: string;
  onSelectEvent: (event: DashboardEvent) => void;
}) {
  const { t, locale } = useI18n();
  const days = weekDays(anchor);
  const scrollerRef = useTodayInView(anchor, today);
  const { bars, lanes } = layoutSpanBars(events, days);
  const nowMinutes = useNowMinutes();

  const { first: firstHour, last: lastHour } = visibleHourRange(events);
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => firstHour + index);
  /** Minutes are measured from the top of the grid, not from midnight. */
  const gridOffsetMinutes = firstHour * 60;
  const gridHeight = hours.length * HOUR_HEIGHT;

  return (
    <div className="overflow-x-auto" ref={scrollerRef}>
      <div className="min-w-[44rem]">
        {/* Day headings */}
        <div
          className="grid gap-px border-b"
          style={{
            gridTemplateColumns: `${TIME_GUTTER} repeat(7, minmax(0, 1fr))`,
            borderColor: "var(--border)",
          }}
        >
          <div />
          {days.map((date) => {
            const isToday = date === today;
            return (
              // Weekday and number stay adjacent; spread apart they read as
              // belonging to the neighbouring column.
              <div
                key={date}
                className="flex items-baseline gap-1.5 px-1 pb-1.5"
                // Today is marked by the rule under its heading as well as by
                // the solid date, so it survives a glance and a greyscale screen.
                style={isToday ? { boxShadow: "inset 0 -2px 0 var(--today-mark)" } : undefined}
              >
                <span
                  className="pi-eyebrow"
                  style={isToday ? { color: "var(--text)" } : undefined}
                >
                  {weekdayLabel(date, locale)}
                </span>
                {isToday ? (
                  <span className="pi-today-badge">{parseLocalDate(date).getDate()}</span>
                ) : (
                  <span className="font-mono text-sm tabular-nums" style={{ color: "var(--text)" }}>
                    {parseLocalDate(date).getDate()}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* All-day / multi-day band */}
        {lanes > 0 && (
          <div
            className="grid gap-px border-y py-1 font-mono"
            style={{
              gridTemplateColumns: `${TIME_GUTTER} repeat(7, minmax(0, 1fr))`,
              borderColor: "var(--border)",
            }}
          >
            <div className="pi-meta pr-1 text-right" style={{ color: "var(--text-dim)" }}>{t("robin.calendar.allDay")}</div>
            <div className="relative col-span-7" style={{ height: lanes * 22 }}>
              <div className="absolute inset-0 grid grid-cols-7 gap-px">
                {days.map((date) => (
                  <div key={date} style={{ background: date === today ? "var(--today-wash)" : "transparent" }} />
                ))}
              </div>
              {bars.map((bar) => (
                <button
                  key={bar.event.id}
                  type="button"
                  onClick={() => onSelectEvent(bar.event)}
                  aria-haspopup="dialog"
                  title={`${bar.event.title}${bar.event.calendar ? ` — ${bar.event.calendar}` : ""}`}
                  className="absolute truncate px-1.5 text-left leading-5"
                  style={{
                    left: `calc(${(bar.startIndex / 7) * 100}% + 1px)`,
                    width: `calc(${((bar.endIndex - bar.startIndex + 1) / 7) * 100}% - 2px)`,
                    top: bar.lane * 22,
                    height: 20,
                    ...spanSurface(bar.event),
                    color: "var(--text)",
                    borderRadius: 0,
                    fontFamily: "var(--font-serif)",
                    fontSize: 13,
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

        {/* Time grid — sized to its content, so the page keeps the only scrollbar. */}
        <div className="relative">
          <div
            className="grid gap-px"
            style={{ gridTemplateColumns: `${TIME_GUTTER} repeat(7, minmax(0, 1fr))` }}
          >
            {/* Hour gutter */}
            <div className="font-mono">
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="relative pr-1 text-right tabular-nums"
                  style={{ height: HOUR_HEIGHT, color: "var(--text-muted)", fontSize: 11 }}
                >
                  {/* Under the rule rather than straddling it: the label then
                      reads as naming the band below it, and the first hour is
                      no longer the one row without a time on it. */}
                  <span className="absolute right-1 top-0.5">
                    {`${String(hour).padStart(2, "0")}:00`}
                  </span>
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
                  data-date={date}
                  className="relative"
                  style={{
                    height: gridHeight,
                    // A hue of its own, so it separates from the accent-tinted
                    // blocks laid on top of it.
                    background: isToday ? "var(--today-wash)" : "transparent",
                  }}
                >
                  {hours.map((hour) => (
                    <div
                      key={hour}
                      className="absolute inset-x-0 border-t"
                      style={{
                        top: (hour - firstHour) * HOUR_HEIGHT,
                        borderColor: "var(--border)",
                        opacity: 0.5,
                      }}
                    />
                  ))}

                  {isToday && nowMinutes >= gridOffsetMinutes && nowMinutes < MINUTES_PER_DAY && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-10"
                      style={{
                        top: (nowMinutes - gridOffsetMinutes) * PX_PER_MINUTE,
                        borderTop: "2px solid var(--today-mark)",
                      }}
                      aria-hidden
                    />
                  )}

                  {placed.map(({ event, startMinutes, endMinutes, column, columns }) => {
                    const height = Math.max((endMinutes - startMinutes) * PX_PER_MINUTE - 2, 16);
                    // A half-hour block is 22px: two lines do not fit in it, and
                    // the clipped second line is what made short events unreadable.
                    // Below two lines' worth the time is dropped — the block's own
                    // position and the tooltip both still carry it.
                    const showTime = height >= 34;
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => onSelectEvent(event)}
                        aria-haspopup="dialog"
                        title={`${formatEventTime(event)} ${event.title}${event.location ? ` @ ${event.location}` : ""}`}
                        // A button centres its content vertically, so a long
                        // block floated its title in the middle of itself
                        // rather than putting it at the time it starts.
                        className="absolute flex flex-col items-start overflow-hidden px-1.5 py-px text-left"
                        style={{
                          top: (startMinutes - gridOffsetMinutes) * PX_PER_MINUTE,
                          height,
                          left: `calc(${(column / columns) * 100}% + 1px)`,
                          width: `calc(${(1 / columns) * 100}% - 2px)`,
                          ...timedSurface(event),
                          color: "var(--text)",
                          // The title is what someone reads; the clock is data.
                          fontFamily: "var(--font-serif)",
                        }}
                      >
                        <span className="block truncate" style={{ fontSize: 13, lineHeight: 1.3 }}>
                          {event.title}
                        </span>
                        {showTime && (
                          <span
                            className="block truncate tabular-nums"
                            style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}
                          >
                            {formatEventTime(event)}
                          </span>
                        )}
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
