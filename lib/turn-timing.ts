import type { SessionEntry } from "./types";

export const TURN_TIMING_CUSTOM_TYPE = "pi-web:turn-timing";

/** One server-side logical run, including retries, tools and auto-compaction. */
export interface TurnTiming {
  id: string;
  startedAt: number;
  endedAt?: number;
  /** Last visible entry produced by this run; follows queued user messages. */
  anchorEntryId?: string;
}

/** A late snapshot must not restart a finished run or replace a newer one. */
export function mergeTurnTiming(previous: TurnTiming | null, incoming: TurnTiming | null): TurnTiming | null {
  if (!incoming) return null;
  if (previous && (previous.startedAt > incoming.startedAt
    || (previous.id === incoming.id && previous.endedAt !== undefined && incoming.endedAt === undefined))) return previous;
  return incoming;
}

export function findTurnTimingAnchor(entries: readonly SessionEntry[], startIndex = 0): string | undefined {
  for (let index = entries.length - 1; index >= startIndex; index -= 1) {
    const entry = entries[index];
    if (entry.type === "message" || entry.type === "compaction"
      || entry.type === "branch_summary" || entry.type === "custom_message") return entry.id;
  }
  return undefined;
}

/** Metadata may follow the selected leaf or page, so search all entries by anchor. */
export function readTurnTimings(entries: readonly SessionEntry[], visibleEntryIds: readonly string[]): TurnTiming[] {
  const visible = new Set(visibleEntryIds);
  const timings = new Map<string, TurnTiming>();
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== TURN_TIMING_CUSTOM_TYPE) continue;
    const data = entry.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
    const timing = data as Record<string, unknown>;
    if (timing.version !== 1 || typeof timing.id !== "string"
      || typeof timing.startedAt !== "number" || !Number.isFinite(timing.startedAt)
      || typeof timing.endedAt !== "number" || !Number.isFinite(timing.endedAt)
      || timing.endedAt < timing.startedAt
      || typeof timing.anchorEntryId !== "string" || !visible.has(timing.anchorEntryId)) continue;
    timings.set(timing.id, {
      id: timing.id,
      startedAt: timing.startedAt,
      endedAt: timing.endedAt,
      anchorEntryId: timing.anchorEntryId,
    });
  }
  return [...timings.values()];
}
