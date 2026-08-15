import type { SubagentRpcRunEntry, SubagentRpcRunStatus } from "./subagent-rpc";
import type { SubagentLifecycleState, SubagentTreeNode, SubagentTreeResponse } from "./api-types";
import type { SessionInfo } from "./types";
import { attachSessionRelations, isReservedSubagentSessionName } from "./session-relations";

// ============================================================================
// Durable/live merge for the root-scoped subagent tree.
//
// Durable session ancestry defines the tree. Exact live (runId, index) state
// overrides only lifecycle, activity, and timing. A durable node without a
// matching live record is `inactive`; the server must never fabricate a
// terminal outcome or timing from session metadata.
// ============================================================================

const LIVE_STATES = new Set<SubagentLifecycleState>([
  "starting",
  "queued",
  "running",
  "needs_attention",
  "paused",
]);

function controlsFor(state: SubagentLifecycleState): Pick<SubagentTreeNode, "canSteer" | "canInterrupt" | "canResume"> {
  const active = state === "queued" || state === "running" || state === "needs_attention";
  return {
    canSteer: active,
    canInterrupt: state === "running" || state === "needs_attention",
    canResume: state === "paused",
  };
}

function lifecycleFromRun(entry: SubagentRpcRunEntry): SubagentLifecycleState {
  if (entry.activityState === "needs_attention" && entry.state === "running") return "needs_attention";
  switch (entry.state) {
    case "queued": return "queued";
    case "running": return "running";
    case "paused": return "paused";
    case "complete": return "complete";
    case "failed": return "failed";
    case "stopped": return "stopped";
    case "rejected": return "rejected";
    default: return "running";
  }
}

function activityFromRun(entry: SubagentRpcRunEntry): string | undefined {
  if (entry.currentTool) return entry.currentTool;
  if (entry.activityState === "needs_attention") return "needs_attention";
  return entry.activityState;
}

function addressOf(runId: string, index?: number): string {
  return `${runId}:${index ?? ""}`;
}

function sameMessage(left: string | undefined, right: string | undefined): boolean {
  const a = left?.trim();
  const b = right?.trim();
  return Boolean(a) && a === b;
}

/** Forked children clone the parent's first user prompt; that is not their task. */
function durableTask(
  session: SessionInfo,
  liveLabel: string | undefined,
  rootFirstMessage: string | undefined,
  parentFirstMessage: string | undefined,
): string {
  if (liveLabel) return liveLabel;
  const first = session.firstMessage?.trim();
  if (first && first !== "(no messages)"
    && !sameMessage(first, rootFirstMessage)
    && !sameMessage(first, parentFirstMessage)) {
    return firstLineOf(first);
  }
  if (session.name && !isReservedSubagentSessionName(session.name)) return session.name;
  return "";
}

/** The real task is the first line of the task prompt; the rest is generated boilerplate. */
function firstLineOf(message: string): string {
  const newline = message.indexOf("\n");
  return newline === -1 ? message : message.slice(0, newline);
}

