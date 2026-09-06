import { randomUUID } from "crypto";

const RPC_VERSION = 1;
const RPC_READY_EVENT = "subagents:rpc:v1:ready";
const RPC_REQUEST_EVENT = "subagents:rpc:v1:request";
const RPC_REPLY_EVENT_PREFIX = "subagents:rpc:v1:reply:";
const SNAPSHOT_KIND = "pi-subagents.async-status-snapshot";
const ACTIVE_STATES = new Set(["queued", "running"]);

export interface ExtensionEventBusLike {
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): (() => void) | void;
}

type SnapshotNode = {
  state?: unknown;
  children?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasActiveNode(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const node = value as SnapshotNode;
  if (typeof node.state === "string" && ACTIVE_STATES.has(node.state)) return true;
  return Array.isArray(node.children) && node.children.some(hasActiveNode);
}

function snapshotHasActiveWork(value: unknown): boolean | undefined {
  if (!isRecord(value) || value.kind !== SNAPSHOT_KIND || value.version !== RPC_VERSION) return undefined;
  if (!Array.isArray(value.runs)) return undefined;
  if (value.runs.some(hasActiveNode)) return true;

  const omitted = isRecord(value.omitted) ? value.omitted : undefined;
  const snapshotWasTruncated = (typeof omitted?.runs === "number" && omitted.runs > 0)
    || (typeof omitted?.children === "number" && omitted.children > 0)
    || omitted?.byteLimitExceeded === true;
  return snapshotWasTruncated ? undefined : false;
}

export interface BackgroundWorkProbe {
  hasActiveWork(): Promise<boolean>;
  dispose(): void;
}

/**
 * Queries pi-subagents through its public event-bus RPC bridge. Once the bridge
 * advertises support, an unavailable or malformed status reply is treated
 * conservatively so a transient extension failure cannot destroy the owning
 * session while background work may still be running.
 */
export function createSubagentBackgroundWorkProbe(
  events: ExtensionEventBusLike,
  sessionId: string,
  options: { timeoutMs?: number } = {},
): BackgroundWorkProbe {
  const timeoutMs = options.timeoutMs ?? 2_000;
  let disposed = false;
  let bridgeReady = false;
  const pendingCancels = new Set<() => void>();

  const unsubscribeReady = events.on(RPC_READY_EVENT, (payload) => {
    if (!isRecord(payload)) return;
    if (payload.version !== RPC_VERSION || !Array.isArray(payload.methods) || !payload.methods.includes("status")) return;
    const session = isRecord(payload.session) ? payload.session : undefined;
    const advertisedSessionId = typeof session?.sessionId === "string" ? session.sessionId : undefined;
    if (!advertisedSessionId || advertisedSessionId === sessionId) bridgeReady = true;
  });

  return {
    async hasActiveWork(): Promise<boolean> {
      if (disposed || !bridgeReady) return false;

      const requestId = randomUUID();
      const replyEvent = `${RPC_REPLY_EVENT_PREFIX}${requestId}`;
      return new Promise<boolean>((resolve) => {
        let settled = false;
        let cleanup = () => {};
        const cancel = () => finish(true);
        const finish = (active: boolean) => {
          if (settled) return;
          settled = true;
          cleanup();
          pendingCancels.delete(cancel);
          resolve(active);
        };
        pendingCancels.add(cancel);
        const unsubscribeReply = events.on(replyEvent, (payload) => {
          if (!isRecord(payload) || payload.version !== RPC_VERSION || payload.requestId !== requestId) {
            finish(true);
            return;
          }
          if (payload.success !== true || !isRecord(payload.data)) {
            finish(true);
            return;
          }
          const active = snapshotHasActiveWork(payload.data.asyncSnapshot);
          finish(active ?? true);
        });
        const timer = setTimeout(() => finish(true), timeoutMs);
        timer.unref?.();
        cleanup = () => {
          clearTimeout(timer);
          unsubscribeReply?.();
        };

        try {
          events.emit(RPC_REQUEST_EVENT, {
            version: RPC_VERSION,
            requestId,
            method: "status",
            params: {},
            source: { extension: "pi-web" },
          });
        } catch {
          finish(true);
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeReady?.();
      for (const cancel of [...pendingCancels]) cancel();
    },
  };
}
