import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { startRpcSession } from "./rpc-manager";
import { isDue, listSchedules, nextRunFor, pruneFinishedTasks, recordRun } from "./schedule-store";
import type { ScheduledTask } from "./schedule-store";

/**
 * The scheduler: a single interval that wakes up, asks the store which tasks are
 * due, and starts one ordinary agent session per run.
 *
 * Sessions are created in-process through `startRpcSession`, the same entry point
 * `POST /api/agent/new` uses, so a scheduled run appears in the session list and
 * streams its events like any other conversation. Running it from a browser was
 * not an option: the timer must survive the user closing the tab.
 */

const TICK_MS = 30_000;

/**
 * How long a finished one-shot task lingers before it is swept away.
 *
 * Long enough to notice what ran, short enough that the list and
 * `schedules.json` do not grow forever. The run itself is not lost: it lives on
 * as a normal session, which is where the user looks for it anyway.
 */
export const FINISHED_TASK_RETENTION_DAYS = 3;

export interface ScheduleRunnerState {
  started: boolean;
  lastTickAt: string | null;
  lastError: string | null;
  /** Removed finished one-shot tasks, so the sweep is inspectable. */
  lastPrunedAt: string | null;
  prunedCount: number;
}

const state: ScheduleRunnerState = {
  started: false, lastTickAt: null, lastError: null, lastPrunedAt: null, prunedCount: 0,
};
let timer: NodeJS.Timeout | null = null;
/** Guards against a slow run letting the next tick start the same task twice. */
const inFlight = new Set<string>();

export function getScheduleRunnerState(): ScheduleRunnerState {
  return { ...state };
}

/**
 * Start one scheduled run.
 *
 * Exported so the API can offer "run now" and so tests can drive a single run
 * without a timer. Errors are recorded on the task rather than thrown, because a
 * failing prompt must not kill the scheduler for every other task.
 */
export async function runScheduledTask(task: ScheduledTask): Promise<{ sessionId: string | null; error: string | null }> {
  if (inFlight.has(task.id)) return { sessionId: null, error: "已在运行中" };

  if (!existsSync(task.cwd)) {
    const error = `目录不存在：${task.cwd}`;
    recordRun(task.id, { error, disable: true });
    return { sessionId: null, error };
  }

  inFlight.add(task.id);
  try {
    const tempKey = `__sched__${randomUUID()}`;
    const { session, realSessionId } = await startRpcSession(tempKey, "", task.cwd, {});

    const [provider, modelId] = parseModel(task.model);
    await session.send({
      type: "prompt",
      message: task.prompt,
      ...(provider && modelId ? { provider, modelId } : {}),
    });

    recordRun(task.id, { sessionId: realSessionId });
    return { sessionId: realSessionId, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordRun(task.id, { error: message });
    return { sessionId: null, error: message };
  } finally {
    inFlight.delete(task.id);
  }
}

function parseModel(model: string | null): [string | null, string | null] {
  if (!model) return [null, null];
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return [null, null];
  return [model.slice(0, slash), model.slice(slash + 1)];
}

/** One scheduler pass. Returns the ids it started, for logging and tests. */
export async function tickSchedules(now: Date = new Date()): Promise<string[]> {
  const started: string[] = [];
  state.lastTickAt = now.toISOString();
  let tasks: ScheduledTask[];
  try {
    tasks = listSchedules();
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    return started;
  }

  for (const task of tasks) {
    if (!isDue(task, now)) continue;
    const result = await runScheduledTask(task);
    if (result.sessionId) started.push(result.sessionId);
  }

  // Sweep finished one-shot tasks at most once a day. The tick runs every 30s,
  // and re-reading and rewriting the store that often would be pure churn.
  const lastPruned = state.lastPrunedAt ? Date.parse(state.lastPrunedAt) : Number.NaN;
  const dayMs = 24 * 60 * 60 * 1000;
  if (Number.isNaN(lastPruned) || now.getTime() - lastPruned >= dayMs) {
    try {
      const pruned = pruneFinishedTasks(FINISHED_TASK_RETENTION_DAYS, now);
      state.lastPrunedAt = now.toISOString();
      if (pruned.length > 0) state.prunedCount += pruned.length;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return started;
}

export function startScheduleRunner(): void {
  if (state.started || timer) return;
  state.started = true;
  timer = setInterval(() => {
    void tickSchedules().catch((error) => {
      state.lastError = error instanceof Error ? error.message : String(error);
    });
  }, TICK_MS);
  // Deliberately NOT unref'd. An unref'd interval lets the event loop treat the
  // timer as ignorable, so it silently never fires while the process is otherwise
  // idle — the schedule looked started but no run ever happened. The HTTP server
  // keeps the process alive anyway, and `stopScheduleRunner` clears it on
  // shutdown so the interval cannot hold the process open.
}

export function stopScheduleRunner(): void {
  if (timer) clearInterval(timer);
  timer = null;
  state.started = false;
}

/** Upcoming runs across all enabled tasks, soonest first; powers the UI list. */
export function upcomingRuns(limit = 10, from: Date = new Date()): Array<{ task: ScheduledTask; next: string }> {
  const rows: Array<{ task: ScheduledTask; next: string }> = [];
  for (const task of listSchedules()) {
    const next = nextRunFor(task, from);
    if (next) rows.push({ task, next: next.toISOString() });
  }
  rows.sort((a, b) => a.next.localeCompare(b.next));
  return rows.slice(0, limit);
}
