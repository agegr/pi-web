import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "crypto";

// ============================================================================
// Protocol constants (mirrors the pi-subagents extension RPC v1 surface).
// The web app is deliberately a narrow client: it never exposes spawn or the
// hard stop method.
// ============================================================================

const PROTOCOL_VERSION = 1;
const REQUEST_EVENT = "subagents:rpc:v1:request";
const REPLY_EVENT_PREFIX = "subagents:rpc:v1:reply:";
export const SUBAGENT_RPC_TIMEOUT_MS = 3_000;
export const SUBAGENT_RPC_NEGATIVE_CACHE_TTL_MS = 5_000;
const MAX_RUN_ENTRIES = 512;

export type SubagentRpcMethod = "ping" | "status" | "steer" | "interrupt" | "resume";
export type SubagentRpcStage = "ping" | "status" | "control";

export type SubagentRpcRunState =
  | "queued"
  | "running"
  | "paused"
  | "complete"
  | "failed"
  | "stopped"
  | "rejected";

export interface SubagentRpcRunEntry {
  runId: string;
  index?: number;
  parentRunId?: string;
  parentIndex?: number;
  agent: string;
  label?: string;
  state: SubagentRpcRunState;
  activityState?: string;
  currentTool?: string;
  currentPath?: string;
  startedAt?: number;
  lastActivityAt?: number;
  endedAt?: number;
  updatedAt: number;
}

export interface SubagentRpcRunStatus {
  version: 1;
  entries: SubagentRpcRunEntry[];
  total: number;
  omitted: number;
}

export interface EventBusLike {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}

/** Mutable capture filled by the hidden inline extension when resources load. */
export interface SubagentRpcCapture {
  events: EventBusLike | null;
}

export class SubagentRpcError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly stage: SubagentRpcStage,
  ) {
    super(message);
    this.name = "SubagentRpcError";
  }
}

/**
 * Creates the hidden inline extension that captures the parent session's
 * public `pi.events` bus. The extension registers no tool, command, prompt,
 * widget, or UI; it only records the bus for the RPC client.
 */
