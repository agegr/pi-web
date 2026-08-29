import type { SessionInfo } from "./types";

export interface SessionFamily {
  root: SessionInfo;
  /** Every descendant linked through parentSession, including forks and subagents. */
  children: SessionInfo[];
  /** Metadata-confirmed Pi Web subagents only. */
  subagents: SessionInfo[];
  latestModified: string;
}

function parentId(session: SessionInfo): string | undefined {
  if (session.relation?.kind === "subagent") return session.relation.parentSessionId;
  if (session.relation?.kind === "fork") return session.relation.originSessionId;
  return undefined;
}

function resolveFamilyRoots(sessions: readonly SessionInfo[]): Map<string, string | null> {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const roots = new Map<string, string | null>();

  for (const session of sessions) {
    if (roots.has(session.id)) continue;

    const path: string[] = [];
    const visited = new Set<string>();
    let currentId = session.id;
    let rootId: string | null = null;

    while (true) {
      if (roots.has(currentId)) {
        rootId = roots.get(currentId) ?? null;
        break;
      }
      if (visited.has(currentId)) break;

      visited.add(currentId);
      path.push(currentId);
      const current = byId.get(currentId);
      if (!current) break;
      const parent = parentId(current);
      if (!parent) {
        rootId = current.id;
        break;
      }
      currentId = parent;
    }

    for (const id of path) roots.set(id, rootId);
  }

  return roots;
}

/** Groups every resolvable parentSession descendant under its root session. */
export function listSessionFamilies(sessions: readonly SessionInfo[]): SessionFamily[] {
  const rootsBySessionId = resolveFamilyRoots(sessions);
  const families = new Map<string, SessionFamily>();

  for (const session of sessions) {
    if (rootsBySessionId.get(session.id) !== session.id) continue;
    families.set(session.id, {
      root: session,
      children: [],
      subagents: [],
      latestModified: session.modified,
    });
  }

  for (const session of sessions) {
    const rootId = rootsBySessionId.get(session.id);
    if (!rootId || rootId === session.id) continue;
    const family = families.get(rootId);
    if (!family) continue;
    family.children.push(session);
    if (session.relation?.kind === "subagent") family.subagents.push(session);
    if (session.modified > family.latestModified) family.latestModified = session.modified;
  }

  return [...families.values()].sort((a, b) => b.latestModified.localeCompare(a.latestModified));
}

export function getSessionFamily(
  sessions: readonly SessionInfo[],
  sessionId: string | null | undefined,
): SessionFamily | null {
  if (!sessionId) return null;
  return listSessionFamilies(sessions).find((family) => (
    family.root.id === sessionId
    || family.children.some((session) => session.id === sessionId)
  )) ?? null;
}
