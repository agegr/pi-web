import type { SessionInfo } from "./types";

const SUBAGENT_SESSION_NAME = /^subagent-(.+)-((?:[0-9a-f]{8})|(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))(?:-(\d+))?$/;

export function attachSessionRelations(sessions: SessionInfo[]): SessionInfo[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));

  return sessions.map((session) => {
    const match = session.parentSessionId && session.name?.match(SUBAGENT_SESSION_NAME);
    if (!match) return { ...session, sessionRole: session.parentSessionId ? "fork" : "primary" };

    let rootSessionId = session.parentSessionId;
    const visited = new Set([session.id]);
    while (rootSessionId && !visited.has(rootSessionId)) {
      visited.add(rootSessionId);
      const parent = byId.get(rootSessionId);
      if (!parent) break;
      const parentIsSubagent = Boolean(parent.parentSessionId && parent.name?.match(SUBAGENT_SESSION_NAME));
      if (!parentIsSubagent) break;
      rootSessionId = parent.parentSessionId;
    }

    if (!rootSessionId || !byId.has(rootSessionId)) {
      return { ...session, sessionRole: "fork" };
    }

    return {
      ...session,
      sessionRole: "subagent",
      rootSessionId,
      subagentAgent: match[1],
      subagentRunId: match[2],
      ...(match[3] ? { subagentIndex: Number(match[3]) } : {}),
    };
  });
}

export function activeSessionRoots(
  sessions: SessionInfo[],
  runningSessionIds: Iterable<string>,
  unresolvedFallback: Iterable<string> = [],
): { roots: Set<string>; unresolved: boolean } {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const roots = new Set<string>();
  let unresolved = false;

  for (const id of runningSessionIds) {
    const session = byId.get(id);
    if (!session) {
      unresolved = true;
      continue;
    }
    roots.add(session.sessionRole === "subagent" && session.rootSessionId ? session.rootSessionId : id);
  }
  if (unresolved) for (const id of unresolvedFallback) roots.add(id);

  return { roots, unresolved };
}
