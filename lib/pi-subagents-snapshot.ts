// Pure helpers for pi-subagents' live async-status widget. Kept free of Node
// built-ins so the demo (a static, backend-free build) can mirror this file and
// the progress UI can share it across server and browser.

export const PI_SUBAGENTS_ASYNC_WIDGET_PREFIX = "PI_SUBAGENT_ASYNC_JSON:";
export const PI_SUBAGENTS_ASYNC_SNAPSHOT_KIND = "pi-subagents.async-status-snapshot";
export const PI_SUBAGENTS_ASYNC_SNAPSHOT_VERSION = 1;

export type PiSubagentRunState =
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "partial"
  | "paused"
  | "stopped"
  | "rejected";

/** Status vocabulary the existing Agents panel already renders. */
export type PiSubagentRunStatus = "running" | "completed" | "failed" | "stopped";

/** Collapse the async runner's fine-grained state into the panel's status set. */
export function mapPiSubagentRunState(state: PiSubagentRunState): PiSubagentRunStatus {
  switch (state) {
    case "queued":
    case "running":
      return "running";
    case "complete":
      return "completed";
    case "stopped":
      return "stopped";
    default:
      return "failed";
  }
}

export interface PiSubagentSnapshotActivity {
  state?: string;
  currentTool?: string;
  lastActivityAt?: number;
  currentToolStartedAt?: number;
  turnCount?: number;
  toolCount?: number;
}

export interface PiSubagentSnapshotNode {
  id: string;
  kind: string;
  label: string;
  state: PiSubagentRunState;
  startedAt?: number;
  updatedAt?: number;
  endedAt?: number;
  activity?: PiSubagentSnapshotActivity;
  children?: PiSubagentSnapshotNode[];
}

export interface PiSubagentSnapshot {
  kind: typeof PI_SUBAGENTS_ASYNC_SNAPSHOT_KIND;
  version: number;
  generatedAt: number;
  runs: PiSubagentSnapshotNode[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const RUN_STATES: ReadonlySet<string> = new Set([
  "queued",
  "running",
  "complete",
  "failed",
  "partial",
  "paused",
  "stopped",
  "rejected",
]);

function parseNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseActivity(value: unknown): PiSubagentSnapshotActivity | undefined {
  if (!isRecord(value)) return undefined;
  const activity: PiSubagentSnapshotActivity = {
    ...(typeof value.state === "string" ? { state: value.state } : {}),
    ...(typeof value.currentTool === "string" ? { currentTool: value.currentTool } : {}),
    ...(parseNumber(value.lastActivityAt) !== undefined ? { lastActivityAt: parseNumber(value.lastActivityAt) } : {}),
    ...(parseNumber(value.currentToolStartedAt) !== undefined ? { currentToolStartedAt: parseNumber(value.currentToolStartedAt) } : {}),
    ...(parseNumber(value.turnCount) !== undefined ? { turnCount: parseNumber(value.turnCount) } : {}),
    ...(parseNumber(value.toolCount) !== undefined ? { toolCount: parseNumber(value.toolCount) } : {}),
  };
  return Object.keys(activity).length > 0 ? activity : undefined;
}

function parseNode(value: unknown): PiSubagentSnapshotNode | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.label !== "string") return null;
  if (typeof value.state !== "string" || !RUN_STATES.has(value.state)) return null;
  const children = Array.isArray(value.children)
    ? value.children.map(parseNode).filter((child): child is PiSubagentSnapshotNode => child !== null)
    : undefined;
  return {
    id: value.id,
    kind: typeof value.kind === "string" ? value.kind : "subagent",
    label: value.label,
    state: value.state as PiSubagentRunState,
    ...(parseNumber(value.startedAt) !== undefined ? { startedAt: parseNumber(value.startedAt) } : {}),
    ...(parseNumber(value.updatedAt) !== undefined ? { updatedAt: parseNumber(value.updatedAt) } : {}),
    ...(parseNumber(value.endedAt) !== undefined ? { endedAt: parseNumber(value.endedAt) } : {}),
    ...(parseActivity(value.activity) ? { activity: parseActivity(value.activity) } : {}),
    ...(children && children.length > 0 ? { children } : {}),
  };
}

