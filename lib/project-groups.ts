import type { SessionInfo } from "./types";
import { workspaceKeyOf } from "./workspace-memory";

/**
 * Sidebar-facing project display name (pi#25): the basename of the project
 * root — the same identity the sidebar keys on (`workspaceKeyOf`:
 * `projectKey ?? projectRoot ?? cwd`, so callers pass the resolved
 * `projectRoot ?? cwd`). Falls back to "?" for empty roots; never empty,
 * never throws. Used by embedded pane headers as `<project> · <session>`.
 */
export function projectDisplayNameForPath(root: string | null | undefined): string {
  if (!root) return "?";
  const trimmed = root.replace(/[/\\]+$/, "");
  if (!trimmed) return "?";
  const segments = trimmed.split(/[/\\]/).filter(Boolean);
  const base = segments[segments.length - 1];
  return base || "?";
}

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

/**
 * Loose client-side path containment (browser-safe, no node:path):
 * case-insensitive, backslashes normalized to forward slashes, trailing
 * separators trimmed — the same normalization spirit as
 * isSameExplorerPath in lib/default-cwd-shortcut.ts. A path equal to the
 * root counts as inside it.
 */
function normalizeDirectoryPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Whether `path` is the directory `root` itself or inside it (loosely). */
export function isPathInsideDirectory(root: string, path: string): boolean {
  const normalizedRoot = normalizeDirectoryPath(root);
  if (!normalizedRoot) return false;
  const normalizedPath = normalizeDirectoryPath(path);
  if (!normalizedPath) return false;
  return normalizedPath === normalizedRoot
    || normalizedPath.startsWith(`${normalizedRoot}/`);
}

/**
 * Sessions belonging to one user-listed sidebar directory: every session
 * whose cwd is the root or inside it, PLUS every session whose resolved
 * project root is the root or inside it. The project-root clause is what
 * pulls git-worktree sessions into their listed repository's group — a
 * linked worktree lives OUTSIDE the repo directory
 * (`<repoRoot>-worktrees/<branch>`), so cwd containment alone could not
 * express that membership, but the server resolves the worktree session's
 * projectRoot back to the repository root. Deliberately free of
 * workspace-key, pseudo-project and worktree-specific filtering: a
 * non-git directory groups by plain cwd containment, and any worktree of
 * a listed repository groups under it alongside the main checkout.
 */
export function sessionsForDirectory(
  sessions: readonly SessionInfo[],
  root: string,
): SessionInfo[] {
  return sessions.filter((session) => {
    if (!session.cwd) return false;
    if (isPathInsideDirectory(root, session.cwd)) return true;
    const projectRoot = session.projectRoot ?? null;
    return projectRoot != null && isPathInsideDirectory(root, projectRoot);
  });
}
