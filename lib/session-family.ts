import type { SessionInfo } from "./types";

/** Relation kinds that hide a session as a family member instead of a sidebar row. */
export type HiddenRelationKind = "subagent" | "side";
export type HiddenRelation = Extract<SessionInfo["relation"], { kind: HiddenRelationKind }>;

export function isHiddenRelation(relation: SessionInfo["relation"]): relation is HiddenRelation {
  return relation?.kind === "subagent" || relation?.kind === "side";
}

export interface SessionFamily {
  root: SessionInfo;
  /** Every hidden member of the family: subagent runs and side chats (ADR 0007). */
  subagents: SessionInfo[];
  latestModified: string;
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
      if (!isHiddenRelation(current.relation)) {
        rootId = current.id;
        break;
      }
      currentId = current.relation.parentSessionId;
    }

    for (const id of path) roots.set(id, rootId);
  }

  return roots;
}

/** Groups visible main/fork sessions with every persisted subagent descendant. */
export function listSessionFamilies(sessions: readonly SessionInfo[]): SessionFamily[] {
  const rootsBySessionId = resolveFamilyRoots(sessions);
  const families = new Map<string, SessionFamily>();

  for (const session of sessions) {
    if (isHiddenRelation(session.relation)) continue;
    families.set(session.id, {
      root: session,
      subagents: [],
      latestModified: session.modified,
    });
  }

  for (const session of sessions) {
    if (!isHiddenRelation(session.relation)) continue;
    const rootId = rootsBySessionId.get(session.id);
    const family = rootId ? families.get(rootId) : undefined;
    if (!family) continue;
    family.subagents.push(session);
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
    || family.subagents.some((session) => session.id === sessionId)
  )) ?? null;
}

/** Subagents of a family that the sidebar's running poll lists. */
export function countRunningSubagents(
  subagents: readonly SessionInfo[],
  runningSessionIds: ReadonlySet<string>,
): number {
  return subagents.filter((session) => runningSessionIds.has(session.id)).length;
}

/** The top bar's Agents badge: how many run while any does, else how many there are. */
export function getAgentsBadge(
  subagents: readonly SessionInfo[],
  runningSessionIds: ReadonlySet<string>,
): { count: number; running: boolean } {
  const running = countRunningSubagents(subagents, runningSessionIds);
  return running > 0 ? { count: running, running: true } : { count: subagents.length, running: false };
}

/**
 * The badge a narrow phone's folded More button carries in place of the
 * Agents button it hides: only while subagents run, never once it is open.
 */
export function getFoldedMoreAgentsBadge(
  badge: { count: number; running: boolean } | null,
  moreOpen: boolean,
): { count: number; running: true } | null {
  return badge?.running && !moreOpen ? { count: badge.count, running: true } : null;
}
