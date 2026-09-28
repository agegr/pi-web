import type { SessionInfo, SubagentSessionStatus } from "./types";
import {
  mapPiSubagentRunState,
  type PiSubagentSnapshotActivity,
  type PiSubagentSnapshotNode,
} from "./pi-subagents-snapshot";

/** One run's live activity, reduced to the fields the Agents panel renders. */
export interface RunProgress {
  label: string;
  status: SubagentSessionStatus;
  startedAt?: number;
  endedAt?: number;
  activity?: PiSubagentSnapshotActivity;
}

function progressOf(node: PiSubagentSnapshotNode): RunProgress {
  return {
    label: node.label,
    status: mapPiSubagentRunState(node.state),
    ...(node.startedAt !== undefined ? { startedAt: node.startedAt } : {}),
    ...(node.endedAt !== undefined ? { endedAt: node.endedAt } : {}),
    ...(node.activity ? { activity: node.activity } : {}),
  };
}

/**
 * Map a live snapshot node onto the subagent row that owns it, keyed by row id.
 * Nodes are identified most specific first:
 *
 *  1. `stepRunId` — the snapshot node id of this child's step. One async run
 *     backs every child of a multi-step chain, so the run id alone would join
 *     all of them to one row and "last wins".
 *  2. `runId` — a run that produced exactly this transcript.
 *  3. a path/name substring, for relations recorded before the ids existed.
 *
 * A workflow run's aggregate node never claims one of its step rows: each node
 * is matched to a *different* unclaimed row, so when no free row remains the
 * aggregate is simply not shown rather than overwriting a step's own progress.
 */
export function buildRunProgress(
  subagents: readonly SessionInfo[],
  liveRuns: readonly PiSubagentSnapshotNode[],
): Map<string, RunProgress> {
  const byKey = new Map<string, RunProgress>();
  if (liveRuns.length === 0) return byKey;
  // Step nodes live under their run. Flattening here keeps the join correct even
  // when a caller passes top-level runs only; it is a no-op for a pre-flattened list.
  const nodes: PiSubagentSnapshotNode[] = [];
  const walk = (node: PiSubagentSnapshotNode) => {
    nodes.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  for (const run of liveRuns) walk(run);

  const rows = subagents.flatMap((session) => (
    session.relation?.kind === "subagent" ? [{ session, relation: session.relation }] : []
  ));
  const claimed = new Set<string>();
  const claim = (node: PiSubagentSnapshotNode, row: typeof rows[number]): void => {
    claimed.add(row.session.id);
    byKey.set(row.session.id, progressOf(node));
  };

  for (const node of nodes) {
    const row = rows.find((candidate) => (
      candidate.relation.stepRunId === node.id && !claimed.has(candidate.session.id)
    ));
    if (row) claim(node, row);
  }
  for (const node of nodes) {
    const row = rows.find((candidate) => (
      candidate.relation.runId === node.id && !claimed.has(candidate.session.id)
    ));
    if (row) claim(node, row);
  }
  for (const node of nodes) {
    const row = rows.find((candidate) => (
      !claimed.has(candidate.session.id)
      && (candidate.session.path.includes(node.id) || candidate.session.name?.includes(node.id))
    ));
    if (row) claim(node, row);
  }

  return byKey;
}

export function formatElapsed(startedAt: number | undefined, endAt: number): string {
  if (!startedAt || !Number.isFinite(startedAt)) return "";
  const totalSeconds = Math.max(0, Math.floor((endAt - startedAt) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Compact progress line: current tool, elapsed time, turn and tool counts. */
export function formatRunProgress(
  progress: RunProgress,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const parts: string[] = [];
  // A finished run's last tool is history, not "current"; keep it for live runs only.
  if (progress.status === "running" && progress.activity?.currentTool) {
    parts.push(t("agentSwitcher.run.tool", { name: progress.activity.currentTool }));
  }
  const elapsed = formatElapsed(progress.startedAt, progress.endedAt ?? Date.now());
  if (elapsed) parts.push(elapsed);
  if (progress.activity?.turnCount !== undefined) parts.push(t("agentSwitcher.run.turns", { count: progress.activity.turnCount }));
  if (progress.activity?.toolCount !== undefined) parts.push(t("agentSwitcher.run.tools", { count: progress.activity.toolCount }));
  return parts.join(" · ");
}
