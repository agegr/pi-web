import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Cron } from "croner";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { registerSessionLivenessProvider } from "./session-liveness";

// Scheduled prompts: the `schedule_prompt` tool, brought in from the
// `pi-schedule-prompt` extension (https://github.com/tintinweb/pi-schedule-prompt).
// Jobs live in `<cwd>/.pi/schedule-prompts.json`, the same file and shape the
// extension writes, so existing jobs carry over. Pi Web has no TUI widget or
// `/schedule-prompt` command: Settings › Scheduled prompts lists and cancels jobs.
// Jobs that name a `model` (the extension's subagent mode) are not supported.

export const SCHEDULED_PROMPTS_EXTENSION_NAME = "pi-web-scheduled-prompts";
export const SCHEDULE_PROMPT_TOOL_NAME = "schedule_prompt";
export const SCHEDULED_PROMPT_MESSAGE_TYPE = "scheduled_prompt";
const STORE_FILE = "schedule-prompts.json";
const MIN_ONCE_DELAY_MS = 5_000;

export type ScheduledJobType = "cron" | "once" | "interval";
export type ScheduledJobScope = "session" | "workdir";

export interface ScheduledJob {
  id: string;
  name: string;
  /** Cron expression, ISO timestamp, or interval text such as `5m`. */
  schedule: string;
  prompt: string;
  enabled: boolean;
  type: ScheduledJobType;
  intervalMs?: number;
  createdAt: string;
  lastRun?: string;
  lastStatus?: "success" | "error" | "running";
  nextRun?: string;
  runCount: number;
  description?: string;
  /** The session that fires the job. Absent: every session in the cwd fires it. */
  session?: string;
}

interface ScheduleStore {
  jobs: ScheduledJob[];
  version: number;
}