function liveByAddress(runs: SubagentRpcRunStatus | null): Map<string, SubagentRpcRunEntry> {
  const byAddress = new Map<string, SubagentRpcRunEntry>();
  for (const entry of runs?.entries ?? []) {
    const key = addressOf(entry.runId, entry.index);
    const existing = byAddress.get(key);
    if (!existing || (entry.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      byAddress.set(key, entry);
    }
  }
  return byAddress;
}

interface DurableNode {
  session: SessionInfo;
  parentSessionId: string;
}

export function buildSubagentTree(input: {
  rootId: string;
  sessions: SessionInfo[];
  runs: SubagentRpcRunStatus | null;
  rpcAvailable: boolean;
  unavailableReason?: SubagentTreeResponse["unavailableReason"];
  polledAt: number;
}): SubagentTreeResponse {
  const { rootId, sessions, runs, rpcAvailable, unavailableReason, polledAt } = input;
  const related = attachSessionRelations(sessions);

  // Ownership: a subagent belongs to `rootId` when its resolved root is this
  // root. Orphans (no parent) and subagents of another primary session are
  // excluded. A root that is itself a subagent or missing (parent chain
  // cycles, deleted parents) is ambiguous; attach those under this root.
  const primaryIds = new Set(
    related.filter((session) => session.sessionRole === "primary").map((session) => session.id),
  );
  const ownedByRoot = (session: SessionInfo): boolean => {
    if (session.sessionRole !== "subagent") return false;
    const rootSessionId = session.rootSessionId;
    if (rootSessionId === rootId) return true;
    if (rootSessionId === undefined) {
      // True orphans have no parent; broken parent chains still belong to the
      // nearest requested root so their history stays visible.
      return Boolean(session.parentSessionId);
    }
    return !primaryIds.has(rootSessionId);
  };

  // Durable nodes owned by this root, keyed by session id.
  const durableBySessionId = new Map<string, DurableNode>();
  for (const session of related) {
    if (!ownedByRoot(session)) continue;
    durableBySessionId.set(session.id, {
      session,
      parentSessionId: session.parentSessionId ?? rootId,
    });
  }

  const live = liveByAddress(runs);
  // Durable parents keyed by their live address so nested placeholders can attach.
  const durableParentByAddress = new Map<string, string>();
  for (const durable of durableBySessionId.values()) {
    const session = durable.session;
    if (!session.subagentRunId) continue;
    durableParentByAddress.set(addressOf(session.subagentRunId, session.subagentIndex), session.id);
  }

  // Build durable nodes first (durable ancestry defines the tree).
  const childrenOf = new Map<string, SubagentTreeNode[]>();
  const nodesBySessionId = new Map<string, SubagentTreeNode>();
  const directChildren: SubagentTreeNode[] = [];
  const relatedById = new Map(related.map((session) => [session.id, session]));
  const rootFirstMessage = relatedById.get(rootId)?.firstMessage;

  const makeDurableNode = (durable: DurableNode): SubagentTreeNode => {
    const session = durable.session;
    const entry = session.subagentRunId
      ? live.get(addressOf(session.subagentRunId, session.subagentIndex))
      : undefined;
    const state: SubagentLifecycleState = entry ? lifecycleFromRun(entry) : "inactive";
    const controls = controlsFor(state);
    const parentFirstMessage = relatedById.get(durable.parentSessionId)?.firstMessage;
    const node: SubagentTreeNode = {
      sessionId: session.id,
      parentSessionId: durable.parentSessionId,
      runId: session.subagentRunId ?? "",
      ...(session.subagentIndex !== undefined ? { index: session.subagentIndex } : {}),
      agent: session.subagentAgent ?? "subagent",
      task: durableTask(session, entry?.label, rootFirstMessage, parentFirstMessage),
      state,
      ...(entry && activityFromRun(entry) ? { activity: activityFromRun(entry) } : {}),
      ...(entry?.startedAt !== undefined && state !== "inactive" ? { startedAt: entry.startedAt } : {}),
      ...(entry?.startedAt !== undefined && LIVE_STATES.has(state) && polledAt >= entry.startedAt
        ? { elapsedMs: polledAt - entry.startedAt }
        : {}),
      ...controls,
      children: [],
    };
    nodesBySessionId.set(session.id, node);
    return node;
  };

  // Cycle-safe parent resolution: parent must be a durable subagent under this
  // root and must not be the node itself or one of its descendants.
  const resolveDurableParent = (sessionId: string, candidateParentId: string | undefined): string => {
    if (!candidateParentId || candidateParentId === sessionId) return rootId;
    const parent = durableBySessionId.get(candidateParentId);
    if (!parent) return rootId;
    // Walk up from the candidate parent to reject cycles (parent chain loops).
    const visited = new Set<string>();
    let cursor: DurableNode | undefined = parent;
    while (cursor) {
      if (visited.has(cursor.session.id)) return rootId;
      visited.add(cursor.session.id);
      if (cursor.session.id === sessionId) return rootId;
      if (!cursor.parentSessionId || cursor.parentSessionId === rootId) break;
      cursor = durableBySessionId.get(cursor.parentSessionId);
    }
    return candidateParentId;
  };

  const rootNode: SubagentTreeNode = { sessionId: rootId, parentSessionId: "", runId: "", agent: "root", task: "", state: "inactive", canSteer: false, canInterrupt: false, canResume: false, children: [] };

  for (const durable of durableBySessionId.values()) {
    const node = makeDurableNode(durable);
    const parentId = resolveDurableParent(durable.session.id, durable.parentSessionId);
    if (parentId === rootId) {
      node.parentSessionId = rootId;
      directChildren.push(node);
    } else {
      node.parentSessionId = parentId;
      const list = childrenOf.get(parentId) ?? [];
      list.push(node);
      childrenOf.set(parentId, list);
    }
  }
  for (const [parentId, list] of childrenOf) {
    const parent = nodesBySessionId.get(parentId);
    if (parent) parent.children = list;
    else directChildren.push(...list);
  }

  // Live entries that did not join a durable node become starting placeholders.
  const joined = new Set<string>();
  for (const durable of durableBySessionId.values()) {
    if (!durable.session.subagentRunId) continue;
    const key = addressOf(durable.session.subagentRunId, durable.session.subagentIndex);
    if (live.has(key)) joined.add(key);
  }
  const placeholders: SubagentTreeNode[] = [];
  for (const [address, entry] of live) {
    if (joined.has(address)) continue;
    const parentSessionId = entry.parentRunId !== undefined
      ? (durableParentByAddress.get(addressOf(entry.parentRunId, entry.parentIndex)) ?? rootId)
      : rootId;
    const state: SubagentLifecycleState = "starting";
    const node: SubagentTreeNode = {
      sessionId: null,
      parentSessionId,
      runId: entry.runId,
      ...(entry.index !== undefined ? { index: entry.index } : {}),
      agent: entry.agent,
      task: entry.label || entry.agent,
      state,
      ...(entry.startedAt !== undefined ? { startedAt: entry.startedAt } : {}),
      ...(entry.startedAt !== undefined && polledAt >= entry.startedAt ? { elapsedMs: polledAt - entry.startedAt } : {}),
      canSteer: false,
      canInterrupt: false,
      canResume: false,
      children: [],
    };
    placeholders.push(node);
  }
  // Nested placeholders attach under their matching durable/live parent node.
  const placeholderByAddress = new Map<string, SubagentTreeNode>();
  for (const node of placeholders) placeholderByAddress.set(addressOf(node.runId, node.index), node);
  const topLevelPlaceholders: SubagentTreeNode[] = [];
  for (const node of placeholders) {
    const entry = live.get(addressOf(node.runId, node.index));
    const parentEntry = entry?.parentRunId !== undefined
      ? live.get(addressOf(entry.parentRunId, entry.parentIndex))
      : undefined;
    const durableParent = entry?.parentRunId !== undefined
      ? durableBySessionId.get(node.parentSessionId)
      : undefined;
    if (parentEntry) {
      const parentNode = placeholderByAddress.get(addressOf(parentEntry.runId, parentEntry.index))
        ?? (parentEntry.runId !== undefined ? nodesBySessionId.get(durableParentByAddress.get(addressOf(parentEntry.runId, parentEntry.index)) ?? "") : undefined);
      if (parentNode) {
        parentNode.children.push(node);
        continue;
      }
    } else if (durableParent) {
      const parentNode = nodesBySessionId.get(durableParent.session.id);
      if (parentNode) {
        parentNode.children.push(node);
        continue;
      }
    }
    topLevelPlaceholders.push(node);
  }

  const sortKey = (node: SubagentTreeNode): [number, number, string, number] => {
    const session = node.sessionId ? durableBySessionId.get(node.sessionId)?.session : undefined;
    const created = session ? Date.parse(session.created) : Number.MAX_SAFE_INTEGER;
    const started = node.startedAt ?? Number.MAX_SAFE_INTEGER;
    return [created, started, node.runId, node.index ?? -1];
  };
  const allTopLevel = [...directChildren, ...topLevelPlaceholders].sort((left, right) => {
    const a = sortKey(left);
    const b = sortKey(right);
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return 0;
  });
  for (const list of childrenOf.values()) {
    list.sort((left, right) => {
      const a = sortKey(left);
      const b = sortKey(right);
      for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
      }
      return 0;
    });
  }
  rootNode.children = allTopLevel;

  return {
    rootSessionId: rootId,
    rpcAvailable,
    ...(unavailableReason ? { unavailableReason } : {}),
    nodes: allTopLevel,
    polledAt,
  };
}

