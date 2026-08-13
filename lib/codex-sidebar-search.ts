import { skillExpansionToCommand } from "./slash-display";
import type { SessionInfo } from "./types";

export interface SearchableProject {
  path: string;
  name?: string;
  archived: boolean;
  removed: boolean;
  sessions: SessionInfo[];
}

export function sidebarProjectName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

export function sidebarSessionTitle(session: SessionInfo): string {
  const firstMessage = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  return session.name || firstMessage.slice(0, 72) || session.id.slice(0, 12);
}

export function matchesSidebarQuery(values: Array<string | undefined>, query: string): boolean {
  return values.some((value) => value?.toLowerCase().includes(query));
}

export function filterProjectSessions(project: SearchableProject, query: string): SessionInfo[] | null {
  if (project.removed || project.archived) return null;
  if (!query || matchesSidebarQuery([project.name ?? sidebarProjectName(project.path), project.path], query)) return project.sessions;
  const sessions = project.sessions.filter((session) => matchesSidebarQuery([sidebarSessionTitle(session), session.firstMessage], query));
  return sessions.length ? sessions : null;
}
