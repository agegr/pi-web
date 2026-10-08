import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { isValidCron, nextCronTime, parseCron } from "./schedule-cron";

/**
 * Scheduled tasks: a prompt, a working directory, a cron (or one-shot) time, and
 * the session a run produced.
 *
 * Runs go through the ordinary agent API so each one is a normal session the user
 * can open, resume and branch from — that is the whole point of storing this here
 * rather than shelling out to a script whose output nobody can find.
 */

export interface ScheduledTask {
  id: string;
  /** What to send as the first prompt of the run. */
  prompt: string;
  /** Directory the run starts in; also the session's project grouping. */
  cwd: string;
  /** 5-field cron expression. Ignored when `runOnce` is set. */
  cron: string;
  /** Human-readable schedule, for the UI. */
  summary: string;
  /** Absolute ISO time for a one-shot task; null for recurring tasks. */
  runOnceAt: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  /** When the scheduler last started a run. */
  lastRunAt: string | null;
  /** Session id the last run created, so the UI can link straight to it. */
  lastSessionId: string | null;
  /** Why the last run failed, if it did. Cleared on success. */
  lastError: string | null;
  /** How many times this task has run. */
  runCount: number;
  /** Optional model override, as `provider/modelId`. */
  model: string | null;
}

export interface NewScheduledTask {
  prompt: string;
  cwd: string;
  cron?: string;
  summary?: string;
  runOnceAt?: string | null;
  enabled?: boolean;
  model?: string | null;
}

export function getScheduleStorePath(agentDir = getAgentDir()): string {
  return join(agentDir, "schedules.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function parseTask(raw: unknown): ScheduledTask | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id).trim();
  const prompt = readString(raw.prompt);
  const cwd = readString(raw.cwd).trim();
  if (!id || !prompt.trim() || !cwd) return null;
  const cron = readString(raw.cron, "* * * * *");
  const runOnceAt = readNullableString(raw.runOnceAt);
  // A recurring task with an unparsable expression can never fire; keep the row
  // but leave it inert rather than throwing away the user's text.
  const scheduleOk = runOnceAt !== null || isValidCron(cron);
  return {
    id,
    prompt,
    cwd,
    cron,
    summary: readString(raw.summary) || (runOnceAt ? `仅一次 ${runOnceAt}` : cron),
    runOnceAt,
    enabled: raw.enabled === true && scheduleOk,
    createdAt: readString(raw.createdAt, new Date().toISOString()),
    updatedAt: readString(raw.updatedAt, new Date().toISOString()),
    lastRunAt: readNullableString(raw.lastRunAt),
    lastSessionId: readNullableString(raw.lastSessionId),
    lastError: readNullableString(raw.lastError),
    runCount: typeof raw.runCount === "number" && raw.runCount >= 0 ? Math.floor(raw.runCount) : 0,
    model: readNullableString(raw.model),
  };
}

function readStore(path: string): ScheduledTask[] {
  if (!existsSync(path)) return [];
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) {
    // Tolerate an empty or half-written file: an unreadable schedules file must
    // not take the whole Settings panel down with it.
    if (isRecord(parsed) && parsed.tasks === undefined) return [];
    throw new Error("Invalid schedules.json: expected { tasks: [...] }");
  }
  return parsed.tasks.map(parseTask).filter((task): task is ScheduledTask => task !== null);
}

function writeStore(path: string, tasks: ScheduledTask[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writePrivateFileAtomicSync(path, JSON.stringify({ version: 1, tasks }, null, 2));
}

export function listSchedules(storePath = getScheduleStorePath()): ScheduledTask[] {
  try {
    return readStore(storePath);
  } catch {
    return [];
  }
}

export function getSchedule(id: string, storePath = getScheduleStorePath()): ScheduledTask | null {
  return listSchedules(storePath).find((task) => task.id === id) ?? null;
}

export function createSchedule(input: NewScheduledTask, storePath = getScheduleStorePath()): ScheduledTask {
  const prompt = input.prompt?.trim();
  const cwd = input.cwd?.trim();
  if (!prompt) throw new Error("prompt is required");
  if (!cwd) throw new Error("cwd is required");

  const runOnceAt = input.runOnceAt ? new Date(input.runOnceAt).toISOString() : null;
  const cron = (input.cron ?? "").trim();
  if (!runOnceAt && !isValidCron(cron)) {
    throw new Error(`Invalid cron expression: ${cron || "(empty)"}`);
  }
  if (runOnceAt && Number.isNaN(Date.parse(runOnceAt))) {
    throw new Error(`Invalid runOnceAt: ${input.runOnceAt}`);
  }

  const now = new Date().toISOString();
  const task: ScheduledTask = {
    id: randomUUID(),
    prompt,
    cwd,
    cron: runOnceAt ? "0 0 * * *" : cron,
    summary: input.summary?.trim() || (runOnceAt ? `仅一次 ${runOnceAt}` : cron),
    runOnceAt,
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    lastSessionId: null,
    lastError: null,
    runCount: 0,
    model: input.model ?? null,
  };
  const tasks = listSchedules(storePath);
  tasks.push(task);
  writeStore(storePath, tasks);
  return task;
}

export function updateSchedule(
  id: string,
  patch: Partial<NewScheduledTask> & { enabled?: boolean },
  storePath = getScheduleStorePath(),
): ScheduledTask {
  const tasks = listSchedules(storePath);
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) throw new Error(`No such schedule: ${id}`);
  const current = tasks[index];

  if (patch.cron !== undefined && !isValidCron(patch.cron)) {
    throw new Error(`Invalid cron expression: ${patch.cron}`);
  }
  const runOnceAt = patch.runOnceAt === undefined
    ? current.runOnceAt
    : patch.runOnceAt === null
      ? null
      : new Date(patch.runOnceAt).toISOString();

  const updated: ScheduledTask = {
    ...current,
    prompt: patch.prompt?.trim() ?? current.prompt,
    cwd: patch.cwd?.trim() ?? current.cwd,
    cron: patch.cron?.trim() ?? current.cron,
    summary: patch.summary?.trim() ?? current.summary,
    runOnceAt,
    enabled: patch.enabled ?? current.enabled,
    model: patch.model === undefined ? current.model : patch.model,
    updatedAt: new Date().toISOString(),
  };
  tasks[index] = updated;
  writeStore(storePath, tasks);
  return updated;
}

