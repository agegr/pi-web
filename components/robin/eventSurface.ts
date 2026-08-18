import { isReadOnlyEvent, type DashboardEvent } from "@/extension/robin/events";

/**
 * Every coloured surface in the calendar, decided in one place.
 *
 * Events are all one hue — the accent — because `--today-mark` is spent on the
 * current day and `--accent-amber` on todos, and a third event colour would be
 * decoration. **Weight carries the kind of thing**: a band that occupies whole
 * days takes the heavier fill, something that happens at 10:00 the lighter
 * one. **The rule carries ownership**: a calendar you can edit gets the solid
 * accent down its left edge, a subscribed one — Google — gets it held back.
 *
 * Ownership deliberately moves the rule and not the fill: a calendar that is
 * entirely subscribed is the common case once Google is connected, and it must
 * not come out drawn entirely in the palest wash available.
 */
export interface EventSurface {
  background: string;
  borderLeft: string;
}

function ownershipRule(event: DashboardEvent): string {
  return `2px solid ${isReadOnlyEvent(event) ? "var(--accent-line-strong)" : "var(--accent)"}`;
}

/** Something that happens at a time: a chip in the month grid, a block in the week. */
export function timedSurface(event: DashboardEvent): EventSurface {
  return { background: "var(--accent-soft)", borderLeft: ownershipRule(event) };
}

/** Something that spans days: the bars across a month row or the all-day band. */
export function spanSurface(event: DashboardEvent): EventSurface {
  return { background: "var(--accent-fill)", borderLeft: ownershipRule(event) };
}