/** What Settings shows for one active job. */
export interface ActiveScheduledJob {
  id: string;
  name: string;
  schedule: string;
  scheduleText: string;
  type: ScheduledJobType;
  prompt: string;
  description?: string;
  cwd: string;
  /** Sessions that currently fire the job. */
  sessionIds: string[];
  boundToSession: boolean;
  runCount: number;
  lastRun?: string;
  lastStatus?: ScheduledJob["lastStatus"];
  nextRun?: string;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export class ScheduleStorage {
  private readonly dir: string;
  private readonly path: string;

  constructor(cwd: string) {
    this.dir = join(cwd, ".pi");
    this.path = join(this.dir, STORE_FILE);
  }

  load(): ScheduleStore {
    try {
      if (existsSync(this.path)) {
        const parsed: unknown = JSON.parse(readFileSync(this.path, "utf8"));
        if (parsed && typeof parsed === "object" && Array.isArray((parsed as ScheduleStore).jobs)) {
          return { ...(parsed as ScheduleStore), version: 1 };
        }
      }
    } catch (error) {
      console.error("[pi-web] failed to read scheduled prompts:", error instanceof Error ? error.message : error);
    }
    return { jobs: [], version: 1 };
  }

  private save(store: ScheduleStore): void {
    mkdirSync(this.dir, { recursive: true });
    writePrivateFileAtomicSync(this.path, JSON.stringify(store, null, 2));
  }

  all(): ScheduledJob[] {
    return this.load().jobs;
  }

  get(id: string): ScheduledJob | undefined {
    return this.all().find((job) => job.id === id);
  }

  hasName(name: string): boolean {
    return this.all().some((job) => job.name === name);
  }

  add(job: ScheduledJob): void {
    const store = this.load();
    store.jobs.push(job);
    this.save(store);
  }

  remove(id: string): boolean {
    const store = this.load();
    const jobs = store.jobs.filter((job) => job.id !== id);
    if (jobs.length === store.jobs.length) return false;
    this.save({ ...store, jobs });
    return true;
  }

  update(id: string, partial: Partial<ScheduledJob>): boolean {
    const store = this.load();
    const job = store.jobs.find((entry) => entry.id === id);
    if (!job) return false;
    Object.assign(job, partial);
    this.save(store);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Schedule parsing
// ---------------------------------------------------------------------------

type ValidatedSchedule =
  | { ok: true; schedule: string; intervalMs?: number }
  | { ok: false; error: string };

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseIntervalMs(text: string): number | null {
  const match = text.trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) return null;
  const value = Number(match[1]) * UNIT_MS[match[2].toLowerCase()];
  return value > 0 ? value : null;
}

/** `+10s`, `+5m`, `+1h`, `+2d` to an ISO timestamp from now. */
export function parseRelativeTime(text: string, now = Date.now()): string | null {
  const match = text.trim().match(/^\+(\d+)\s*([smhd])$/i);
  if (!match) return null;
  return new Date(now + Number(match[1]) * UNIT_MS[match[2].toLowerCase()]).toISOString();
}

export function validateSchedule(type: ScheduledJobType, schedule: string, now = Date.now()): ValidatedSchedule {
  if (type === "interval") {
    const intervalMs = parseIntervalMs(schedule);
    if (!intervalMs) return { ok: false, error: `Invalid interval: ${schedule}. Use a form like '30s', '5m', '1h'.` };
    return { ok: true, schedule, intervalMs };
  }
  if (type === "once") {
    const relative = parseRelativeTime(schedule, now);
    if (relative) return { ok: true, schedule: relative };
    const date = new Date(schedule);
    if (Number.isNaN(date.getTime())) {
      return { ok: false, error: `Invalid timestamp: ${schedule}. Use ISO format or a relative time like '+10s', '+5m'.` };
    }
    const delay = date.getTime() - now;
    if (delay < 0) return { ok: false, error: `Timestamp is in the past: ${date.toISOString()}.` };
    if (delay < MIN_ONCE_DELAY_MS) {
      return { ok: false, error: `Timestamp is too soon (${Math.round(delay / 1000)}s). Use a relative time like '+${Math.ceil(delay / 1000)}s', or at least 5s ahead.` };
    }
    return { ok: true, schedule: date.toISOString() };
  }
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 6) {
    return { ok: false, error: `Cron expression must have 6 fields (second minute hour day month weekday), got ${fields.length}. Example: "0 * * * * *" is every minute.` };
  }
  try {
    new Cron(schedule, () => {}).stop();
    return { ok: true, schedule };
  } catch (error) {
    return { ok: false, error: `Invalid cron expression: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function describeSchedule(type: ScheduledJobType, schedule: string): string {
  if (type === "interval") return `every ${schedule}`;
  if (type === "once") {
    const date = new Date(schedule);
    return Number.isNaN(date.getTime()) ? schedule : date.toLocaleString();
  }
  return schedule;
}

// ---------------------------------------------------------------------------
// Scheduler (one per session)
// ---------------------------------------------------------------------------

export interface SchedulerHost {
  sendMessage: ExtensionAPI["sendMessage"];
  sendUserMessage: ExtensionAPI["sendUserMessage"];
}

export function isLoadedFor(job: ScheduledJob, sessionId: string): boolean {
  return !job.session || job.session === sessionId;
}

export class PromptScheduler {
  private readonly crons = new Map<string, Cron>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>>();

  constructor(
    readonly cwd: string,
    readonly sessionId: string,
    private readonly storage: ScheduleStorage,
    private readonly host: SchedulerHost,
  ) {}

  /** Schedule this session's enabled jobs. Clears a `running` flag a killed process left behind. */
  start(): void {
    for (const job of this.storage.all()) {
      if (!isLoadedFor(job, this.sessionId)) continue;
      if (job.lastStatus === "running") this.storage.update(job.id, { lastStatus: undefined });
      if (job.enabled) this.schedule(job);
    }
  }

  stop(): void {
    for (const cron of this.crons.values()) cron.stop();
    this.crons.clear();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  add(job: ScheduledJob): void {
    if (job.enabled) this.schedule(job);
  }

  unschedule(id: string): void {
    this.crons.get(id)?.stop();
    this.crons.delete(id);
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }

  update(job: ScheduledJob): void {
    this.unschedule(job.id);
    if (job.enabled) this.schedule(job);
  }

  isScheduled(id: string): boolean {
    return this.crons.has(id) || this.timers.has(id);
  }

  nextRun(id: string): Date | null {
    return this.crons.get(id)?.nextRun() ?? null;
  }

  /** Whether an enabled job of this session is waiting to fire or is firing. */
  hasActiveJobs(): boolean {
    return this.storage.all().some((job) =>
      isLoadedFor(job, this.sessionId) && (job.lastStatus === "running" || (job.enabled && this.isScheduled(job.id))));
  }

  private schedule(job: ScheduledJob): void {
    try {
      if (job.type === "interval" && job.intervalMs) {
        this.timers.set(job.id, setInterval(() => this.fire(job.id), job.intervalMs));
      } else if (job.type === "once") {
        const delay = new Date(job.schedule).getTime() - Date.now();
        if (delay > 0) {
          this.timers.set(job.id, setTimeout(() => {
            this.timers.delete(job.id);
            this.fire(job.id);
            // A one-shot is spent once it fires.
            this.storage.update(job.id, { enabled: false });
          }, delay));
        } else {
          this.storage.update(job.id, { enabled: false, lastStatus: "error" });
        }
      } else {
        this.crons.set(job.id, new Cron(job.schedule, () => this.fire(job.id)));
      }
    } catch (error) {
      console.error(`[pi-web] failed to schedule prompt ${job.id}:`, error instanceof Error ? error.message : error);
    }
  }

  private fire(id: string): void {
    // Read again: the job may have been removed, disabled, or rebound since it was scheduled.
    const job = this.storage.get(id);
    if (!job?.enabled || !isLoadedFor(job, this.sessionId)) return;
    try {
      this.storage.update(id, { lastStatus: "running" });
      // A visible marker only. Its content stays out of the model context: the prompt
      // reaches the model once, through sendUserMessage below.
      this.host.sendMessage({
        customType: SCHEDULED_PROMPT_MESSAGE_TYPE,
        content: [{ type: "text", text: `🕐 Scheduled: ${job.name}` }],
        display: true,
        details: { jobId: job.id, jobName: job.name, prompt: job.prompt },
      });
      this.host.sendUserMessage(job.prompt, { deliverAs: "followUp" });
      this.storage.update(id, {
        lastRun: new Date().toISOString(),
        lastStatus: "success",
        runCount: (this.storage.get(id)?.runCount ?? job.runCount) + 1,
        nextRun: this.nextRun(id)?.toISOString(),
      });
    } catch (error) {
      console.error(`[pi-web] scheduled prompt ${id} failed:`, error instanceof Error ? error.message : error);
      this.storage.update(id, { lastRun: new Date().toISOString(), lastStatus: "error" });
    }
  }
}

// ---------------------------------------------------------------------------
// Registry of live schedulers, shared by sessions and the Settings API
// ---------------------------------------------------------------------------

const REGISTRY_KEY = Symbol.for("@agegr/pi-web/scheduled-prompts/v1");

function registry(): Map<string, PromptScheduler> {
  const holder = globalThis as unknown as Record<symbol, Map<string, PromptScheduler> | undefined>;
  return (holder[REGISTRY_KEY] ??= new Map());
}

/** Enabled jobs that a live session will fire, one entry per job. */
export function listActiveScheduledJobs(): ActiveScheduledJob[] {
  const byKey = new Map<string, ActiveScheduledJob>();
  for (const scheduler of registry().values()) {
    const jobs = new ScheduleStorage(scheduler.cwd).all();
    for (const job of jobs) {
      if (!job.enabled || !isLoadedFor(job, scheduler.sessionId) || !scheduler.isScheduled(job.id)) continue;
      const key = `${scheduler.cwd}\n${job.id}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.sessionIds.push(scheduler.sessionId);
        continue;
      }
      byKey.set(key, {
        id: job.id,
        name: job.name,
        schedule: job.schedule,
        scheduleText: describeSchedule(job.type, job.schedule),
        type: job.type,
        prompt: job.prompt,
        ...(job.description ? { description: job.description } : {}),
        cwd: scheduler.cwd,
        sessionIds: [scheduler.sessionId],
        boundToSession: Boolean(job.session),
        runCount: job.runCount,
        ...(job.lastRun ? { lastRun: job.lastRun } : {}),
        ...(job.lastStatus ? { lastStatus: job.lastStatus } : {}),
        ...((scheduler.nextRun(job.id)?.toISOString() ?? job.nextRun) ? { nextRun: scheduler.nextRun(job.id)?.toISOString() ?? job.nextRun } : {}),
      });
    }
  }
  return [...byKey.values()].sort((a, b) => (a.nextRun ?? "￿").localeCompare(b.nextRun ?? "￿"));
}

