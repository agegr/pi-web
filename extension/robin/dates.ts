/**
 * Local-calendar date helpers, shared by the pi extension, the API routes, and
 * the browser.
 *
 * Kept free of node builtins on purpose: the dashboard imports this into client
 * components, and anything touching `node:fs` here would break that bundle.
 *
 * Two kinds of time live in the Robin stores and must never be mixed:
 *
 * - A *local calendar date* (YYYY-MM-DD) — what the user means by "tomorrow".
 *   It has no time and no zone. `Todo.due` is one of these.
 * - An *instant* (UTC ISO) — when something actually happened. `createdAt` and
 *   `completedAt` are these.
 *
 * Comparing a calendar date against `new Date().toISOString().slice(0, 10)` is
 * the bug this split exists to prevent: west of UTC the UTC date flips to
 * tomorrow in the late afternoon, so today's tasks start reading as overdue and
 * tomorrow's as due today. Always derive "today" from `localDate()`.
 */

/** Today (or the date of `at`) as a local YYYY-MM-DD calendar date. */
export function localDate(at: Date = new Date()): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse a local calendar date into a Date at local midnight.
 * `new Date("2026-08-15")` would parse as *UTC* midnight — the component form
 * below is what keeps the date local.
 */
export function parseLocalDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${date}`);
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // Rejects real-looking but impossible dates (2026-02-31 would roll into March).
  if (localDate(parsed) !== date) throw new Error(`Not a valid calendar date: ${date}`);
  return parsed;
}

/** Shift a local calendar date. Rolls over months, years, and DST correctly. */
export function addDays(date: string, days: number): string {
  const shifted = parseLocalDate(date);
  shifted.setDate(shifted.getDate() + days);
  return localDate(shifted);
}

/**
 * Coerce whatever the model or the user supplied into a local calendar date.
 * A full timestamp is resolved in local time, so "2026-08-15T04:00:00Z" sent
 * from a PDT evening lands on 2026-08-14 — the day the user actually meant.
 */
export function normalizeDue(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    parseLocalDate(trimmed);
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Cannot read "${value}" as a date`);
  return localDate(parsed);
}

export type DueBucket = "overdue" | "today" | "tomorrow" | "upcoming" | "none";

/** YYYY-MM-DD compares lexicographically in chronological order. */
export function dueBucket(due: string | undefined, today: string): DueBucket {
  if (!due) return "none";
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due === addDays(today, 1)) return "tomorrow";
  return "upcoming";
}

/**
 * Start of the week containing `date`, Monday-first.
 *
 * Week start is fixed rather than locale-derived: the dashboard is one person's
 * and a grid that silently shifts its first column is worse than one that is
 * predictably Monday.
 */
export function startOfWeek(date: string): string {
  const weekday = parseLocalDate(date).getDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Shift by whole months, clamping the day (Jan 31 + 1 month lands on Feb 28/29). */
export function addMonths(date: string, months: number): string {
  const parsed = parseLocalDate(date);
  const target = new Date(parsed.getFullYear(), parsed.getMonth() + months, 1);
  const lastDayOfTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(parsed.getDate(), lastDayOfTarget));
  return localDate(target);
}

/** The seven days of `date`'s week. */
export function weekDays(date: string): string[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/**
 * Whole weeks covering `date`'s month — 35 or 42 days, so the grid is always
 * rectangular and the leading/trailing days belong to the neighbouring months.
 */
export function monthGrid(date: string): string[] {
  const monthKey = date.slice(0, 7);
  const days: string[] = [];
  let cursor = startOfWeek(startOfMonth(date));
  do {
    for (let index = 0; index < 7; index += 1) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
    }
  } while (cursor.slice(0, 7) === monthKey);
  return days;
}

export function isSameMonth(date: string, other: string): boolean {
  return date.slice(0, 7) === other.slice(0, 7);
}

/** Human label for a due date, relative where that reads better. */
export function formatDue(due: string, today: string): string {
  const bucket = dueBucket(due, today);
  if (bucket === "today") return "today";
  if (bucket === "tomorrow") return "tomorrow";
  if (bucket === "overdue") return `overdue — ${due}`;
  return due;
}
