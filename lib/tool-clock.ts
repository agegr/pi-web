/**
 * The time a tool card shows before its result message arrives, as pi's TUI: `Elapsed` while the
 * call runs, counted from when its start reached the page, then pi's measured time once it ends.
 * Client-safe.
 */

/** A running call's start on the page's clock, or the time pi measured once it ended. */
export type ToolClock = { startedAt: number } | { durationMs: number };

export type ToolClocks = ReadonlyMap<string, ToolClock>;

export const NO_TOOL_CLOCKS: ToolClocks = new Map();

interface ToolExecutionEventLike {
  type: string;
  toolCallId?: unknown;
  parentToolCallId?: unknown;
  elapsedMs?: unknown;
  durationMs?: unknown;
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * The clocks after a tool event. A start counts from `now`, or from `now - elapsedMs` when the
 * server replays the start of a call already running (a reload, a reconnect); a call that has a
 * clock keeps it. An end keeps pi's `durationMs`, or drops the clock without one (a call refused
 * before it ran). Calls a tool made itself (a codemode script's) have none. Returns `clocks` itself
 * when nothing changes.
 */
export function applyToolClockEvent(clocks: ToolClocks, event: ToolExecutionEventLike, now: number): ToolClocks {
  const id = event.toolCallId;
  if (typeof id !== "string" || (typeof event.parentToolCallId === "string" && event.parentToolCallId !== "")) return clocks;
  if (event.type === "tool_execution_start") {
    if (clocks.has(id)) return clocks;
    const next = new Map(clocks);
    next.set(id, { startedAt: now - (nonNegative(event.elapsedMs) ?? 0) });
    return next;
  }
  if (event.type === "tool_execution_end") {
    const durationMs = nonNegative(event.durationMs);
    if (durationMs === undefined) return withoutToolClock(clocks, id);
    const next = new Map(clocks);
    next.set(id, { durationMs });
    return next;
  }
  return clocks;
}

/** The clocks without a call's: its result message has arrived. */
export function withoutToolClock(clocks: ToolClocks, id: string): ToolClocks {
  if (!clocks.has(id)) return clocks;
  const next = new Map(clocks);
  next.delete(id);
  return next;
}

/** A clock's time at `now`: the run so far, or pi's measured time. */
export function toolClockMs(clock: ToolClock, now: number): number {
  return "durationMs" in clock ? clock.durationMs : Math.max(0, now - clock.startedAt);
}