/** Delete a job from its project file and stop every live session that fires it. */
export function cancelScheduledJob(cwd: string, jobId: string): boolean {
  const removed = new ScheduleStorage(cwd).remove(jobId);
  for (const scheduler of registry().values()) {
    if (scheduler.cwd === cwd) scheduler.unschedule(jobId);
  }
  return removed;
}

/** Stop all timers, as when the feature is switched off. Jobs stay in their files. */
export function stopAllScheduledPrompts(): void {
  for (const scheduler of registry().values()) scheduler.stop();
}

// ---------------------------------------------------------------------------
// Tool and extension
// ---------------------------------------------------------------------------

const Params = Type.Object({
  action: StringEnum(["add", "remove", "list", "enable", "disable", "update", "cleanup"], { description: "Action to perform" }),
  name: Type.Optional(Type.String({ description: "Job name, generated if omitted" })),
  schedule: Type.Optional(Type.String({ description: "Required for add. 6-field cron expression, ISO timestamp, relative time (+10s, +5m), or interval (5m, 1h)." })),
  prompt: Type.Optional(Type.String({ description: "Required for add. The prompt to send to this session when the job fires." })),
  jobId: Type.Optional(Type.String({ description: "Job ID for remove, enable, disable, or update" })),
  type: Type.Optional(StringEnum(["cron", "once", "interval"], { description: "Job type. Use 'once' for relative or ISO times. Default is cron." })),
  description: Type.Optional(Type.String({ description: "Optional job description" })),
  scope: Type.Optional(StringEnum(["session", "workdir"], { description: "'session' (default): only this session fires the job. 'workdir': every session in this working directory fires it." })),
});

