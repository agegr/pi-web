import { sidebarProjectName } from "./codex-sidebar-search";
import type { SessionInfo } from "./types";

export interface RecentProject {
  path: string;
  name?: string;
  archived: boolean;
  removed: boolean;
}

export interface RecentSessionRow {
  session: SessionInfo;
  projectLabel: string;
}

export function buildRecentSessions(
  sessions: readonly SessionInfo[],
  projects: readonly RecentProject[],
  archivedIds: ReadonlySet<string>,
  limit = 8,
): RecentSessionRow[] {
  const activeProjects = new Map(
    projects
      .filter((project) => !project.archived && !project.removed)
      .map((project) => [project.path, project]),
  );

  return sessions
    .filter((session) => session.sessionRole !== "subagent" && !archivedIds.has(session.id))
    .flatMap((session): RecentSessionRow[] => {
      const root = session.projectRoot ?? session.cwd;
      const project = activeProjects.get(root);
      if (!project) return [];
      return [{
        session,
        projectLabel: project.name ?? sidebarProjectName(project.path),
      }];
    })
    .sort((a, b) => b.session.modified.localeCompare(a.session.modified))
    .slice(0, limit);
}
