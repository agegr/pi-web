// Pure helpers extracted from components/SessionSidebar.tsx so they can be
// unit-tested without a DOM. The component imports everything here; nothing in
// this module touches React. localStorage access is isolated to thin wrappers
// at the bottom, built on pure parse/serialize cores.

import type { SessionInfo } from "./types";

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

/**
 * Return all projects (deduped by projectRoot so worktrees collapse into their
 * main repo) sorted by most recent session activity.
 */
export function getRecentProjects(sessions: SessionInfo[]): string[] {
  const latestByRoot = new Map<string, string>(); // projectRoot -> most recent modified
  for (const s of sessions) {
    const root = s.projectRoot ?? s.cwd;
    if (!root) continue;
    const prev = latestByRoot.get(root);
    if (!prev || s.modified > prev) {
      latestByRoot.set(root, s.modified);
    }
  }
  return [...latestByRoot.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([root]) => root);
}

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */
export function displayCwd(cwd: string, homeDir?: string): string {
  return (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
}

export interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

export function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const s of sessions) {
    byId.set(s.id, { session: s, children: [] });
  }

  // Build a map of parentSessionId chains so we can resolve missing ancestors
  const parentOf = new Map<string, string>();
  for (const s of sessions) {
    if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId);
  }

  // Walk up the parentSessionId chain to find the nearest ancestor that exists in byId
  function resolveAncestor(id: string): string | null {
    let cur = parentOf.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur)) return null; // cycle guard
      visited.add(cur);
      if (byId.has(cur)) return cur;
      cur = parentOf.get(cur);
    }
    return null;
  }

  // Resolve each node's nearest existing ancestor up front so we can break
  // cycles before attaching. Without this, a parent cycle (a→b→a, both present)
  // leaves every node with a parent and produces ZERO roots, so the whole
  // sub-forest silently vanishes from the sidebar.
  const resolvedParent = new Map<string, string | null>();
  for (const node of byId.values()) {
    resolvedParent.set(node.session.id, resolveAncestor(node.session.id));
  }

  // Break cycles in the resolved-parent graph: if walking parents from a node
  // loops back to that same node, demote it to a root so the cycle is severed
  // while every node stays reachable.
  for (const id of byId.keys()) {
    let cur: string | null = id;
    while (cur) {
      const parent: string | null = resolvedParent.get(cur) ?? null;
      if (parent === null) break; // reached a root — chain is acyclic
      if (parent === id) { resolvedParent.set(id, null); break; } // cycle back to id
      cur = parent;
    }
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolvedParent.get(node.session.id) ?? null;
    if (ancestor) {
      byId.get(ancestor)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort each level by modified desc
  const sort = (nodes: SessionTreeNode[]) => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

// --- Unread session id persistence ------------------------------------------
// Pure cores are testable; the load/save wrappers just bridge to localStorage.

export const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";

/** Parse the stored JSON payload into a Set, tolerating malformed input. */
export function parseUnreadSessionIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

/** Serialize ids for storage; null signals the key should be removed. */
export function serializeUnreadSessionIds(ids: Set<string>): string | null {
  return ids.size === 0 ? null : JSON.stringify([...ids]);
}

export function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return parseUnreadSessionIds(window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY));
  } catch {
    return new Set();
  }
}

export function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    const payload = serializeUnreadSessionIds(ids);
    if (payload === null) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, payload);
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}
