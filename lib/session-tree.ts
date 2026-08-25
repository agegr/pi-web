import type { SessionInfo } from "./types";

export interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

/** Build the sidebar hierarchy. Forks remain roots; only subagents nest. */
export function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const session of sessions) {
    byId.set(session.id, { session, children: [] });
  }

  const parentOf = new Map<string, string>();
  for (const session of sessions) {
    if (session.relation?.kind === "subagent") {
      parentOf.set(session.id, session.relation.parentSessionId);
    }
  }

  function resolveAncestor(id: string): string | null {
    let current = parentOf.get(id);
    let nearest: string | null = null;
    const visited = new Set([id]);
    while (current) {
      if (visited.has(current)) return null;
      visited.add(current);
      if (!nearest && byId.has(current)) nearest = current;
      current = parentOf.get(current);
    }
    return nearest;
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) byId.get(ancestor)!.children.push(node);
    else roots.push(node);
  }

  const pending = [roots];
  while (pending.length > 0) {
    const nodes = pending.pop()!;
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    for (const node of nodes) pending.push(node.children);
  }
  return roots;
}