const DESCRIPTION =
  "Schedule prompts at times or intervals; each one is sent to this session when it fires. For action='add' you MUST give both 'schedule' and 'prompt'. "
  + "Schedule formats: 6-field cron with seconds ('0 * * * * *' is every minute), ISO timestamp, relative time (+10s, +5m, +1h), or interval (5m, 1h). "
  + "Type defaults to 'cron'; use 'once' for relative or ISO times. Actions: add (schedule+prompt), list, remove/enable/disable/update (jobId), cleanup (remove disabled jobs).";

function text(value: string, isError = false) {
  return { content: [{ type: "text" as const, text: value }], details: undefined, ...(isError ? { isError: true } : {}) };
}

function formatJob(job: ScheduledJob, next: Date | null): string {
  return [
    `${job.enabled ? "✓" : "✗"} ${job.name} (${job.id})`,
    `  Type: ${job.type} | Schedule: ${job.schedule} | Scope: ${job.session ? "session" : "workdir"}`,
    `  Prompt: ${job.prompt}`,
    `  ${job.lastRun ? `Last: ${job.lastRun}` : "Never run"}${next ? ` | Next: ${next.toISOString()}` : ""}`,
    `  Runs: ${job.runCount} | Status: ${job.lastStatus ?? "pending"}`,
    ...(job.description ? [`  Description: ${job.description}`] : []),
  ].join("\n");
}

export type ScheduledPromptsEnabledProvider = () => boolean;

