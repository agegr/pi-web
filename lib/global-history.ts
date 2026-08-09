import type { SessionInfo } from "./types";

export const GLOBAL_HISTORY_LIMIT = 30;

type RunningSessionIds = ReadonlySet<string>;

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Project the full session listing into the initial global history view.
 * Running sessions are owned by the live section and must not be duplicated
 * here. The final id comparison keeps equal timestamps deterministic.
 */
export function buildGlobalHistorySessions(
  sessions: readonly SessionInfo[],
  runningSessionIds: RunningSessionIds,
  limit = GLOBAL_HISTORY_LIMIT,
): SessionInfo[] {
  return sessions
    .filter((session) => !runningSessionIds.has(session.id))
    .sort((a, b) => (
      toTimestamp(b.modified) - toTimestamp(a.modified)
      || toTimestamp(b.created) - toTimestamp(a.created)
      || a.id.localeCompare(b.id)
    ))
    .slice(0, Math.max(0, limit));
}
