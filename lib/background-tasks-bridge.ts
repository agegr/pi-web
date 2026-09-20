import { randomUUID } from "crypto";
import type { EventBus, InlineExtension } from "@earendil-works/pi-coding-agent";
import type { BgTaskSnapshot } from "./types";

/**
 * Server-side bridge between pi-web route handlers and the session-scoped
 * `pi-background-tasks` package through its EventBus v1 API.
 *
 * The package (>= 2.5.0) listens on the request channel and answers on the
 * response channel; terminal snapshots are broadcast on the terminal channel.
 * When the package is absent (not installed, chat-only session, subagent
 * session), nothing answers: every request is bounded by a timeout and the
 * bridge reports "unavailable" instead of crashing or hanging.
 */

export const BG_REQUEST_CHANNEL = "pi-background-tasks:request:v1";
export const BG_RESPONSE_CHANNEL = "pi-background-tasks:response:v1";
export const BG_TERMINAL_CHANNEL = "pi-background-tasks:terminal:v1";
export const BG_REQUEST_SCHEMA = "pi-background-tasks.extension-request.v1";
export const BG_RESPONSE_SCHEMA = "pi-background-tasks.extension-response.v1";
export const BG_TERMINAL_SCHEMA = "pi-background-tasks.extension-terminal.v1";

export const BG_TASKS_BRIDGE_EXTENSION_NAME = "pi-web-background-tasks-bridge";

/** The runtime log cap pi-background-tasks enforces (50 KB). */
export const BG_LOGS_MAX_BYTES = 50 * 1024;
export const BG_LOGS_DEFAULT_BYTES = BG_LOGS_MAX_BYTES;

const REQUEST_TIMEOUT_MS = 5_000;
const CAPABILITIES_TIMEOUT_MS = 2_000;
const RUNNING_REFRESH_MS = 5_000;

export const BG_BRIDGE_UNATTACHED_ERROR =
  "pi-background-tasks bridge is not attached (package absent, chat-only session, or extensions not bound)";

const BG_TASK_STATUSES = new Set(["running", "completed", "failed", "killed"]);

export function isBgTaskSnapshot(value: unknown): value is BgTaskSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const task = value as Record<string, unknown>;
  return typeof task.id === "string"
    && task.id.length > 0
    && typeof task.command === "string"
    && typeof task.status === "string"
    && BG_TASK_STATUSES.has(task.status)
    && typeof task.outputPath === "string"
    && typeof task.cwd === "string"
    && typeof task.startTime === "number"
    && typeof task.bytesWritten === "number"
    && typeof task.isAgent === "boolean"
    && typeof task.notified === "boolean"
    && typeof task.notifyOnCompletion === "boolean"
    && typeof task.triggerOnCompletion === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Clamp a client-supplied maxBytes to the bridge's runtime log cap. */
export function clampBgLogBytes(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return BG_LOGS_DEFAULT_BYTES;
  return Math.max(1, Math.min(BG_LOGS_MAX_BYTES, Math.floor(value)));
}

/**
 * Maps an operation error from the package onto an HTTP status: unknown task
 * ids are 404, availability problems are 503, and everything else is a 400.
 */
export function bgOperationFailureStatus(error: string): number {
  if (/not found/i.test(error)) return 404;
  if (
    /unavailable before session_start/i.test(error)
    || /shutting down/i.test(error)
    || /timed out/i.test(error)
    || /bridge is not attached/i.test(error)
  ) return 503;
  return 400;
}

export interface BackgroundTasksBridgeSink {
  /** One task reached a terminal state (deduplicate by task.id). */
  terminal: (task: BgTaskSnapshot) => void;
  /** The full task list changed (derived from a status refresh). */
  update: (tasks: BgTaskSnapshot[]) => void;
}

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type BgBridgeResult<T> = { ok: true; result: T } | { ok: false; error: string };

export interface BgBridgeCapabilities {
  api_version: number;
  status: boolean;
  logs: boolean;
  logs_bounded: boolean;
  kill: boolean;
}

export interface BgBridgeLogs {
  text: string;
  bytesRead: number;
  truncated: boolean;
  tail: boolean;
  path: string;
}

export interface BgBridgeKill {
  task: BgTaskSnapshot;
  message: string;
}

