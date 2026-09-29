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
 *  1. a step, joined *inside the run that owns it*: `runId` names the run and
 *     `stepRunId` the step within it. Step node ids are unique per run only —
 *     every async run starts its first step at `step:0` — so an unqualified
 *     step join lets a live run claim an unrelated finished row (#5).
 *  2. a nested run lifted to the top level, whose own node id is the child run
 *     id the row records as `stepRunId`.
 *  3. a run, joined to the row that records it as `runId`.
 *  4. a path/name substring, for relations recorded before the ids existed.
 *
 * No node claims a second row, and a workflow run's aggregate node never claims
 * one of its step rows: each node is matched to a *different* unclaimed row, so
 * when no free row remains the aggregate is simply not shown rather than
 * overwriting a step's own progress.
 */
export function buildRunProgress(
  subagents: readonly SessionInfo[],
  liveRuns: readonly PiSubagentSnapshotNode[],
): Map<string, RunProgress> {
  const byKey = new Map<string, RunProgress>();
  if (liveRuns.length === 0) return byKey;
  // Step nodes live under their run, so resolve each node's owning run while
  // flattening. A caller that passes an already flattened list
  // (`flattenPiSubagentSnapshot`) hands each step in twice — once as a root and
  // once under its run — so both visits are walked and the duplicate is dropped
  // by the node guard below.
  const nodes: { node: PiSubagentSnapshotNode; runId: string }[] = [];
  const walk = (node: PiSubagentSnapshotNode, runId: string) => {
    nodes.push({ node, runId });
    const ownerRunId = node.kind === "step" ? runId : node.id;
    for (const child of node.children ?? []) walk(child, ownerRunId);
  };
  for (const run of liveRuns) walk(run, run.id);

  const rows = subagents.flatMap((session) => (
    session.relation?.kind === "subagent" ? [{ session, relation: session.relation }] : []
  ));
  const claimedRows = new Set<string>();
  const claimedNodes = new Set<PiSubagentSnapshotNode>();
  const claim = (node: PiSubagentSnapshotNode, row: typeof rows[number]): void => {
    claimedRows.add(row.session.id);
    claimedNodes.add(node);
    byKey.set(row.session.id, progressOf(node));
  };
  const findRow = (owns: (row: typeof rows[number]) => boolean) => (
    rows.find((row) => !claimedRows.has(row.session.id) && owns(row))
  );

  for (const { node, runId } of nodes) {
    const row = findRow((candidate) => (
      candidate.relation.runId === runId && candidate.relation.stepRunId === node.id
    ));
    if (row) claim(node, row);
  }
  // A nested run the package lifts back to the top level (`liveRoots`) surfaces
  // as a kind "subagent"/"workflow" run node whose own id is the child run id
  // the row records as `stepRunId` beside the outer `runId`, so the qualified
  // join above cannot see it. Only run nodes may join this way: the `step:<n>`
  // placeholder repeats in every run, and `host-step` children carry
  // author-supplied monitor ids that can collide with another run's lane key.
  // Both are placeholders, so an unqualified join on either is exactly the
  // cross-run mis-join this fixes.
  for (const { node } of nodes) {
    if (claimedNodes.has(node)) continue;
    if (node.kind !== "subagent" && node.kind !== "workflow") continue;
    const row = findRow((candidate) => candidate.relation.stepRunId === node.id);
    if (row) claim(node, row);
  }
  for (const { node } of nodes) {
    if (claimedNodes.has(node)) continue;
    const row = findRow((candidate) => candidate.relation.runId === node.id);
    if (row) claim(node, row);
  }
  for (const { node } of nodes) {
    if (claimedNodes.has(node)) continue;
    const row = findRow((candidate) => (
      candidate.session.path.includes(node.id) || Boolean(candidate.session.name?.includes(node.id))
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