export function createSubagentRpcCapture(): {
  capture: SubagentRpcCapture;
  extension: InlineExtension;
} {
  const capture: SubagentRpcCapture = { events: null };
  return {
    capture,
    extension: {
      name: "pi-web-subagent-rpc",
      hidden: true,
      factory(pi) {
        capture.events = pi.events as EventBusLike;
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const RUN_STATES: ReadonlySet<string> = new Set<SubagentRpcRunState>([
  "queued",
  "running",
  "paused",
  "complete",
  "failed",
  "stopped",
  "rejected",
]);

function safeTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function safeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.slice(0, maxLength);
  return text.length > 0 ? text : undefined;
}

/** Validates an untrusted `runs` projection; unknown fields are dropped. */
export function normalizeRunStatus(raw: unknown): SubagentRpcRunStatus | null {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.entries)) return null;
  const entries: SubagentRpcRunEntry[] = [];
  for (const item of raw.entries.slice(0, MAX_RUN_ENTRIES)) {
    if (!isRecord(item)) continue;
    const runId = safeText(item.runId, 128);
    const agent = safeText(item.agent, 96);
    const state = typeof item.state === "string" && RUN_STATES.has(item.state)
      ? item.state as SubagentRpcRunState
      : undefined;
    const updatedAt = safeTimestamp(item.updatedAt) ?? safeTimestamp(item.startedAt);
    if (!runId || !agent || !state || updatedAt === undefined) continue;
    const parentRunId = safeText(item.parentRunId, 128);
    entries.push({
      runId,
      ...(typeof item.index === "number" && Number.isSafeInteger(item.index) && item.index >= 0 ? { index: item.index } : {}),
      ...(parentRunId ? { parentRunId } : {}),
      ...(typeof item.parentIndex === "number" && Number.isSafeInteger(item.parentIndex) && item.parentIndex >= 0 ? { parentIndex: item.parentIndex } : {}),
      agent,
      ...(safeText(item.label, 96) ? { label: safeText(item.label, 96) } : {}),
      state,
      ...(safeText(item.activityState, 128) ? { activityState: safeText(item.activityState, 128) } : {}),
      ...(safeText(item.currentTool, 128) ? { currentTool: safeText(item.currentTool, 128) } : {}),
      ...(safeText(item.currentPath, 128) ? { currentPath: safeText(item.currentPath, 128) } : {}),
      ...(safeTimestamp(item.startedAt) !== undefined ? { startedAt: safeTimestamp(item.startedAt) } : {}),
      ...(safeTimestamp(item.lastActivityAt) !== undefined ? { lastActivityAt: safeTimestamp(item.lastActivityAt) } : {}),
      ...(safeTimestamp(item.endedAt) !== undefined ? { endedAt: safeTimestamp(item.endedAt) } : {}),
      updatedAt,
    });
  }
  const total = typeof raw.total === "number" && Number.isSafeInteger(raw.total) && raw.total >= 0 ? raw.total : entries.length;
  const omitted = typeof raw.omitted === "number" && Number.isSafeInteger(raw.omitted) && raw.omitted >= 0 ? raw.omitted : 0;
  return { version: 1, entries, total, omitted };
}

interface PendingRequest {
  reject: (error: SubagentRpcError) => void;
  cleanup: () => void;
}

type CapabilityState =
  | { compatible: true }
  | { compatible: false; at: number };

export type SubagentNegotiationReason = "not-installed" | "incompatible";

/**
 * Minimal RPC v1 client over the parent session's extension event bus.
 *
 * - a compatible capability result is cached for the client lifetime;
 * - unavailable/incompatible results are negative-cached for five seconds so
 *   polling can recover after extension availability changes;
 * - `resetForReload()` clears capability state and rejects pending requests
 *   before the parent session reloads its extensions;
 * - `dispose()` permanently rejects new requests.
 */
export class SubagentRpcClient {
  private disposed = false;
  private readonly pending = new Map<string, PendingRequest>();
  private capability: CapabilityState | null = null;
  private negotiationReason: SubagentNegotiationReason = "not-installed";

  constructor(private readonly capture: SubagentRpcCapture) {}

  private get bus(): EventBusLike | null {
    return this.capture.events;
  }

  async request(method: SubagentRpcMethod, stage: SubagentRpcStage, params?: Record<string, unknown>): Promise<unknown> {
    if (this.disposed) throw new SubagentRpcError("Subagent RPC client is disposed", "disposed", stage);
    const bus = this.bus;
    if (!bus) throw new SubagentRpcError("Subagent RPC extension is not available", "unavailable", stage);
    const requestId = randomUUID();

    return new Promise<unknown>((resolve, reject) => {
      let settled = false;
      const unsubscribe = bus.on(`${REPLY_EVENT_PREFIX}${requestId}`, (raw) => {
        if (settled) return;
        if (!isRecord(raw)) return;
        if (raw.version !== PROTOCOL_VERSION) return;
        if (raw.requestId !== requestId) return;
        if (raw.method !== undefined && raw.method !== method) return;
        settled = true;
        cleanup();
        if (raw.success === true) {
          resolve(raw.data);
        } else if (raw.success === false && isRecord(raw.error)) {
          const code = typeof raw.error.code === "string" ? raw.error.code : "execution_failed";
          const message = typeof raw.error.message === "string" ? raw.error.message : "Subagent RPC failed.";
          reject(new SubagentRpcError(message, code, stage));
        } else {
          reject(new SubagentRpcError("Subagent RPC returned an invalid reply.", "invalid_reply", stage));
        }
      });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new SubagentRpcError(`Subagent RPC ${method} timed out.`, "timeout", stage));
      }, SUBAGENT_RPC_TIMEOUT_MS);
      const cleanup = () => {
        clearTimeout(timer);
        unsubscribe();
        this.pending.delete(requestId);
      };
      this.pending.set(requestId, {
        reject,
        cleanup,
      });
      bus.emit(REQUEST_EVENT, {
        version: PROTOCOL_VERSION,
        requestId,
        method,
        ...(params !== undefined ? { params } : {}),
      });
    });
  }

  /** Why the last failed negotiation was unavailable; "not-installed" by default. */
  get lastNegotiationReason(): SubagentNegotiationReason {
    return this.negotiationReason;
  }

  /** Returns true only when ping advertises the runStatus v1 projection. */
  async negotiate(): Promise<boolean> {
    if (this.disposed) return false;
    const cached = this.capability;
    if (cached) {
      if (cached.compatible) return true;
      if (Date.now() - cached.at < SUBAGENT_RPC_NEGATIVE_CACHE_TTL_MS) return false;
    }
    let compatible = false;
    try {
      const data = await this.request("ping", "ping");
      compatible = isRecord(data)
        && isRecord(data.capabilities)
        && isRecord(data.capabilities.runStatus)
        && data.capabilities.runStatus.version === 1;
      // Ping answered but runStatus v1 is absent: incompatible extension.
      this.negotiationReason = "incompatible";
    } catch {
      // Extension absent or unresponsive: negative-cache so polling retries later.
      this.negotiationReason = "not-installed";
    }
    this.capability = compatible
      ? { compatible: true }
      : { compatible: false, at: Date.now() };
    return compatible;
  }

  /** One live run-status snapshot, or null when the capability is unavailable. */
  async getRunStatus(): Promise<SubagentRpcRunStatus | null> {
    const compatible = await this.negotiate();
    if (!compatible) return null;
    const data = await this.request("status", "status");
    return normalizeRunStatus(isRecord(data) ? data.runs : undefined);
  }

  async control(method: "steer" | "interrupt" | "resume", params: Record<string, unknown>): Promise<unknown> {
    const compatible = await this.negotiate();
    if (!compatible) {
      throw new SubagentRpcError("Live subagent control is unavailable", "unavailable", "control");
    }
    return this.request(method, "control", params);
  }

  /** Called before the parent session reloads its extensions. */
  resetForReload(): void {
    this.rejectPending(new SubagentRpcError("Subagent RPC request cancelled by extension reload.", "cancelled", "ping"));
  }

  /** Permanent teardown: rejects pending requests and future ones. */
  dispose(): void {
    this.disposed = true;
    this.rejectPending(new SubagentRpcError("Subagent RPC client is disposed", "disposed", "ping"));
  }

  private rejectPending(error: SubagentRpcError): void {
    this.capability = null;
    for (const { cleanup, reject } of this.pending.values()) {
      cleanup();
      reject(error);
    }
    this.pending.clear();
  }
}
