import { getFileName, normalizeFilePathSlashes } from "./file-paths";
import type { SessionInfo } from "./types";

export const GLOBAL_HISTORY_LIMIT = 30;

type RunningSessionIds = ReadonlySet<string>;

export interface GlobalSearchableSession {
  /** Display title for live snapshots; saved sessions use name/firstMessage. */
  title?: string;
  name?: string;
  firstMessage?: string;
  projectRoot?: string;
  cwd: string;
}

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Match the fields users can see when searching global navigation. The project
 * name is the final segment of projectRoot, while cwd remains searchable as a
 * full path so worktrees and nested directories can be found too.
 */
export function matchesGlobalSessionQuery(
  session: GlobalSearchableSession,
  query: string,
): boolean {
  const normalizedQuery = normalizeFilePathSlashes(query.trim()).toLowerCase();
  if (!normalizedQuery) return true;

  const projectRoot = session.projectRoot ?? session.cwd;
  return [
    session.title,
    session.name,
    session.firstMessage,
    getFileName(projectRoot),
    session.cwd,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizeFilePathSlashes(value))
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

/**
 * Project the full session listing into global history candidates. Running
 * sessions are owned by the live section and must not be duplicated here. The
 * final id comparison keeps equal timestamps deterministic.
 */
export function buildGlobalHistoryCandidates(
  sessions: readonly SessionInfo[],
  runningSessionIds: RunningSessionIds,
): SessionInfo[] {
  return sessions
    .filter((session) => !runningSessionIds.has(session.id))
    .sort((a, b) => (
      toTimestamp(b.modified) - toTimestamp(a.modified)
      || toTimestamp(b.created) - toTimestamp(a.created)
      || a.id.localeCompare(b.id)
    ));
}

/**
 * Project the full session listing into the initial global history view.
 * Keeping the limit here preserves the existing recent-history seam while
 * callers that need pagination can consume buildGlobalHistoryCandidates().
 */
export function buildGlobalHistorySessions(
  sessions: readonly SessionInfo[],
  runningSessionIds: RunningSessionIds,
  limit = GLOBAL_HISTORY_LIMIT,
): SessionInfo[] {
  return buildGlobalHistoryCandidates(sessions, runningSessionIds)
    .slice(0, Math.max(0, limit));
}