const LIVE_SIDEBAR_STATES = new Set<SubagentLifecycleState>([
  "starting",
  "queued",
  "running",
  "needs_attention",
]);

/** Durable child session ids whose live run is still active. */
export function collectLiveSubagentSessionIds(
  sessions: SessionInfo[],
  runs: SubagentRpcRunStatus | null,
): string[] {
  if (!runs) return [];
  const related = attachSessionRelations(sessions);
  const live = liveByAddress(runs);
  const ids: string[] = [];
  for (const session of related) {
    if (session.sessionRole !== "subagent" || !session.subagentRunId) continue;
    const entry = live.get(addressOf(session.subagentRunId, session.subagentIndex));
    if (!entry) continue;
    if (LIVE_SIDEBAR_STATES.has(lifecycleFromRun(entry))) ids.push(session.id);
  }
  return ids;
}

/** Resolves a child session owned by `rootId`, or null. */
export function findOwnedSubagent(
  rootId: string,
  childSessionId: string,
  sessions: SessionInfo[],
): SessionInfo | null {
  if (childSessionId === rootId) return null;
  const related = attachSessionRelations(sessions);
  const session = related.find((candidate) => candidate.id === childSessionId);
  if (!session || session.sessionRole !== "subagent") return null;
  if (session.rootSessionId !== rootId) return null;
  return session;
}
