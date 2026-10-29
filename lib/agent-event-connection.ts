import type { AgentEventLike } from "./agent-event-wire";
import type { DebugEventConnectionSnapshot, DebugStreamCloseReason } from "./debug-types";

export interface AgentEventSourceLike {
  readonly readyState: number;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export type AgentEventConnectionStatus = "ready_timeout" | "startup_error" | "closed";

export class AgentEventConnectionError extends Error {
  constructor(public readonly status: AgentEventConnectionStatus, message?: string) {
    super(message ?? (
      status === "ready_timeout"
        ? "Timed out starting the agent session. Please try again."
        : "Failed to connect to the agent event stream. Please try again."
    ));
    this.name = "AgentEventConnectionError";
  }
}

type Attempt = {
  promise: Promise<void>;
  ready: boolean;
  succeed(): void;
  fail(error: AgentEventConnectionError): void;
};

type Connection = {
  sessionId: string;
  source: AgentEventSourceLike;
  attempt: Attempt;
  watchdog: ReturnType<typeof setInterval> | null;
  openedAt: number;
  connectedAt: number | null;
  /** Last data of any kind, heartbeats included; null before the first. */
  lastSeenAt: number | null;
  lastHeartbeatAt: number | null;
  events: number;
};

type FailReason = NonNullable<DebugEventConnectionSnapshot["lastError"]>["reason"];

export interface AgentEventConnectionOptions {
  createSource(sessionId: string): AgentEventSourceLike;
  onEvent(event: AgentEventLike): void;
  shouldMaintain(sessionId: string): boolean;
  readinessTimeoutMs: number;
  reconnectDelayMs: number;
  /**
   * A ready stream that delivers nothing for this long, heartbeats included
   * (AGENT_EVENT_HEARTBEAT_MS), is dead and reconnects. Omitted: never.
   */
  staleAfterMs?: number;
  onUnexpectedError?(error: unknown): void;
}

const EVENT_SOURCE_OPEN = 1;

/** Owns the EventSource, agent-readiness handshake, and passive reconnect. */
export class AgentEventConnection {
  private current: Connection | null = null;
  private retry: { sessionId: string; timer: ReturnType<typeof setTimeout>; dueAt: number } | null = null;
  private retryGeneration = 0;
  // Bookkeeping for snapshot() only: nothing here decides what the connection does.
  private opens = 0;
  private retries = 0;
  private lastError: DebugEventConnectionSnapshot["lastError"] = null;
  private lastClose: DebugEventConnectionSnapshot["lastClose"] = null;

  constructor(private readonly options: AgentEventConnectionOptions) {}

  /**
   * `reason` only labels the close in snapshot(). An idle connection left by an error no close has
   * ended yet (a startup error, a retry nobody wanted) is stamped too: the close ends that outage.
   */
  close(reason?: DebugStreamCloseReason): void {
    const openError = this.lastError !== null && !(this.lastClose && this.lastClose.at >= this.lastError.at);
    if (this.current || this.retry || openError) this.lastClose = { reason: reason ?? null, at: Date.now() };
    this.stopRetrying();
    if (this.current) this.discard(this.current, new AgentEventConnectionError("closed"));
  }

  /** What the connection holds now, as a plain copy. Reads fields only: it opens, closes and arms nothing. */
  snapshot(): DebugEventConnectionSnapshot {
    const connection = this.current;
    const retry = this.retry;
    return {
      sessionId: connection?.sessionId ?? retry?.sessionId ?? null,
      state: connection ? (connection.attempt.ready ? "connected" : "connecting") : retry ? "retrying" : "idle",
      readyState: connection ? connection.source.readyState : null,
      openedAt: connection?.openedAt ?? null,
      connectedAt: connection?.connectedAt ?? null,
      lastSeenAt: connection?.lastSeenAt ?? null,
      lastHeartbeatAt: connection?.lastHeartbeatAt ?? null,
      events: connection?.events ?? 0,
      opens: this.opens,
      retries: this.retries,
      retryDueAt: retry?.dueAt ?? null,
      watchdogArmed: Boolean(connection && connection.watchdog !== null),
      staleAfterMs: this.options.staleAfterMs ?? null,
      lastError: this.lastError ? { ...this.lastError } : null,
      lastClose: this.lastClose ? { ...this.lastClose } : null,
    };
  }

  maintain(sessionId: string): void {
    if (!this.options.shouldMaintain(sessionId)) return;
    const retryGeneration = this.retryGeneration;
    void this.ensureConnected(sessionId).catch((error) => {
      if (retryGeneration !== this.retryGeneration) return;
      if (error instanceof AgentEventConnectionError) {
        if (error.status === "startup_error") this.stopRetrying();
        else this.scheduleRetry(sessionId);
      } else {
        this.options.onUnexpectedError?.(error);
      }
    });
  }

  async ensureConnected(sessionId: string): Promise<void> {
    while (true) {
      let connection = this.current;
      if (!connection || connection.sessionId !== sessionId) {
        connection = this.open(sessionId);
      } else if (
        connection.attempt.ready
        && connection.source.readyState === EVENT_SOURCE_OPEN
      ) {
        return;
      }

      await connection.attempt.promise;
      if (this.current !== connection) {
        if (this.current?.sessionId === sessionId) continue;
        throw new AgentEventConnectionError("closed");
      }
      if (connection.source.readyState === EVENT_SOURCE_OPEN) return;

      // A once-ready EventSource may otherwise remain CONNECTING indefinitely.
      this.lastClose = { reason: "stuck", at: Date.now() };
      this.discard(connection, new AgentEventConnectionError("closed"));
    }
  }

