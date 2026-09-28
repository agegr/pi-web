// Read-only reader for pi-subagents' on-disk async run state. The package is a
// user-installed pi extension, not a Pi Web dependency, so we only ever read
// its files — importing the package would couple Pi Web to a version and a
// module format it does not own.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  mapPiSubagentRunState,
  type PiSubagentRunState,
  type PiSubagentRunStatus,
} from "./pi-subagents-snapshot";

export interface PiSubagentRunStep {
  agent: string;
  /** Workflow lane key; the snapshot node id for a materialized step. */
  workflowKey?: string;
  /** Nested child run id; the snapshot node id for a materialized chain step. */
  runId?: string;
  sessionName?: string;
  description?: string;
  sessionFile?: string;
  status: PiSubagentRunState;
  currentTool?: string;
  turnCount?: number;
  toolCount?: number;
  startedAt?: number;
  endedAt?: number;
  lastActivityAt?: number;
  tokens?: number;
}

export interface PiSubagentRun {
  runId: string;
  /** Parent session `.jsonl` path (`AsyncStatus.sessionId`). */
  parentSessionPath?: string;
  mode: string;
  state: PiSubagentRunState;
  status: PiSubagentRunStatus;
  cwd?: string;
  startedAt?: number;
  endedAt?: number;
  lastActivityAt?: number;
  currentTool?: string;
  currentToolStartedAt?: number;
  turnCount?: number;
  toolCount?: number;
  steps: PiSubagentRunStep[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

// The on-disk step vocabulary spells the two ends of the run lifecycle as
// `pending` and `completed`; the package's own projection normalizes them
// before any consumer sees them, so do the same here rather than reading a
// queued or finished step as a failure.
const RUN_STATE_ALIASES: Readonly<Record<string, PiSubagentRunState>> = {
  pending: "queued",
  completed: "complete",
};

function asState(value: unknown): PiSubagentRunState | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = RUN_STATE_ALIASES[value] ?? value;
  return RUN_STATES.has(normalized) ? (normalized as PiSubagentRunState) : undefined;
}

function numericTotal(value: unknown): number | undefined {
  if (isRecord(value)) return asNumber(value.total);
  return asNumber(value);
}

/**
 * Directories holding `async-subagent-runs`: the env override when set,
 * otherwise every `/tmp/pi-subagents-*` scope (the uid/homedir segment varies).
 */
export function resolveTempRoots(
  env: NodeJS.ProcessEnv = process.env,
  tmp: string = tmpdir(),
): string[] {
  const configured = env.PI_SUBAGENTS_TEMP_ROOT?.trim();
  if (configured) return [resolve(configured)];

  let entries: string[];
  try {
    entries = readdirSync(tmp);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.startsWith("pi-subagents-"))
    .map((name) => join(tmp, name))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
}

function parseStep(value: unknown, runState: PiSubagentRunState): PiSubagentRunStep | null {
  if (!isRecord(value)) return null;
  return {
    agent: asString(value.agent) ?? "subagent",
    ...(asString(value.workflowKey) ? { workflowKey: asString(value.workflowKey) } : {}),
    ...(asString(value.runId) ? { runId: asString(value.runId) } : {}),
    ...(asString(value.sessionName) ? { sessionName: asString(value.sessionName) } : {}),
    ...(asString(value.description) ? { description: asString(value.description) } : {}),
    ...(asString(value.sessionFile) ? { sessionFile: asString(value.sessionFile) } : {}),
    status: asState(value.status) ?? runState,
    ...(asString(value.currentTool) ? { currentTool: asString(value.currentTool) } : {}),
    ...(asNumber(value.turnCount) !== undefined ? { turnCount: asNumber(value.turnCount) } : {}),
    ...(asNumber(value.toolCount) !== undefined ? { toolCount: asNumber(value.toolCount) } : {}),
    ...(asNumber(value.startedAt) !== undefined ? { startedAt: asNumber(value.startedAt) } : {}),
    ...(asNumber(value.endedAt) !== undefined ? { endedAt: asNumber(value.endedAt) } : {}),
    ...(asNumber(value.lastActivityAt) !== undefined ? { lastActivityAt: asNumber(value.lastActivityAt) } : {}),
    ...(numericTotal(value.tokens) !== undefined ? { tokens: numericTotal(value.tokens) } : {}),
  };
}

function parseRunStatus(path: string, runId: string): PiSubagentRun | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const state = asState(parsed.state) ?? "failed";
  const steps = Array.isArray(parsed.steps)
    ? parsed.steps.map((step) => parseStep(step, state)).filter((step): step is PiSubagentRunStep => step !== null)
    : [];
  return {
    runId,
    ...(asString(parsed.sessionId) ? { parentSessionPath: asString(parsed.sessionId) } : {}),
    mode: asString(parsed.mode) ?? "single",
    state,
    status: mapPiSubagentRunState(state),
    ...(asString(parsed.cwd) ? { cwd: asString(parsed.cwd) } : {}),
    ...(asNumber(parsed.startedAt) !== undefined ? { startedAt: asNumber(parsed.startedAt) } : {}),
    ...(asNumber(parsed.endedAt) !== undefined ? { endedAt: asNumber(parsed.endedAt) } : {}),
    ...(asNumber(parsed.lastActivityAt) !== undefined ? { lastActivityAt: asNumber(parsed.lastActivityAt) } : {}),
    ...(asString(parsed.currentTool) ? { currentTool: asString(parsed.currentTool) } : {}),
    ...(asNumber(parsed.currentToolStartedAt) !== undefined ? { currentToolStartedAt: asNumber(parsed.currentToolStartedAt) } : {}),
    ...(asNumber(parsed.turnCount) !== undefined ? { turnCount: asNumber(parsed.turnCount) } : {}),
    ...(asNumber(parsed.toolCount) !== undefined ? { toolCount: asNumber(parsed.toolCount) } : {}),
    steps,
  };
}

/** Parse every readable `<runId>/status.json` across all async run roots. */
export function readAsyncRunStatuses(
  options: { env?: NodeJS.ProcessEnv; tmp?: string } = {},
): PiSubagentRun[] {
  const runs: PiSubagentRun[] = [];
  for (const root of resolveTempRoots(options.env, options.tmp)) {
    const runsDir = join(root, "async-subagent-runs");
    if (!existsSync(runsDir)) continue;

    let runIds: string[];
    try {
      runIds = readdirSync(runsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name);
    } catch {
      continue;
    }

    for (const runId of runIds) {
      const statusPath = join(runsDir, runId, "status.json");
      if (!existsSync(statusPath)) continue;
      const run = parseRunStatus(statusPath, runId);
      if (run) runs.push(run);
    }
  }
  return runs;
}

