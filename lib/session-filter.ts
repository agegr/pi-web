/**
 * The session list's filter: a status and a time window, combined with AND.
 * The tree builds its rows from the families that match, so pinned section,
 * groups, their counts and "show more" all follow one decision.
 */
import type { SessionFamily } from "./session-family";

export type SessionStatusFilter = "all" | "running" | "failed";
export type SessionTimeFilter = "all" | "today" | "week" | "month";

export interface SessionFilter {
  status: SessionStatusFilter;
  time: SessionTimeFilter;
}

/** Nothing hidden: the list as it always was. */
export const NO_SESSION_FILTER: SessionFilter = { status: "all", time: "all" };

export const SESSION_STATUS_FILTERS: readonly SessionStatusFilter[] = ["all", "running", "failed"];
export const SESSION_TIME_FILTERS: readonly SessionTimeFilter[] = ["all", "today", "week", "month"];

export function isSessionFilterActive(filter: SessionFilter): boolean {
  return filter.status !== "all" || filter.time !== "all";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The earliest activity the window keeps, ms. "Today" is the local calendar
 * day, so the list matches the clock beside it; the other windows are rolling.
 */
export function sessionFilterCutoff(time: SessionTimeFilter, now: number): number | null {
  if (time === "all") return null;
  if (time === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  return now - (time === "week" ? 7 : 30) * DAY_MS;
}

export interface SessionFilterContext {
  /** Now, ms: the time windows are measured from here. */
  now: number;
  runningIds: ReadonlySet<string>;
}

/**
 * A family shows when its last activity is inside the window and, for a
 * status, its root matches: the row is the root chat, so a long-finished
 * subagent's failure does not keep its parent under "Failed". Running is the
 * family's, like the row's own spinner: a running subagent keeps it alive.
 */
export function familyMatchesSessionFilter(
  family: Pick<SessionFamily, "root" | "subagents" | "latestModified">,
  filter: SessionFilter,
  context: SessionFilterContext,
): boolean {
  if (isSessionFilterActive(filter) && !matchesStatus(family, filter.status, context.runningIds)) return false;
  const cutoff = sessionFilterCutoff(filter.time, context.now);
  if (cutoff === null) return true;
  const modified = Date.parse(family.latestModified);
  return Number.isFinite(modified) && modified >= cutoff;
}

function matchesStatus(
  family: Pick<SessionFamily, "root" | "subagents">,
  status: SessionStatusFilter,
  runningIds: ReadonlySet<string>,
): boolean {
  if (status === "all") return true;
  if (status === "running") {
    return runningIds.has(family.root.id) || family.subagents.some((session) => runningIds.has(session.id));
  }
  return family.root.lastReplyFailed === true;
}

/** How a filtered-out session shows nowhere else: the list's own count. */
export function countHiddenFamilies(
  families: readonly Pick<SessionFamily, "root" | "subagents" | "latestModified">[],
  filter: SessionFilter,
  context: SessionFilterContext,
): number {
  if (!isSessionFilterActive(filter)) return 0;
  return families.reduce(
    (hidden, family) => hidden + (familyMatchesSessionFilter(family, filter, context) ? 0 : 1),
    0,
  );
}