export class BackgroundTasksBridge {
  private events: EventBus | null = null;
  private unsubscribeResponse: (() => void) | null = null;
  private unsubscribeTerminal: (() => void) | null = null;
  private pending = new Map<string, PendingRequest>();
  private sink: BackgroundTasksBridgeSink | null = null;
  private tasks: BgTaskSnapshot[] = [];
  private runningRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRefresh = false;
  private closed = false;
  private capabilitiesProbed = false;
  private capabilitiesProbe: Promise<boolean> | null = null;

  /** True once an extension factory bound this bridge to a live event bus. */
  isAttached(): boolean {
    return !this.closed && this.events !== null;
  }

  /** Late-bound output side (the wrapper emits these as session events). */
  setSink(sink: BackgroundTasksBridgeSink | null): void {
    this.sink = sink;
  }

  /** Called from the inline extension factory with the session's event bus. */
  attach(events: EventBus): void {
    if (this.closed || this.events === events) return;
    this.detachBus();
    this.events = events;
    this.unsubscribeResponse = events.on(BG_RESPONSE_CHANNEL, this.handleResponse);
    this.unsubscribeTerminal = events.on(BG_TERMINAL_CHANNEL, this.handleTerminal);
  }

  /** Drop bus subscriptions and reject every in-flight request. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.detachBus();
    if (this.runningRefreshTimer) {
      clearTimeout(this.runningRefreshTimer);
      this.runningRefreshTimer = null;
    }
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("pi-background-tasks bridge closed"));
    }
    this.pending.clear();
    this.sink = null;
  }

  private detachBus(): void {
    this.unsubscribeResponse?.();
    this.unsubscribeResponse = null;
    this.unsubscribeTerminal?.();
    this.unsubscribeTerminal = null;
    this.events = null;
  }

  hasRunningTasks(): boolean {
    return this.tasks.some((task) => task.status === "running");
  }

  /**
   * Ask the package whether any task is running. The cached list short-circuits
   * (terminal events keep it fresh); otherwise a live status request decides.
   */
  async refreshRunningState(): Promise<boolean> {
    if (!this.isAttached()) return false;
    if (this.hasRunningTasks()) return true;
    const result = await this.listTasks();
    return result.ok && this.hasRunningTasks();
  }

  /**
   * Probe capabilities. A positive result is latched ("probe once before
   * first use"); failures are not latched because the package legitimately
   * rejects requests before session_start.
   */
  probeCapabilities(): Promise<boolean> {
    if (this.capabilitiesProbed) return Promise.resolve(true);
    if (this.capabilitiesProbe) return this.capabilitiesProbe;
    this.capabilitiesProbe = (async () => {
      if (!this.isAttached()) return false;
      try {
        const result = await this.request("capabilities", {}, CAPABILITIES_TIMEOUT_MS);
        const available = isRecord(result)
          && result.api_version === 1
          && result.status === true
          && result.logs === true
          && result.kill === true;
        if (available) this.capabilitiesProbed = true;
        return available;
      } catch {
        return false;
      }
    })().finally(() => {
      this.capabilitiesProbe = null;
    });
    return this.capabilitiesProbe;
  }

