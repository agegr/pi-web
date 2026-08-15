/**
 * Calendar layout maths. Pure — no node builtins, no DOM.
 *
 * Two problems live here, both of which are easy to get subtly wrong and so are
 * kept out of the components and tested directly:
 *
 * 1. Overlapping timed events on one day, which must share the day's width.
 * 2. Multi-day events on a week row, which must stack into lanes without
 *    colliding, clipped to the week.
 */
import { eventEndDate, isAllDayBand, type CalendarEvent } from "./events.ts";

export const MINUTES_PER_DAY = 24 * 60;

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function fromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(minutes, MINUTES_PER_DAY));
  const hours = Math.floor(clamped / 60);
  return `${String(hours).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

export interface PositionedEvent<T> {
  event: T;
  startMinutes: number;
  endMinutes: number;
  /** Zero-based column within the overlapping cluster. */
  column: number;
  /** How many columns the cluster needs — the divisor for the width. */
  columns: number;
}

/** Below this, a block is too short to show its own title. */
export const MIN_EVENT_MINUTES = 30;

/**
 * Place one day's timed events, giving overlapping ones side-by-side columns.
 *
 * Events are grouped into clusters of transitively-overlapping events; within a
 * cluster each event takes the first column free at its start time, and every
 * event in the cluster is divided by the same column count so their edges line
 * up. Zero-length and past-midnight ends are clamped so nothing renders
 * inverted or invisible.
 */
export function layoutDayEvents<T extends CalendarEvent>(events: T[]): PositionedEvent<T>[] {
  const timed = events
    .filter((event) => !isAllDayBand(event))
    .map((event) => {
      const startMinutes = Math.min(toMinutes(event.start as string), MINUTES_PER_DAY);
      const rawEnd = event.end ? toMinutes(event.end) : startMinutes + MIN_EVENT_MINUTES;
      return {
        event,
        startMinutes,
        endMinutes: Math.min(Math.max(rawEnd, startMinutes + MIN_EVENT_MINUTES), MINUTES_PER_DAY),
      };
    })
    .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);

  const placed: PositionedEvent<T>[] = [];
  let cluster: typeof timed = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const columnEnds: number[] = [];
    const withColumns = cluster.map((item) => {
      let column = columnEnds.findIndex((end) => end <= item.startMinutes);
      if (column === -1) column = columnEnds.length;
      columnEnds[column] = item.endMinutes;
      return { ...item, column };
    });
    for (const item of withColumns) placed.push({ ...item, columns: columnEnds.length });
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of timed) {
    // A new cluster starts once an event begins at or after everything before it ends.
    if (cluster.length > 0 && item.startMinutes >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinutes);
  }
  flush();
  return placed;
}

export interface SpanBar<T> {
  event: T;
  /** Index into the supplied days array, clipped to the week. */
  startIndex: number;
  endIndex: number;
  /** True when the event actually begins/ends outside this week. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  lane: number;
}

/**
 * Stack all-day and multi-day events into lanes across a row of days.
 *
 * Longer events are placed first so a week-long bar takes the top lane and
 * shorter ones tuck underneath, which is what makes the row readable. Bars are
 * clipped to the row and flagged where they continue, so the component can
 * square off the cut edges.
 */
export function layoutSpanBars<T extends CalendarEvent>(
  events: T[],
  days: string[],
): { bars: SpanBar<T>[]; lanes: number } {
  if (days.length === 0) return { bars: [], lanes: 0 };
  const first = days[0] as string;
  const last = days[days.length - 1] as string;

  const candidates = events
    .filter(isAllDayBand)
    .filter((event) => event.date <= last && eventEndDate(event) >= first)
    .map((event) => {
      const startsAt = event.date;
      const endsAt = eventEndDate(event);
      const startIndex = Math.max(0, days.indexOf(startsAt < first ? first : startsAt));
      const endRaw = endsAt > last ? last : endsAt;
      const endIndex = days.indexOf(endRaw);
      return {
        event,
        startIndex,
        endIndex: endIndex === -1 ? days.length - 1 : endIndex,
        continuesBefore: startsAt < first,
        continuesAfter: endsAt > last,
      };
    })
    .sort((a, b) => {
      const spanA = a.endIndex - a.startIndex;
      const spanB = b.endIndex - b.startIndex;
      if (spanA !== spanB) return spanB - spanA; // longest first
      if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
      return a.event.title.localeCompare(b.event.title);
    });

  // Occupancy is tracked as intervals, not just each lane's furthest right
  // edge: placing the longest bar first would otherwise block the empty space
  // to its left and push short bars into needless extra lanes.
  const laneIntervals: { start: number; end: number }[][] = [];
  const bars = candidates.map((candidate) => {
    let lane = laneIntervals.findIndex((intervals) => intervals.every(
      (interval) => interval.end < candidate.startIndex || interval.start > candidate.endIndex,
    ));
    if (lane === -1) {
      lane = laneIntervals.length;
      laneIntervals.push([]);
    }
    (laneIntervals[lane] as { start: number; end: number }[]).push({
      start: candidate.startIndex,
      end: candidate.endIndex,
    });
    return { ...candidate, lane };
  });

  return { bars, lanes: laneIntervals.length };
}