  private open(sessionId: string): Connection {
    if (this.current) {
      this.lastClose = { reason: "replaced", at: Date.now() };
      this.discard(this.current, new AgentEventConnectionError("closed"));
    }

    let source: AgentEventSourceLike;
    try {
      source = this.options.createSource(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { reason: "error", message, at: Date.now() };
      throw new AgentEventConnectionError("closed", message);
    }
    this.opens += 1;

    let settled = false;
    let resolve!: () => void;
    let reject!: (error: AgentEventConnectionError) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const timeout = setTimeout(() => {
      this.fail(connection, new AgentEventConnectionError("ready_timeout"), "ready_timeout");
    }, this.options.readinessTimeoutMs);
    const attempt: Attempt = {
      promise,
      ready: false,
      succeed() {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      },
      fail(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      },
    };
    const openedAt = Date.now();
    const connection: Connection = {
      sessionId,
      source,
      attempt,
      watchdog: null,
      openedAt,
      connectedAt: null,
      lastSeenAt: null,
      lastHeartbeatAt: null,
      events: 0,
    };
    this.current = connection;

    source.onmessage = (message) => {
      if (this.current !== connection) return;
      connection.lastSeenAt = Date.now();
      let event: AgentEventLike;
      try {
        event = JSON.parse(message.data) as AgentEventLike;
      } catch {
        return;
      }

      if (event.type === "heartbeat") {
        connection.lastHeartbeatAt = connection.lastSeenAt;
        return;
      }
      if (event.type === "connected") {
        connection.connectedAt ??= connection.lastSeenAt;
        attempt.ready = true;
        attempt.succeed();
        this.stopRetrying();
        const staleAfterMs = this.options.staleAfterMs;
        if (staleAfterMs && connection.watchdog === null) {
          // Checked against the clock, so a background tab's throttled timer
          // only reconnects later, never wrongly.
          connection.watchdog = setInterval(() => {
            if (Date.now() - (connection.lastSeenAt ?? openedAt) > staleAfterMs) {
              this.fail(connection, new AgentEventConnectionError("closed"), "stale");
            }
          }, Math.max(1_000, Math.floor(staleAfterMs / 3)));
        }
      } else if (event.type === "startup_error") {
        const message = typeof event.errorMessage === "string" ? event.errorMessage : undefined;
        this.fail(connection, new AgentEventConnectionError("startup_error", message), "startup_error");
        return;
      }
      connection.events += 1;
      this.options.onEvent(event);
    };
    source.onerror = () => {
      this.fail(connection, new AgentEventConnectionError("closed"), "error");
    };

    return connection;
  }

  private fail(connection: Connection, error: AgentEventConnectionError, reason: FailReason): void {
    if (this.current !== connection) return;
    this.lastError = { reason, message: reason === "startup_error" ? error.message : null, at: Date.now() };
    this.discard(connection, error);
    if (error.status === "startup_error") this.stopRetrying();
    else this.scheduleRetry(connection.sessionId);
  }

  private discard(connection: Connection, error: AgentEventConnectionError): void {
    if (connection.watchdog !== null) clearInterval(connection.watchdog);
    connection.watchdog = null;
    connection.attempt.fail(error);
    connection.source.close();
    if (this.current === connection) this.current = null;
  }

  private scheduleRetry(sessionId: string): void {
    if (!this.options.shouldMaintain(sessionId)) return;
    if (this.retry?.sessionId === sessionId) return;
    this.clearRetry();

    const timer = setTimeout(() => {
      if (this.retry?.timer !== timer) return;
      this.retry = null;
      this.retries += 1;
      this.maintain(sessionId);
    }, this.options.reconnectDelayMs);
    this.retry = { sessionId, timer, dueAt: Date.now() + this.options.reconnectDelayMs };
  }

  private stopRetrying(): void {
    this.retryGeneration += 1;
    this.clearRetry();
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry.timer);
    this.retry = null;
  }
}

/** What `POST /api/agent/[id]/lease` answers besides keeping the session alive. */
export interface SessionLeaseReply {
  running?: boolean;
  awaitingInput?: boolean;
  subagentsActive?: boolean;
}

/**
 * How long a page waits for a lease reply. Over HTTP/1.1 a request queued behind six open
 * streams never leaves the browser, so no answer in time reads as a starved pool.
 */
export const SESSION_LEASE_TIMEOUT_MS = 5_000;

/**
 * Whether the server reports anything under way in the session: a run, a queued prompt, a `!`
 * command, a compaction, an extension dialog waiting for an answer, or a subagent left to finish
 * (its end starts a turn there). A hidden page keeps or reopens the session's stream while it does.
 */
export function sessionLeaseShowsActivity(reply: SessionLeaseReply | "unanswered" | null | undefined): boolean {
  if (!reply || reply === "unanswered") return false;
  return Boolean(reply.running || reply.awaitingInput || reply.subagentsActive);
}

/**
 * Whether a page hidden past its grace may close the selected session's stream (#1283): only when
 * the lease reply shows nothing under way. `"unanswered"` (no reply within SESSION_LEASE_TIMEOUT_MS,
 * or no network) releases: the pool is starved, which is what the release is for, or the stream
 * is down anyway. `null` (the server answered with an error) keeps the stream until the next check.
 */
export function canReleaseHiddenEventStream(reply: SessionLeaseReply | "unanswered" | null | undefined): boolean {
  if (reply === "unanswered") return true;
  if (!reply) return false;
  return !sessionLeaseShowsActivity(reply);
}
