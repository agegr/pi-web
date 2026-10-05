import type { SessionInfo } from "./types";
import { workspaceKeyOf } from "./workspace-memory";

export interface RecentProject {
  /** Stable server-provided identity used for comparison and Map keys. */
  key: string;
  /** Original project path used for display and filesystem operations. */
  root: string;
}

/** Projects sorted by most recent activity and deduplicated by stable key. */
export function getRecentProjects(sessions: readonly SessionInfo[]): RecentProject[] {
  const latestByProject = new Map<string, { root: string; modified: string }>();
  for (const session of sessions) {
    const root = session.projectRoot ?? session.cwd;
    if (!root) continue;
    const key = workspaceKeyOf(session);
    const previous = latestByProject.get(key);
    if (!previous || session.modified > previous.modified) {
      latestByProject.set(key, { root, modified: session.modified });
    }
  }
  return [...latestByProject.entries()]
    .sort((a, b) => b[1].modified.localeCompare(a[1].modified))
    .map(([key, { root }]) => ({ key, root }));
}

export function getProjectActivity(
  sessions: readonly SessionInfo[],
  runningSessionIds: ReadonlySet<string>,
  unreadSessionIds: ReadonlySet<string>,
): Map<string, { running: number; unread: number }> {
  const counts = new Map<string, { running: number; unread: number }>();
  for (const session of sessions) {
    const key = workspaceKeyOf(session);
    if (!key) continue;
    let entry = counts.get(key);
    if (!entry) {
      entry = { running: 0, unread: 0 };
      counts.set(key, entry);
    }
    if (runningSessionIds.has(session.id)) entry.running++;
    if (unreadSessionIds.has(session.id)) entry.unread++;
  }
  return counts;
}

export function sessionsForProject(
  sessions: readonly SessionInfo[],
  projectKey: string,
): SessionInfo[] {
  return sessions.filter((session) => workspaceKeyOf(session) === projectKey);
}

export interface ProjectDeleteCounts {
  /** Sessions the project holds, transient ones excluded — they have no file yet. */
  sessions: number;
  /** Directories those sessions live in: one per cwd, worktrees included. */
  directories: number;
}

/**
 * What deleting this project would remove, for the confirmation dialog. Both
 * numbers come from the loaded session list, so the dialog states what the
 * sidebar itself is showing: the server deletes exactly the sessions it
 * enumerates, one directory per cwd the project has sessions in.
 */
export function projectDeleteCounts(
  sessions: readonly SessionInfo[],
  projectKey: string,
): ProjectDeleteCounts {
  const projectSessions = sessionsForProject(sessions, projectKey).filter((session) => !session.transient);
  return {
    sessions: projectSessions.length,
    directories: new Set(projectSessions.map((session) => session.cwd).filter(Boolean)).size,
  };
}