export function createScheduledPromptsExtension(isEnabled: ScheduledPromptsEnabledProvider = () => true): InlineExtension {
  return {
    name: SCHEDULED_PROMPTS_EXTENSION_NAME,
    factory: async (pi) => {
      if (!isEnabled()) return;
      let scheduler: PromptScheduler | undefined;
      let storage: ScheduleStorage | undefined;
      let releaseLiveness: (() => void) | undefined;

      const teardown = () => {
        releaseLiveness?.();
        releaseLiveness = undefined;
        if (scheduler) {
          scheduler.stop();
          if (registry().get(scheduler.sessionId) === scheduler) registry().delete(scheduler.sessionId);
        }
        scheduler = undefined;
        storage = undefined;
      };

      // Idempotent: session_start also fires on reload, resume, and fork.
      const initialize = (ctx: { cwd: string; sessionManager: { getSessionId(): string } }) => {
        teardown();
        const sessionId = ctx.sessionManager.getSessionId();
        storage = new ScheduleStorage(ctx.cwd);
        const created = new PromptScheduler(ctx.cwd, sessionId, storage, pi);
        scheduler = created;
        created.start();
        registry().set(sessionId, created);
        // A session with live schedules must not be evicted as idle.
        releaseLiveness = registerSessionLivenessProvider({
          name: SCHEDULED_PROMPTS_EXTENSION_NAME,
          sessionId,
          isActive: () => created.hasActiveJobs(),
        });
      };

      pi.on("session_start", (_event, ctx) => initialize(ctx));
      pi.on("session_shutdown", () => teardown());

      pi.registerTool(defineTool({
        name: SCHEDULE_PROMPT_TOOL_NAME,
        label: "Schedule Prompt",
        description: DESCRIPTION,
        promptSnippet: "Schedule a prompt to be sent to this session later or on a recurring schedule",
        parameters: Params,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          if (!scheduler || !storage) initialize(ctx);
          const active = scheduler!;
          const store = storage!;
          const sessionId = ctx.sessionManager.getSessionId();
          try {
            switch (params.action) {
              case "add": {
                // A fired prompt must not schedule more prompts, or one mistake loops forever.
                const recent = ctx.sessionManager.getEntries().slice(-10);
                if (recent.some((entry) => entry.type === "custom_message" && entry.customType === SCHEDULED_PROMPT_MESSAGE_TYPE)) {
                  throw new Error("Cannot create scheduled prompts from within a scheduled prompt execution. This prevents infinite loops.");
                }
                if (!params.schedule || !params.prompt) {
                  throw new Error("Missing required parameters for add: provide both 'schedule' (for example '+10m' or '0 0 9 * * *') and 'prompt'.");
                }
                const name = params.name || `job-${randomBytes(3).toString("hex")}`;
                if (store.hasName(name)) throw new Error(`A job named "${name}" already exists. Use another name or remove it first.`);
                const type = (params.type ?? "cron") as ScheduledJobType;
                const validated = validateSchedule(type, params.schedule);
                if (!validated.ok) throw new Error(validated.error);
                const job: ScheduledJob = {
                  id: randomBytes(5).toString("hex"),
                  name,
                  schedule: validated.schedule,
                  prompt: params.prompt,
                  enabled: true,
                  type,
                  ...(validated.intervalMs ? { intervalMs: validated.intervalMs } : {}),
                  createdAt: new Date().toISOString(),
                  runCount: 0,
                  ...(params.description ? { description: params.description } : {}),
                  ...(params.scope === "workdir" ? {} : { session: sessionId }),
                };
                store.add(job);
                active.add(job);
                return text(`✓ Created scheduled prompt "${job.name}" (${job.id})\nType: ${job.type}\nSchedule: ${job.schedule}\nPrompt: ${job.prompt}`);
              }
              case "remove": {
                if (!params.jobId) throw new Error("jobId is required for remove");
                const job = store.get(params.jobId);
                if (!job) throw new Error(`Job not found: ${params.jobId}`);
                cancelScheduledJob(ctx.cwd, job.id);
                return text(`✓ Removed scheduled prompt "${job.name}" (${job.id})`);
              }
              case "enable":
              case "disable": {
                if (!params.jobId) throw new Error(`jobId is required for ${params.action}`);
                const job = store.get(params.jobId);
                if (!job) throw new Error(`Job not found: ${params.jobId}`);
                const enabled = params.action === "enable";
                store.update(job.id, { enabled });
                active.update({ ...job, enabled });
                return text(`✓ ${enabled ? "Enabled" : "Disabled"} scheduled prompt "${job.name}" (${job.id})`);
              }
              case "update": {
                if (!params.jobId) throw new Error("jobId is required for update");
                const job = store.get(params.jobId);
                if (!job) throw new Error(`Job not found: ${params.jobId}`);
                const updates: Partial<ScheduledJob> = {};
                if (params.name) updates.name = params.name;
                if (params.prompt) updates.prompt = params.prompt;
                if (params.description !== undefined) updates.description = params.description;
                if (params.schedule) {
                  const validated = validateSchedule(job.type, params.schedule);
                  if (!validated.ok) throw new Error(validated.error);
                  updates.schedule = validated.schedule;
                  if (validated.intervalMs !== undefined) updates.intervalMs = validated.intervalMs;
                }
                store.update(job.id, updates);
                active.update({ ...job, ...updates });
                return text(`✓ Updated scheduled prompt "${updates.name ?? job.name}" (${job.id})`);
              }
              case "cleanup": {
                const disabled = store.all().filter((job) => !job.enabled && isLoadedFor(job, sessionId));
                for (const job of disabled) cancelScheduledJob(ctx.cwd, job.id);
                return text(disabled.length === 0
                  ? "No disabled jobs to clean up"
                  : `✓ Removed ${disabled.length} disabled job(s):\n${disabled.map((job) => `  - ${job.name} (${job.id})`).join("\n")}`);
              }
              case "list": {
                const jobs = store.all().filter((job) => isLoadedFor(job, sessionId));
                if (jobs.length === 0) return text("No scheduled prompts.");
                return text(["Scheduled prompts:", "", ...jobs.map((job) => formatJob(job, active.nextRun(job.id)))].join("\n\n"));
              }
              default:
                throw new Error(`Unknown action: ${String(params.action)}`);
            }
          } catch (error) {
            return text(`✗ Error: ${error instanceof Error ? error.message : String(error)}`, true);
          }
        },
      }));
    },
  };
}