  /** status operation with an empty payload; emits an update event on success. */
  async listTasks(): Promise<BgBridgeResult<BgTaskSnapshot[]>> {
    if (!this.isAttached()) return { ok: false, error: BG_BRIDGE_UNATTACHED_ERROR };
    try {
      const result = await this.request("status", {});
      if (!isRecord(result) || !Array.isArray(result.tasks)) {
        return { ok: false, error: "pi-background-tasks returned a malformed status result" };
      }
      this.tasks = result.tasks.filter(isBgTaskSnapshot);
      this.capabilitiesProbed = true;
      this.sink?.update(this.tasks);
      this.scheduleRunningRefresh();
      return { ok: true, result: this.tasks };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  /** logs operation; maxBytes is clamped to the package's runtime cap. */
  async logs(taskId: string, maxBytes?: number, tail = true): Promise<BgBridgeResult<BgBridgeLogs>> {
    if (!this.isAttached()) return { ok: false, error: BG_BRIDGE_UNATTACHED_ERROR };
    const safeTaskId = taskId.trim();
    if (!safeTaskId) return { ok: false, error: "taskId must be a non-empty string" };
    try {
      const result = await this.request("logs", {
        taskId: safeTaskId,
        ...(maxBytes !== undefined ? { maxBytes: clampBgLogBytes(maxBytes) } : {}),
        tail,
      });
      if (!isRecord(result) || typeof result.text !== "string") {
        return { ok: false, error: "pi-background-tasks returned a malformed logs result" };
      }
      const logs: BgBridgeLogs = {
        text: result.text,
        bytesRead: typeof result.bytesRead === "number" ? result.bytesRead : result.text.length,
        truncated: result.truncated === true,
        tail: result.tail === true,
        path: typeof result.path === "string" ? result.path : "",
      };
      if (isBgTaskSnapshot(result.task)) this.upsertTask(result.task);
      return { ok: true, result: logs };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  /** kill operation; already-terminal tasks surface the package's error. */
  async kill(taskId: string): Promise<BgBridgeResult<BgBridgeKill>> {
    if (!this.isAttached()) return { ok: false, error: BG_BRIDGE_UNATTACHED_ERROR };
    const safeTaskId = taskId.trim();
    if (!safeTaskId) return { ok: false, error: "taskId must be a non-empty string" };
    try {
      const result = await this.request("kill", { taskId: safeTaskId });
      if (!isRecord(result) || !isBgTaskSnapshot(result.task) || typeof result.message !== "string") {
        return { ok: false, error: "pi-background-tasks returned a malformed kill result" };
      }
      this.upsertTask(result.task);
      void this.listTasks();
      return { ok: true, result: { task: result.task, message: result.message } };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private request(
    operation: "capabilities" | "status" | "logs" | "kill",
    payload: Record<string, unknown>,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    if (!this.events) return Promise.reject(new Error(BG_BRIDGE_UNATTACHED_ERROR));
    const requestId = `pi-web-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`pi-background-tasks ${operation} request timed out`));
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        timer,
      });
      try {
        this.events!.emit(BG_REQUEST_CHANNEL, {
          schema_version: BG_REQUEST_SCHEMA,
          request_id: requestId,
          operation,
          payload,
        });
      } catch (error) {
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleResponse = (data: unknown): void => {
    if (!isRecord(data)) return;
    const requestId = data.request_id;
    if (typeof requestId !== "string" || requestId.length === 0) return;
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    if (data.schema_version !== undefined && data.schema_version !== BG_RESPONSE_SCHEMA) return;
    if (data.ok === true) {
      entry.resolve(data.result);
      return;
    }
    const error = typeof data.error === "string" && data.error.trim().length > 0
      ? data.error
      : "pi-background-tasks request failed";
    entry.reject(new Error(error));
  };

  private handleTerminal = (data: unknown): void => {
    if (this.closed) return;
    if (!isRecord(data) || data.schema_version !== BG_TERMINAL_SCHEMA) return;
    if (!isBgTaskSnapshot(data.task)) return;
    const task = data.task;
    this.upsertTask(task);
    this.sink?.terminal(task);
    this.scheduleRefresh();
  };

  private upsertTask(task: BgTaskSnapshot): void {
    const index = this.tasks.findIndex((existing) => existing.id === task.id);
    if (index === -1) this.tasks = [...this.tasks, task];
    else this.tasks = [...this.tasks.slice(0, index), task, ...this.tasks.slice(index + 1)];
  }

  /** Refresh the derived task list shortly after a terminal event. */
  private scheduleRefresh(): void {
    if (this.pendingRefresh || this.closed || !this.isAttached()) return;
    this.pendingRefresh = true;
    setTimeout(() => {
      this.pendingRefresh = false;
      if (this.closed || !this.isAttached()) return;
      void this.listTasks();
    }, 0);
  }

  /** While at least one task is running, keep the snapshot list fresh. */
  private scheduleRunningRefresh(): void {
    if (this.runningRefreshTimer || this.closed || !this.hasRunningTasks()) return;
    this.runningRefreshTimer = setTimeout(() => {
      this.runningRefreshTimer = null;
      if (this.closed || !this.isAttached()) return;
      void this.listTasks();
    }, RUNNING_REFRESH_MS);
  }
}

/**
 * Inline extension that binds a BackgroundTasksBridge to the session's shared
 * event bus. Registered alongside the subagent extension in startRpcSession();
 * chat-only and subagent sessions never load it, so their bridges stay
 * unattached and report "unavailable" instead of failing.
 */
export function createBackgroundTasksBridgeExtension(bridge: BackgroundTasksBridge): InlineExtension {
  return {
    name: BG_TASKS_BRIDGE_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      bridge.attach(pi.events);
    },
  };
}