export function deleteSchedule(id: string, storePath = getScheduleStorePath()): boolean {
  const tasks = listSchedules(storePath);
  const remaining = tasks.filter((task) => task.id !== id);
  if (remaining.length === tasks.length) return false;
  writeStore(storePath, remaining);
  return true;
}

/**
 * Drop finished one-shot tasks older than `retentionDays`.
 *
 * A spent one-shot task has no future: it cannot fire again, and the run it
 * produced lives on in the session list, which is where the user actually looks
 * for it. Keeping the row only grows `schedules.json` and the sidebar. Repeating
 * tasks are never pruned — they are still doing work.
 *
 * A task that has never run yet is kept regardless of age, so a one-shot set far
 * in the future is not swept away before its moment arrives.
 */
export function pruneFinishedTasks(
  retentionDays: number,
  now: Date = new Date(),
  storePath = getScheduleStorePath(),
): string[] {
  if (!(retentionDays > 0)) return [];
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const tasks = listSchedules(storePath);

  const removed: string[] = [];
  const kept = tasks.filter((task) => {
    const finished = task.runOnceAt !== null && task.runCount > 0;
    if (!finished) return true;
    const stamp = task.lastRunAt ?? task.updatedAt;
    const at = Date.parse(stamp);
    if (Number.isNaN(at)) return true;
    if (at > cutoff) return true;
    removed.push(task.id);
    return false;
  });

  if (removed.length > 0) writeStore(storePath, kept);
  return removed;
}

/** Record the outcome of a run; the scheduler uses this to advance the task. */
export function recordRun(
  id: string,
  outcome: { sessionId?: string | null; error?: string | null; disable?: boolean; at?: Date },
  storePath = getScheduleStorePath(),
): ScheduledTask | null {
  const tasks = listSchedules(storePath);
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) return null;
  const current = tasks[index];
  // `at` is the scheduler's notion of "now". Defaulting to the wall clock is
  // right for real runs and wrong for tests that evaluate a simulated time, so
  // the double-run guard would compare against a minute that never occurred.
  const runAt = (outcome.at ?? new Date()).toISOString();
  const updated: ScheduledTask = {
    ...current,
    lastRunAt: runAt,
    lastSessionId: outcome.sessionId ?? current.lastSessionId,
    lastError: outcome.error ?? null,
    runCount: current.runCount + 1,
    // A one-shot task switches itself off after its single run, successful or
    // not; leaving it enabled would re-fire it on every scheduler tick, since
    // its absolute time is permanently in the past.
    enabled: outcome.disable || current.runOnceAt !== null ? false : current.enabled,
    updatedAt: new Date().toISOString(),
  };
  tasks[index] = updated;
  writeStore(storePath, tasks);
  return updated;
}

/** The next time a task fires, or null when disabled, spent, or unmatchable. */
export function nextRunFor(task: ScheduledTask, from: Date = new Date()): Date | null {
  if (!task.enabled) return null;
  if (task.runOnceAt) {
    const at = new Date(task.runOnceAt);
    if (Number.isNaN(at.getTime())) return null;
    return at.getTime() > from.getTime() ? at : null;
  }
  if (!isValidCron(task.cron)) return null;
  return nextCronTime(task.cron, from);
}

/** True when the task is due at `now` and has not already run in this minute. */
export function isDue(task: ScheduledTask, now: Date = new Date()): boolean {
  if (!task.enabled) return false;

  if (task.runOnceAt) {
    const at = new Date(task.runOnceAt);
    if (Number.isNaN(at.getTime())) return false;
    // Fire once the moment has arrived, even if the process was asleep at the
    // exact second; `lastRunAt` stops a repeat on the next tick.
    if (at.getTime() > now.getTime()) return false;
    return !ranInMinute(task, now, at.getTime());
  }

  if (!isValidCron(task.cron)) return false;
  if (!matchesMinute(task.cron, now)) return false;
  return !ranInMinute(task, now, now.getTime());
}

function ranInMinute(task: ScheduledTask, now: Date, anchorMs: number): boolean {
  if (!task.lastRunAt) return false;
  const last = new Date(task.lastRunAt).getTime();
  if (Number.isNaN(last)) return false;
  // Compare on the whole minute so a run at 09:00:03 suppresses 09:00:41.
  const anchorMinute = Math.floor(anchorMs / 60000);
  return Math.floor(last / 60000) === anchorMinute;
}

function matchesMinute(expression: string, now: Date): boolean {
  const fields = parseCron(expression);
  if (!fields.minutes.has(now.getMinutes())) return false;
  if (!fields.hours.has(now.getHours())) return false;
  if (!fields.months.has(now.getMonth() + 1)) return false;
  const domMatch = fields.daysOfMonth.has(now.getDate());
  const dowMatch = fields.daysOfWeek.has(now.getDay());
  if (fields.domRestricted && fields.dowRestricted) return domMatch || dowMatch;
  if (fields.domRestricted) return domMatch;
  if (fields.dowRestricted) return dowMatch;
  return true;
}