/** Keep Pi Web's integrated implementation when the `pi-schedule-prompt` package is also loaded. */
export function preferPiWebScheduledPromptsExtension<T extends { extensions: { path: string; sourceInfo?: { source?: string }; tools: Map<string, unknown> }[]; errors: { path: string; error: string }[] }>(base: T): T {
  const hostPath = `<inline:${SCHEDULED_PROMPTS_EXTENSION_NAME}>`;
  const host = base.extensions.find((extension) => extension.path === hostPath);
  if (!host?.tools.has(SCHEDULE_PROMPT_TOOL_NAME)) return base;
  const legacyPaths = new Set(base.extensions
    .filter((extension) => extension.path !== hostPath && extension.tools.has(SCHEDULE_PROMPT_TOOL_NAME))
    .filter((extension) => {
      const source = (extension.sourceInfo?.source ?? "").replace(/^npm:/, "").split("@")[0];
      return source === "pi-schedule-prompt"
        || extension.path.replaceAll("\\", "/").split("/").includes("pi-schedule-prompt");
    })
    .map((extension) => extension.path));
  if (legacyPaths.size === 0) return base;
  return {
    ...base,
    extensions: base.extensions.filter((extension) => !legacyPaths.has(extension.path)),
    errors: base.errors.filter((error) => {
      if (legacyPaths.has(error.path)) return false;
      if (error.path !== hostPath) return true;
      return ![...legacyPaths].some((legacyPath) => error.error === `Tool "${SCHEDULE_PROMPT_TOOL_NAME}" conflicts with ${legacyPath}`);
    }),
  };
}