/**
 * Parse the first complete `PI_SUBAGENT_ASYNC_JSON:`-prefixed line. The widget
 * may carry several snapshots (one per publish); taking everything after the
 * first prefix would concatenate them into invalid JSON.
 */
export function parseAsyncSnapshotWidgetLine(text: string): PiSubagentSnapshot | null {
  for (const line of text.split("\n")) {
    const prefixIndex = line.indexOf(PI_SUBAGENTS_ASYNC_WIDGET_PREFIX);
    if (prefixIndex === -1) continue;
    const payload = line.slice(prefixIndex + PI_SUBAGENTS_ASYNC_WIDGET_PREFIX.length).trim();
    if (!payload) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    const snapshot = parseAsyncSnapshot(parsed);
    if (snapshot) return snapshot;
  }
  return null;
}

function parseAsyncSnapshot(parsed: unknown): PiSubagentSnapshot | null {
  if (!isRecord(parsed)) return null;
  if (parsed.kind !== PI_SUBAGENTS_ASYNC_SNAPSHOT_KIND) return null;
  if (parsed.version !== PI_SUBAGENTS_ASYNC_SNAPSHOT_VERSION) return null;
  if (!Array.isArray(parsed.runs)) return null;
  const runs = parsed.runs.map(parseNode).filter((node): node is PiSubagentSnapshotNode => node !== null);
  return {
    kind: PI_SUBAGENTS_ASYNC_SNAPSHOT_KIND,
    version: PI_SUBAGENTS_ASYNC_SNAPSHOT_VERSION,
    generatedAt: parseNumber(parsed.generatedAt) ?? 0,
    runs,
  };
}

/** Depth-first flatten of a snapshot: each run followed by all of its descendants. */
export function flattenPiSubagentSnapshot(snapshot: PiSubagentSnapshot): PiSubagentSnapshotNode[] {
  const flat: PiSubagentSnapshotNode[] = [];
  const walk = (node: PiSubagentSnapshotNode) => {
    flat.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  for (const run of snapshot.runs) walk(run);
  return flat;
}

/** `queued` and `running` are the only states whose progress still changes. */
export function isPiSubagentRunTerminal(state: PiSubagentRunState): boolean {
  return state !== "queued" && state !== "running";
}

/** Run nodes own subagent sessions; `step`/`host-step` children are placeholders. */
function isPiSubagentRunNode(node: PiSubagentSnapshotNode): boolean {
  return node.kind === "subagent" || node.kind === "workflow";
}

/**
 * Whether the sessions list must be refetched for these live runs, recording
 * each transition in the caller's sets so it is reported once.
 *
 * The Agents panel reads its family from the sidebar's list, so a run needs a
 * refetch twice: once when its id first appears live (a session spawned
 * mid-turn is not listed yet), and once more when that same run reaches a
 * terminal state (the spawn-time fetch recorded `relation.status: "running"`,
 * and nothing bumps the list version when a child transcript's meta flips).
 *
 * `startedIds` doubles as the record of runs this client watched live: one
 * that first arrives already terminal was persisted that way and has no stale
 * row to replace. Both sets must outlive the widget's unmount reset, or a
 * remount would re-report an id already handled.
 */
export function trackPiSubagentSessionRefetches(
  runs: readonly PiSubagentSnapshotNode[],
  startedIds: Set<string>,
  terminalIds: Set<string>,
): boolean {
  let refetch = false;
  for (const run of runs) {
    if (!isPiSubagentRunNode(run)) continue;
    if (!isPiSubagentRunTerminal(run.state)) {
      if (startedIds.has(run.id)) continue;
      startedIds.add(run.id);
      refetch = true;
      continue;
    }
    if (!startedIds.has(run.id) || terminalIds.has(run.id)) continue;
    terminalIds.add(run.id);
    refetch = true;
  }
  return refetch;
}

/** True while any run or nested child in the snapshot is non-terminal. */
export function hasLivePiSubagentRun(snapshot: PiSubagentSnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  return flattenPiSubagentSnapshot(snapshot).some((node) => !isPiSubagentRunTerminal(node.state));
}
