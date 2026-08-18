import type { SessionInfo } from "./types";
import type { CustomProjectEntry } from "./custom-projects";
import { workspaceKeyOf } from "./workspace-memory";

export interface RecentProject {
  /** Stable server-provided identity used for comparison and Map keys. */
  key: string;
  /** Original project path used for display and filesystem operations. */
  root: string;
}

/**
 * Projects sorted by most recent activity and deduplicated by stable key.
 *
 * Session-derived projects always win because they prove the directory still
 * exists and was actually used. Pinned custom paths only fill in the gaps —
 * if the user has never started a session in that project, the entry is still
 * surfaced so the sidebar remembers the user's intent.
 */
export function getRecentProjects(
  sessions: readonly SessionInfo[],
  customProjects: readonly CustomProjectEntry[] = [],
): RecentProject[] {
  const latestByProject = new Map<string, { root: string; modified: string; fromSession: boolean }>();
  for (const session of sessions) {
    const root = session.projectRoot ?? session.cwd;
    if (!root) continue;
    const key = workspaceKeyOf(session);
    const previous = latestByProject.get(key);
    if (!previous || session.modified > previous.modified) {
      latestByProject.set(key, { root, modified: session.modified, fromSession: true });
    }
  }
  for (const cp of customProjects) {
    const existing = latestByProject.get(cp.key);
    if (existing) {
      // Keep the session-derived root when both refer to the same project —
      // it has been canonicalised against the server's filesystem view.
      if (!existing.fromSession && cp.addedAt > existing.modified) {
        existing.modified = cp.addedAt;
      }
      continue;
    }
    latestByProject.set(cp.key, { root: cp.root, modified: cp.addedAt, fromSession: false });
  }
  return [...latestByProject.entries()]
    .sort((a, b) => b[1].modified.localeCompare(a[1].modified))
    .map(([key, { root }]) => ({ key, root }));
}

/** True when the given key only appears as a pinned custom path with no
 *  sessions backing it. Used by the sidebar to gate the "remove" affordance. */
export function isCustomOnlyProject(
  key: string,
  sessions: readonly SessionInfo[],
  customProjects: readonly CustomProjectEntry[],
): boolean {
  if (!customProjects.some((cp) => cp.key === key)) return false;
  for (const session of sessions) {
    if (workspaceKeyOf(session) === key) return false;
  }
  return true;
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