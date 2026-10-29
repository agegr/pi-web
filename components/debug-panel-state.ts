import type {
  DebugClientSession,
  DebugEventConnectionSnapshot,
  DebugEventStreamState,
  DebugMcpServer,
  DebugPageVisibility,
  DebugRunningPoll,
  DebugSessionDetail,
  DebugSessionSummary,
  DebugSnapshotResponse,
  DebugStreamCloseReason,
  DebugTrackedEventSource,
  DebugTrackedEventSourceKind,
  DebugWrapperSnapshot,
} from "@/lib/debug-types";
import { listTrackedEventSources, readHttpProtocol, readPageVisibility, readRunningPoll } from "@/lib/page-debug";
import { projectNameOf } from "@/lib/session-tree";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import { MCP_SESSION_STATE_KEYS } from "./mcp-config-helpers";

/**
 * The debug panel's pure parts (components/DebugPanel.tsx): what it reads of the page each second,
 * its poll of `GET /api/agent/debug`, the shape check of the answer, durations and countdowns, the
 * issues it lists, its poll samples and the server's sessions grouped like the sidebar. Every
 * reference to the page's tracked stream objects stays here, so the component never names them.
 * Nothing here opens, renews or reconnects anything.
 */

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The page's own state is read this often while the panel is open. */
export const DEBUG_TICK_MS = 1000;
/** The server is asked this often while the panel is open and the page visible. */
export const DEBUG_POLL_MS = 2000;
/** A poll with no answer by then is given up: with HTTP/1.1 that is a sign every connection is taken. */
export const DEBUG_POLL_TIMEOUT_MS = 5000;

// ── Keys chosen at run time (literal maps, so the translation tests find them) ──

export const DEBUG_STREAM_STATE_KEYS: Record<DebugEventStreamState, string> = {
  idle: "debug.stream.state.idle",
  connecting: "debug.stream.state.connecting",
  connected: "debug.stream.state.connected",
  retrying: "debug.stream.state.retrying",
};

export const DEBUG_STREAM_ERROR_KEYS: Record<"ready_timeout" | "startup_error" | "error" | "stale", string> = {
  ready_timeout: "debug.stream.error.readyTimeout",
  startup_error: "debug.stream.error.startup",
  error: "debug.stream.error.error",
  stale: "debug.stream.error.stale",
};

export const DEBUG_REATTACH_REASON_KEYS: Record<"visible" | "activity", string> = {
  visible: "debug.stream.reattach.visible",
  activity: "debug.stream.reattach.activity",
};

export const DEBUG_SOURCE_KIND_KEYS: Record<DebugTrackedEventSourceKind, string> = {
  agent: "debug.page.source.agent",
  "file-watch": "debug.page.source.fileWatch",
  terminal: "debug.page.source.terminal",
};

export const DEBUG_SOURCE_STATE_KEYS: Record<DebugTrackedEventSource["state"], string> = {
  connecting: "debug.page.source.connecting",
  open: "debug.page.source.open",
};

export const DEBUG_LEASE_OUTCOME_KEYS: Record<"reply" | "unanswered" | "error", string> = {
  reply: "debug.lease.outcome.reply",
  unanswered: "debug.lease.outcome.unanswered",
  error: "debug.lease.outcome.error",
};

export const DEBUG_SESSION_STATE_KEYS: Record<DebugSessionSummary["state"], string> = {
  alive: "debug.state.alive",
  closing: "debug.state.closing",
  none: "debug.state.none",
};

export const DEBUG_EXTENSIONS_KEYS: Record<DebugWrapperSnapshot["extensions"], string> = {
  binding: "debug.server.extensions.binding",
  bound: "debug.server.extensions.bound",
  failed: "debug.server.extensions.failed",
  none: "debug.server.extensions.none",
};

export const DEBUG_POLL_FAILURE_KEYS: Record<DebugPollFailure["kind"], string> = {
  timeout: "debug.poll.timeout",
  http: "debug.poll.http",
  network: "debug.poll.network",
  invalid: "debug.poll.invalid",
};

/** A subagent run's status: the agent switcher's words, and "unknown" for one the server could not read. */
export const DEBUG_RUN_STATUS_KEYS: Record<SubagentSessionStatus | "unknown", string> = {
  starting: "agentSwitcher.status.starting",
  queued: "debug.run.status.queued",
  running: "agentSwitcher.status.running",
  completed: "agentSwitcher.status.completed",
  failed: "agentSwitcher.status.failed",
  aborted: "agentSwitcher.status.aborted",
  interrupted: "agentSwitcher.status.interrupted",
  unknown: "debug.unknown",
};

export const DEBUG_CLOSE_REASON_KEYS: Record<DebugStreamCloseReason, string> = {
  released: "debug.stream.close.released",
  grace_end: "debug.stream.close.graceEnd",
  send_failed: "debug.stream.close.sendFailed",
  set_tools: "debug.stream.close.setTools",
  rebuilt: "debug.stream.close.rebuilt",
  deselected: "debug.stream.close.deselected",
  stuck: "debug.stream.close.stuck",
  replaced: "debug.stream.close.replaced",
};

/**
 * A code the panel shows (a server's string, a close reason): its word from one of the maps above,
 * else the code as it came, so a value newer than the map still reads as itself.
 */
export function translateDebugCode(code: string, keys: Readonly<Record<string, string>>, t: Translate): string {
  return Object.prototype.hasOwnProperty.call(keys, code) ? t(keys[code]) : code;
}

// ── Durations ──

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function clampMs(ms: number): number {
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** A duration in the panel: "350 ms", "42s", "8m 05s", "2h 03m", "3d 4h". */
export function formatDebugDuration(ms: number, t: Translate): string {
  const value = clampMs(ms);
  if (value < SECOND) return t("debug.duration.ms", { count: Math.floor(value) });
  if (value < MINUTE) return t("debug.duration.seconds", { count: Math.floor(value / SECOND) });
  if (value < HOUR) {
    return t("debug.duration.minutesSeconds", { minutes: Math.floor(value / MINUTE), seconds: pad2(Math.floor((value % MINUTE) / SECOND)) });
  }
  if (value < DAY) {
    return t("debug.duration.hoursMinutes", { hours: Math.floor(value / HOUR), minutes: pad2(Math.floor((value % HOUR) / MINUTE)) });
  }
  return t("debug.duration.daysHours", { days: Math.floor(value / DAY), hours: Math.floor((value % DAY) / HOUR) });
}

/** A duration in a session row: one unit, "42s", "8m", "2h", "3d". */
export function formatShortDebugDuration(ms: number, t: Translate): string {
  const value = clampMs(ms);
  if (value < MINUTE) return t("debug.duration.seconds", { count: Math.floor(value / SECOND) });
  if (value < HOUR) return t("debug.duration.minutes", { count: Math.floor(value / MINUTE) });
  if (value < DAY) return t("debug.duration.hours", { count: Math.floor(value / HOUR) });
  return t("debug.duration.days", { count: Math.floor(value / DAY) });
}

export function formatAgo(ms: number, t: Translate): string {
  return t("debug.time.ago", { time: formatDebugDuration(ms, t) });
}

/** "in 8m 05s", or "due" once the time has come (the next answer says what happened). */
export function formatCountdown(ms: number, t: Translate): string {
  return ms > 0 ? t("debug.time.in", { time: formatDebugDuration(ms, t) }) : t("debug.time.due");
}

export function formatBytes(bytes: number): string {
  const value = clampMs(bytes);
  if (value < 1024) return `${Math.floor(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortDebugId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

// ── Clocks ──

/**
 * Server times read on the server's clock: the answer's own `now` plus the time the browser
 * counted since it arrived. The browser's clock is never compared with a server time.
 */
export interface DebugServerClock {
  /** Milliseconds until a server time (negative once past). */
  remaining(at: number): number;
  /** Milliseconds since a server time. */
  age(at: number): number;
}

export function debugServerClock(serverNow: number, receivedAt: number, localNow: number): DebugServerClock {
  // The browser's clock can step back: the reply never gets younger than it arrived.
  const since = Math.max(0, localNow - receivedAt);
  return {
    remaining: (at) => at - serverNow - since,
    age: (at) => serverNow - at + since,
  };
}

/** The lease's next renewal: a whole number of intervals after the renewal timer started. */
export function nextLeaseRenewalAt(renewStartedAt: number | null, intervalMs: number, now: number): number | null {
  if (renewStartedAt === null || !(intervalMs > 0)) return null;
  const elapsed = Math.max(0, now - renewStartedAt);
  return renewStartedAt + (Math.floor(elapsed / intervalMs) + 1) * intervalMs;
}

// ── The server's answer ──

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNumberOrNull(value: unknown): boolean {
  return value === null || isNumber(value);
}

function isSummary(value: unknown): boolean {
  return isObject(value)
    && typeof value.sessionId === "string"
    && typeof value.state === "string"
    && isNumber(value.eventStreams)
    && isNumberOrNull(value.nextIdleCheckAt);
}

function isDetail(value: unknown): boolean {
  if (!isObject(value) || typeof value.sessionId !== "string") return false;
  const wrapper = value.wrapper;
  const subagents = value.subagents;
  const mcp = value.mcp;
  return (wrapper === null || (isObject(wrapper) && typeof wrapper.state === "string" && isObject(wrapper.run) && isObject(wrapper.idle)))
    && (value.lifecycle === null || isObject(value.lifecycle))
    && (value.providers === null || Array.isArray(value.providers))
    && Array.isArray(value.eventStreams)
    && isObject(subagents) && Array.isArray(subagents.runs) && Array.isArray(subagents.notifications)
    && (mcp === null || (isObject(mcp) && Array.isArray(mcp.servers)));
}

function isServerGlobal(value: unknown): boolean {
  return isObject(value)
    && isNumber(value.startedAt)
    && isObject(value.wrappers)
    && isObject(value.eventStreams) && Array.isArray(value.eventStreams.byHolder)
    && isObject(value.terminals);
}

/** Whether an answer has the shape the panel renders; anything else is reported, never rendered. */
export function isDebugSnapshotResponse(value: unknown): value is DebugSnapshotResponse {
  return isObject(value)
    && isNumber(value.now)
    && isServerGlobal(value.server)
    && Array.isArray(value.sessions) && value.sessions.every(isSummary)
    && (value.session === null || isDetail(value.session));
}

// ── The page ──

/** What the page knows about itself at one tick of the panel. */
export interface DebugPageReading {
  /** The browser's clock when it was read: the panel's "now" for the page's own times. */
  at: number;
  client: DebugClientSession | null;
  /** The chat's reader threw (a chat from before a hot reload): nothing is known of its stream. */
  clientFailed: boolean;
  sources: DebugTrackedEventSource[];
  visibility: DebugPageVisibility | null;
  protocol: string | null;
  runningPoll: DebugRunningPoll | null;
  /** The panel's own request waiting for an answer since then. */
  pollInFlightSince: number | null;
}

function attempt<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** The chat's snapshot, or null when it has none or its reader throws. */
export function readClientSession(reader: (() => DebugClientSession) | null): { client: DebugClientSession | null; failed: boolean } {
  if (!reader) return { client: null, failed: false };
  try {
    return { client: reader() ?? null, failed: false };
  } catch {
    return { client: null, failed: true };
  }
}

/** Reads the page: each source on its own, so one that throws costs only its own rows. */
export function readDebugPage(
  reader: (() => DebugClientSession) | null,
  pollInFlightSince: number | null,
  now = Date.now(),
): DebugPageReading {
  const { client, failed } = readClientSession(reader);
  return {
    at: now,
    client,
    clientFailed: failed,
    sources: attempt(listTrackedEventSources, []),
    visibility: attempt<DebugPageVisibility | null>(readPageVisibility, null),
    protocol: attempt(readHttpProtocol, null),
    runningPoll: attempt<DebugRunningPoll | null>(readRunningPoll, null),
    pollInFlightSince,
  };
}

/** The session the panel asks about: the chat's own id (a fresh composer's), else the selection. */
export function debugTargetSessionId(client: DebugClientSession | null, selectedSessionId: string | null): string | null {
  return client?.sessionId ?? selectedSessionId;
}

// ── The poll ──

export interface DebugPollFailure {
  kind: "timeout" | "http" | "network" | "invalid";
  status: number | null;
  at: number;
}

export interface DebugServerReading {
  /** The session the last answered request asked about. */
  sessionId: string | null;
  /** The last good answer about that session (kept through a failed poll). */
  reply: DebugSnapshotResponse | null;
  /** The browser's clock when `reply` arrived. */
  receivedAt: number | null;
  roundTripMs: number | null;
  /** The last poll's failure; null once one is answered again. */
  failure: DebugPollFailure | null;
  requests: number;
  failures: number;
  /** Polls failed in a row, whatever session they asked about; 0 once one is answered. */
  consecutiveFailures: number;
}

export const EMPTY_DEBUG_SERVER_READING: DebugServerReading = {
  sessionId: null,
  reply: null,
  receivedAt: null,
  roundTripMs: null,
  failure: null,
  requests: 0,
  failures: 0,
  consecutiveFailures: 0,
};

interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface DebugPollerOptions {
  fetch(url: string, init: { cache: "no-store"; signal: AbortSignal }): Promise<ResponseLike>;
  /** The session to ask about now. */
  sessionId(): string | null;
  isVisible(): boolean;
  /** Called with every finished poll, never after dispose() nor for a session the panel left. */
  onReading(reading: DebugServerReading): void;
  now?(): number;
  setTimeout?(callback: () => void, ms: number): unknown;
  clearTimeout?(handle: unknown): void;
}

export interface DebugPoller {
  /** Asks the server, unless the page is hidden or a request about the same session is under way. */
  poll(): void;
  /** Asks again at once when the session changed since the last request. */
  sync(): void;
  inFlightSince(): number | null;
  /** Aborts the request under way; nothing is reported afterwards. */
  dispose(): void;
}

function debugSnapshotUrl(sessionId: string | null): string {
  return sessionId ? `/api/agent/debug?session=${encodeURIComponent(sessionId)}` : "/api/agent/debug";
}

/**
 * The panel's poll of `GET /api/agent/debug`: one request at a time, given up after
 * DEBUG_POLL_TIMEOUT_MS (a controller and a timer: no AbortSignal.timeout on Safari 16.2), aborted
 * when the session changes and when the panel closes. The route reads registries only, so asking
 * resumes no session and moves no idle timer.
 */
export function createDebugPoller(options: DebugPollerOptions): DebugPoller {
  const now = options.now ?? (() => Date.now());
  const startTimer = options.setTimeout ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const stopTimer = options.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let disposed = false;
  let inFlight: { sessionId: string | null; controller: AbortController; startedAt: number } | null = null;
  // The session the last request asked about; undefined before the first one.
  let askedFor: string | null | undefined;
  let reading = EMPTY_DEBUG_SERVER_READING;

  const run = async (sessionId: string | null) => {
    const controller = new AbortController();
    const request = { sessionId, controller, startedAt: now() };
    inFlight = request;
    askedFor = sessionId;
    let timedOut = false;
    const timer = startTimer(() => {
      timedOut = true;
      controller.abort();
    }, DEBUG_POLL_TIMEOUT_MS);
    let reply: DebugSnapshotResponse | null = null;
    let failure: Omit<DebugPollFailure, "at"> | null = null;
    try {
      const response = await options.fetch(debugSnapshotUrl(sessionId), { cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        failure = { kind: "http", status: response.status };
      } else {
        let body: unknown = null;
        try {
          body = await response.json();
        } catch (error) {
          if (controller.signal.aborted) throw error;
        }
        if (isDebugSnapshotResponse(body)) reply = body;
        else failure = { kind: "invalid", status: response.status };
      }
    } catch {
      failure = { kind: timedOut ? "timeout" : "network", status: null };
    } finally {
      stopTimer(timer);
      if (inFlight === request) inFlight = null;
    }
    // Aborted for another session or by the panel closing; an answer about a session the panel
    // has left since. Either way nothing reaches it.
    if (disposed || (controller.signal.aborted && !timedOut) || options.sessionId() !== sessionId) return;
    const at = now();
    const sameSession = reading.sessionId === sessionId;
    reading = reply
      ? {
        sessionId,
        reply,
        receivedAt: at,
        roundTripMs: Math.max(0, at - request.startedAt),
        failure: null,
        requests: reading.requests + 1,
        failures: reading.failures,
        consecutiveFailures: 0,
      }
      : {
        sessionId,
        reply: sameSession ? reading.reply : null,
        receivedAt: sameSession ? reading.receivedAt : null,
        roundTripMs: sameSession ? reading.roundTripMs : null,
        failure: { ...(failure ?? { kind: "invalid", status: null }), at },
        requests: reading.requests + 1,
        failures: reading.failures + 1,
        consecutiveFailures: reading.consecutiveFailures + 1,
      };
    options.onReading(reading);
  };

  const poll = () => {
    if (disposed || !options.isVisible()) return;
    const sessionId = options.sessionId();
    if (inFlight) {
      if (inFlight.sessionId === sessionId) return;
      // Its answer would be about a session the panel no longer shows.
      inFlight.controller.abort();
    }
    void run(sessionId);
  };

  return {
    poll,
    sync() {
      if (disposed) return;
      const asked = inFlight ? inFlight.sessionId : askedFor;
      if (asked !== options.sessionId()) poll();
    },
    inFlightSince: () => inFlight?.startedAt ?? null,
    dispose() {
      disposed = true;
      inFlight?.controller.abort();
      inFlight = null;
    },
  };
}

// ── Tones and labels ──

/** How a mark is drawn: the theme's text, dim and accent colors, or the panel's three state colors. */
export type DebugTone = "ok" | "accent" | "muted" | "dim" | "warning" | "error";

/** A session's name for the panel, from the session list; null when the list does not have it. */
export type DebugTitleOf = (sessionId: string) => string | null;

/** The panel's parts of one line, the empty ones left out. */
export const joinParts = (parts: readonly (string | null | false | undefined)[]) => parts.filter(Boolean).join(" · ");

/** A stream's tone by the page holding it: this page accent, another page muted, none dim. */
export function debugHolderTone(holder: string | null, myHolder: string | null): DebugTone {
  if (holder === null) return "dim";
  return holder === myHolder ? "accent" : "muted";
}

/** "this page 3fa2c1d9", "other page 9e8d7c6b", or "no page id" for a stream opened without one. */
export function debugHolderLabel(holder: string | null, myHolder: string | null, t: Translate): string {
  if (holder === null) return t("debug.holder.none");
  return `${t(holder === myHolder ? "debug.holder.thisPage" : "debug.holder.otherPage")} ${shortDebugId(holder)}`;
}

/** This page's entries first, the rest in the order given. */
export function thisPageFirst<T extends { holder: string | null }>(items: readonly T[], myHolder: string | null): T[] {
  const mine = items.filter((item) => item.holder !== null && item.holder === myHolder);
  return [...mine, ...items.filter((item) => !mine.includes(item))];
}

/** "SSE: 2 (this page 1, other page 1)": a badge run's name, counting this page's apart. */
export function holderGroupLabel(name: string, holders: readonly (string | null)[], myHolder: string | null, t: Translate): string {
  const mine = holders.filter((holder) => holder !== null && holder === myHolder).length;
  return `${name}: ${holders.length} (${t("debug.holder.thisPage")} ${mine}, ${t("debug.holder.otherPage")} ${holders.length - mine})`;
}

/** What a session's status slot shows: awaiting input wins over running, as in the sidebar. */
export type DebugStatusState = "running" | "awaiting" | "alive" | "closing" | "none" | "starting";

export const DEBUG_STATUS_KEYS: Record<DebugStatusState, string> = {
  running: "debug.overlay.running",
  awaiting: "debug.overlay.awaiting",
  alive: "debug.state.alive",
  closing: "debug.state.closing",
  none: "debug.state.none",
  starting: "debug.server.starting",
};

export function debugStatusState(session: { awaitingInput: boolean; running: boolean; state: "alive" | "closing" | "none" }): DebugStatusState {
  if (session.awaitingInput) return "awaiting";
  if (session.running) return "running";
  return session.state;
}

/** A page source's name: a chat stream's session title (else its short id), a watched file's or a terminal's folder name. */
export function sourceDisplayLabel(source: { kind: DebugTrackedEventSourceKind; label: string | null }, titleOf?: DebugTitleOf): string {
  if (source.label === null) return "—";
  if (source.kind === "agent") return titleOf?.(source.label) ?? shortDebugId(source.label);
  return projectNameOf(source.label);
}

// ── Scales ──

/** A value's share of the scale it is drawn against, 0..1; null when there is no scale. */
export function barFraction(value: number, scale: number): number | null {
  if (!(scale > 0)) return null;
  const fraction = value / scale;
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(1, Math.max(0, fraction));
}

/** The time since the chat's stream last sent anything, while its watchdog judges it; else null. */
export function streamFreshness(connection: DebugEventConnectionSnapshot | null, now: number): { ageMs: number; staleAfterMs: number } | null {
  if (!connection || connection.state !== "connected" || !connection.watchdogArmed) return null;
  const staleAfterMs = connection.staleAfterMs;
  if (staleAfterMs === null || !(staleAfterMs > 0) || connection.lastSeenAt === null) return null;
  return { ageMs: Math.max(0, now - connection.lastSeenAt), staleAfterMs };
}

/** Silence on the chat's stream: amber from half the watchdog's limit, red once it is reached. */
export function freshnessTone(ageMs: number, staleAfterMs: number): "dim" | "warning" | "error" {
  if (!(staleAfterMs > 0)) return "dim";
  if (ageMs >= staleAfterMs) return "error";
  return ageMs >= staleAfterMs / 2 ? "warning" : "dim";
}

/** An MCP server's dot: filled for a settled state, a ring while it connects or after it was let go. */
export function mcpServerTone(server: DebugMcpServer): { tone: DebugTone; filled: boolean } {
  if (server.hasError || server.state === "failed" || server.state === "conflict") return { tone: "error", filled: true };
  if (server.released) return { tone: "dim", filled: false };
  if (server.state === "connected") return { tone: "ok", filled: true };
  if (server.state === "connecting") return { tone: "warning", filled: false };
  if (server.state === "needs-auth" || server.state === "not-trusted" || server.state === "disconnected") return { tone: "warning", filled: true };
  return { tone: "muted", filled: false };
}

// ── This page's sources ──

/** HTTP/1.1's connections per origin, for all of a browser's tabs (#1283). */
export const HTTP1_CONNECTIONS = 6;

/** One of this page's sources as the meter draws it. */
export interface DebugPoolSlot {
  id: number;
  kind: DebugTrackedEventSourceKind;
  label: string | null;
  /** The chat's own stream (an agent source for the session the chat works on). */
  chat: boolean;
  connecting: boolean;
  opens: number;
  errors: number;
  createdAt: number;
}

export interface DebugPool {
  protocol: string | null;
  /** Six slots on HTTP/1.1; no slots (null) on h2/h3 or an unknown protocol. */
  cap: typeof HTTP1_CONNECTIONS | null;
  /** The sources drawn, oldest first: at most the cap. */
  slots: DebugPoolSlot[];
  /** Every source this page holds. */
  mine: number;
  /** Sources past the cap. */
  overflow: number;
  /** Every source this page holds, by kind: the meter's name says what its slots count. */
  kinds: Record<DebugTrackedEventSourceKind, number>;
  /** The count's tone: amber at five of six open, red at six or more (a source still connecting holds none). */
  tone: "dim" | "warning" | "error";
}

/** This page's sources against HTTP/1.1's six connections; other pages' streams are never counted here. */
export function poolSlots(sources: readonly DebugTrackedEventSource[], protocol: string | null, chatSessionId: string | null): DebugPool {
  const ordered = [...sources].sort((a, b) => a.createdAt - b.createdAt);
  const all = ordered.map((source): DebugPoolSlot => ({
    id: source.id,
    kind: source.kind,
    label: source.label,
    chat: source.kind === "agent" && chatSessionId !== null && source.label === chatSessionId,
    connecting: source.state === "connecting",
    opens: source.opens,
    errors: source.errors,
    createdAt: source.createdAt,
  }));
  const cap = protocol === "http/1.1" ? HTTP1_CONNECTIONS : null;
  const mine = all.length;
  // Between an EventSource's retries nothing is connected: only open sources take a connection.
  const held = all.filter((slot) => !slot.connecting).length;
  // All of them, those past the cap too.
  const kinds: Record<DebugTrackedEventSourceKind, number> = { agent: 0, "file-watch": 0, terminal: 0 };
  for (const slot of all) kinds[slot.kind] = (kinds[slot.kind] ?? 0) + 1;
  return {
    protocol,
    cap,
    slots: cap === null ? all : all.slice(0, cap),
    mine,
    overflow: cap === null ? 0 : Math.max(0, mine - cap),
    kinds,
    tone: cap === null ? "dim" : held >= cap ? "error" : held >= cap - 1 ? "warning" : "dim",
  };
}

/** "Agent 1", "File watch 2": the kinds this page holds, for the meter's name. */
export function debugPoolKindCounts(pool: DebugPool, t: Translate): string[] {
  return (Object.keys(DEBUG_SOURCE_KIND_KEYS) as DebugTrackedEventSourceKind[])
    .filter((kind) => pool.kinds[kind] > 0)
    .map((kind) => `${t(DEBUG_SOURCE_KIND_KEYS[kind])} ${pool.kinds[kind]}`);
}

/** "File watch · app.tsx · open · opened 1× · 0 errors · 4m 12s ago". */
export function debugSlotTitle(slot: DebugPoolSlot, now: number, t: Translate, titleOf?: DebugTitleOf): string {
  return joinParts([
    t(DEBUG_SOURCE_KIND_KEYS[slot.kind]),
    sourceDisplayLabel(slot, titleOf),
    t(DEBUG_SOURCE_STATE_KEYS[slot.connecting ? "connecting" : "open"]),
    t("debug.page.sourceCounts", { opens: slot.opens, errors: slot.errors }),
    formatAgo(now - slot.createdAt, t),
  ]);
}

/** This page's agent streams for a session: the share of the server's count that is ours. */
export function pageAgentStreamCount(sources: readonly DebugTrackedEventSource[], sessionId: string): number {
  return sources.filter((source) => source.kind === "agent" && source.label === sessionId).length;
}

// ── Poll samples ──

/** Round trips kept per sparkline. */
export const DEBUG_SAMPLE_COUNT = 30;

export interface DebugSample {
  ms: number;
  tone: "dim" | "warning" | "error";
  /** No answer: drawn at full height. */
  failed: boolean;
}

export interface DebugSamples {
  poll: DebugSample[];
  running: DebugSample[];
}

export const EMPTY_DEBUG_SAMPLES: DebugSamples = { poll: [], running: [] };

function answeredSample(ms: number): DebugSample {
  const value = clampMs(ms);
  return { ms: value, tone: value >= DEBUG_POLL_MS ? "warning" : "dim", failed: false };
}

/** The panel's own poll: its round trip, or a failure (a timeout amber, anything else red). */
export function debugPollSample(reading: DebugServerReading): DebugSample | null {
  if (reading.failure) {
    const timeout = reading.failure.kind === "timeout";
    return { ms: timeout ? DEBUG_POLL_TIMEOUT_MS : 0, tone: timeout ? "warning" : "error", failed: true };
  }
  return reading.roundTripMs === null ? null : answeredSample(reading.roundTripMs);
}

/** The sidebar's running poll; an aborted one (the page hid, a newer poll replaced it) is no sample. */
export function runningPollSample(last: DebugRunningPoll["last"]): DebugSample | null {
  if (!last || last.outcome === "aborted") return null;
  if (last.outcome === "error") return { ms: clampMs(last.durationMs), tone: "error", failed: true };
  return answeredSample(last.durationMs);
}

export function pushDebugSample(list: readonly DebugSample[], sample: DebugSample, max = DEBUG_SAMPLE_COUNT): DebugSample[] {
  const next = [...list, sample];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** A bar's height, 0..1: the poll's 5 s timeout is full height, on a square-root scale (20 ms a stub, 2 s most of it). */
export function sparkHeight(ms: number): number {
  return Math.min(1, Math.max(0.08, Math.sqrt(clampMs(ms) / DEBUG_POLL_TIMEOUT_MS)));
}

/** Answered samples only: how many, their median and their longest. */
export function sparkStats(samples: readonly DebugSample[]): { count: number; median: number; max: number } {
  const answered = samples.filter((sample) => !sample.failed).map((sample) => sample.ms).sort((a, b) => a - b);
  if (answered.length === 0) return { count: 0, median: 0, max: 0 };
  const middle = Math.floor(answered.length / 2);
  const median = answered.length % 2 === 1 ? answered[middle] : (answered[middle - 1] + answered[middle]) / 2;
  return { count: answered.length, median, max: answered[answered.length - 1] };
}

// ── Issues ──

export interface DebugIssue {
  id:
    | "poll" | "reader" | "runningPoll" | "pool" | "source" | "stream" | "streamSilent" | "noServerStream"
    | "dropped" | "lease" | "extensions" | "provider" | "mcp";
  tone: "warning" | "error";
  text: string;
}

export interface DebugIssueInput {
  page: DebugPageReading;
  server: DebugServerReading;
  /** The answer's session, only when it is the one the panel shows. */
  detail: DebugSessionDetail | null;
  t: Translate;
  titleOf?: DebugTitleOf;
}

/**
 * Every fault the panel sees, one sentence each, errors first and then warnings, each tone in the
 * order below. Notable states (awaiting input, running, closing, a stream let go while hidden) are
 * not faults: they show in place. The page's own times are on the browser's clock throughout.
 */
export function debugIssues({ page, server, detail, t, titleOf }: DebugIssueInput): DebugIssue[] {
  const now = page.at;
  const issues: DebugIssue[] = [];
  const add = (id: DebugIssue["id"], tone: DebugIssue["tone"], parts: (string | null | false | undefined)[]) => {
    issues.push({ id, tone, text: joinParts(parts) });
  };

  const failure = server.failure;
  if (failure) {
    add("poll", failure.kind === "timeout" ? "warning" : "error", [
      t(DEBUG_POLL_FAILURE_KEYS[failure.kind], { status: failure.status ?? "?" }),
      formatAgo(now - failure.at, t),
    ]);
  } else if (page.pollInFlightSince !== null && now - page.pollInFlightSince >= DEBUG_POLL_MS) {
    // A slow answer is the first sign of a starved connection pool; said before it times out.
    add("poll", "warning", [t("debug.poll.inFlight", { time: formatDebugDuration(now - page.pollInFlightSince, t) })]);
  }

  if (page.clientFailed) add("reader", "error", [t("debug.stream.readerFailed")]);

  const running = page.runningPoll?.last ?? null;
  if (running?.outcome === "error") {
    add("runningPoll", "warning", [
      t("debug.page.runningPoll"),
      t("debug.page.poll.error"),
      running.httpStatus !== null && `HTTP ${running.httpStatus}`,
      formatAgo(now - running.at, t),
    ]);
  }

  // Only open sources: one retrying (the server down, say) holds no connection between attempts.
  const count = page.sources.filter((source) => source.state === "open").length;
  if (page.protocol === "http/1.1" && count >= HTTP1_CONNECTIONS - 1) {
    add("pool", count >= HTTP1_CONNECTIONS ? "error" : "warning", [t("debug.issue.pool", { count })]);
  }

  const client = page.client;
  const connection = client?.connection ?? null;
  const chatId = connection?.sessionId ?? null;
  for (const source of page.sources) {
    if (source.state !== "connecting" || source.errors === 0) continue;
    // The chat's own stream has its own lines below.
    if (source.kind === "agent" && chatId !== null && source.label === chatId) continue;
    add("source", "warning", [
      t(DEBUG_SOURCE_KIND_KEYS[source.kind]),
      sourceDisplayLabel(source, titleOf),
      t("debug.page.source.connecting"),
      t("debug.page.sourceCounts", { opens: source.opens, errors: source.errors }),
    ]);
  }

  if (connection) {
    const retryDue = connection.retryDueAt !== null && t("debug.stream.retryDue", { time: formatCountdown(connection.retryDueAt - now, t) });
    const lastError = connection.lastError;
    // Only while it still matters: a stream that connected again is fine, and so is one closed on
    // purpose after the error (released while hidden, deselected). A retry never stamps a close.
    if (lastError && connection.state !== "connected" && !(connection.lastClose && connection.lastClose.at >= lastError.at)) {
      add("stream", "error", [
        translateDebugCode(lastError.reason, DEBUG_STREAM_ERROR_KEYS, t),
        lastError.message,
        formatAgo(now - lastError.at, t),
        retryDue,
      ]);
    } else if (connection.state === "retrying") {
      add("stream", "warning", [t(DEBUG_STREAM_STATE_KEYS.retrying), retryDue]);
    }
    const freshness = streamFreshness(connection, now);
    const tone = freshness ? freshnessTone(freshness.ageMs, freshness.staleAfterMs) : "dim";
    if (freshness && tone !== "dim") add("streamSilent", tone, [`${t("debug.stream.lastData")} ${formatAgo(freshness.ageMs, t)}`]);
  }

  // Cross-checks with the server: only about what the page had before the answer's request left.
  const myHolder = client?.pageId ?? null;
  const requestStartedAt = server.receivedAt !== null ? server.receivedAt - (server.roundTripMs ?? 0) : null;
  if (
    detail && myHolder && connection && requestStartedAt !== null
    && connection.state === "connected"
    && connection.sessionId === detail.sessionId
    && connection.connectedAt !== null && connection.connectedAt < requestStartedAt
    && !detail.eventStreams.some((stream) => stream.holder === myHolder)
  ) {
    add("noServerStream", "warning", [t("debug.issue.noServerStream")]);
  }
  for (const stream of detail?.eventStreams ?? []) {
    if (stream.droppedEvents > 0) {
      add("dropped", "warning", [debugHolderLabel(stream.holder, myHolder, t), t("debug.server.dropped", { count: stream.droppedEvents })]);
    }
  }

  const lease = client?.lease ?? null;
  if (lease) {
    const last = lease.last;
    if (lease.inFlightSince !== null && now - lease.inFlightSince >= DEBUG_POLL_MS) {
      add("lease", "warning", [t("debug.section.lease"), t("debug.lease.inFlight", { time: formatDebugDuration(now - lease.inFlightSince, t) })]);
    } else if (last?.outcome === "error") {
      add("lease", "error", [
        t("debug.section.lease"),
        t(DEBUG_LEASE_OUTCOME_KEYS.error),
        last.httpStatus !== null && `HTTP ${last.httpStatus}`,
        formatAgo(now - last.at, t),
      ]);
    } else if (last?.outcome === "unanswered") {
      add("lease", "warning", [t("debug.section.lease"), t(DEBUG_LEASE_OUTCOME_KEYS.unanswered), formatAgo(now - last.at, t)]);
    }
  }

  const wrapper = detail?.wrapper ?? null;
  if (wrapper && !wrapper.stale && wrapper.extensions === "failed") {
    add("extensions", "error", [t("debug.server.extensions"), t(DEBUG_EXTENSIONS_KEYS.failed)]);
  }
  for (const provider of detail?.providers ?? []) {
    if (provider.active === "error") add("provider", "error", [provider.name, t("debug.server.providerError")]);
  }
  for (const mcpServer of detail?.mcp?.servers ?? []) {
    if (mcpServer.hasError || mcpServer.state === "failed" || mcpServer.state === "conflict") {
      add("mcp", "error", [`MCP ${mcpServer.name}`, translateDebugCode(mcpServer.state, MCP_SESSION_STATE_KEYS, t)]);
    }
  }

  // Array.prototype.sort is stable: each tone keeps the order above.
  return issues.sort((a, b) => Number(b.tone === "error") - Number(a.tone === "error"));
}

export interface DebugVerdict {
  kind: "reading" | "hidden" | "issues" | "waiting" | "ok";
  tone: DebugTone;
  count: number;
}

/** The header's one word: OK, the number of issues, or why there is nothing to judge yet. */
export function debugVerdict(page: DebugPageReading | null, server: DebugServerReading, issues: readonly DebugIssue[]): DebugVerdict {
  if (page === null) return { kind: "reading", tone: "dim", count: 0 };
  if (page.visibility?.state === "hidden") return { kind: "hidden", tone: "dim", count: 0 };
  if (issues.length > 0) {
    return { kind: "issues", tone: issues.some((issue) => issue.tone === "error") ? "error" : "warning", count: issues.length };
  }
  if (server.receivedAt === null) return { kind: "waiting", tone: "dim", count: 0 };
  return { kind: "ok", tone: "ok", count: 0 };
}

// ── Sessions on the server ──

export interface DebugSessionRow {
  id: string;
  /** 1: a subagent under its family's root. */
  depth: 0 | 1;
  info: SessionInfo | null;
  /** Null for a placeholder: a root the server holds nothing for, shown for its subagents. */
  summary: DebugSessionSummary | null;
  /** The session the panel shows (its card has the details). */
  current: boolean;
  placeholder: boolean;
}

export interface DebugSessionGroup {
  key: string;
  /** The project's folder name; null for the sessions the session list does not have. */
  name: string | null;
  rows: DebugSessionRow[];
}

const MAX_FAMILY_DEPTH = 32;
const UNLISTED_GROUP_KEY = "\u0000unlisted";

/** Last activity; an unparsable time sorts as the oldest. */
function modifiedAt(info: SessionInfo): number {
  const at = Date.parse(info.modified);
  return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
}

/** Newest first, without subtracting infinities (NaN). */
function newestFirst(a: number, b: number): number {
  return a === b ? 0 : b > a ? 1 : -1;
}

/**
 * The sessions the server holds something for, grouped like the sidebar: by project, each family
 * under its root (subagents one level in, newest first), the chat's family and its project first,
 * then by the roots' last activity. Sessions the list does not have go last, by short id, unless
 * the chat's own session is one of them. The chat's session gets a row only when the server holds
 * something for it or its family.
 */
export function groupDebugSessions(
  summaries: readonly DebugSessionSummary[],
  byId: ReadonlyMap<string, SessionInfo>,
  currentId: string | null,
): DebugSessionGroup[] {
  // Up the subagent parents while the list has them. Parents that loop make no family: each member
  // stands as its own root, so no session gets two rows.
  const rootOf = (info: SessionInfo): SessionInfo => {
    let node = info;
    const seen = new Set([info.id]);
    for (let step = 0; step < MAX_FAMILY_DEPTH; step++) {
      const relation = node.relation;
      if (relation?.kind !== "subagent") break;
      const parent = byId.get(relation.parentSessionId);
      if (!parent) break;
      if (seen.has(parent.id)) return info;
      seen.add(parent.id);
      node = parent;
    }
    return node;
  };

  interface Family {
    root: SessionInfo;
    summary: DebugSessionSummary | null;
    subagents: { info: SessionInfo; summary: DebugSessionSummary }[];
  }
  const families = new Map<string, Family>();
  const unlisted: DebugSessionSummary[] = [];
  for (const summary of summaries) {
    const info = byId.get(summary.sessionId);
    if (!info) {
      unlisted.push(summary);
      continue;
    }
    const root = rootOf(info);
    let family = families.get(root.id);
    if (!family) {
      family = { root, summary: null, subagents: [] };
      families.set(root.id, family);
    }
    if (root.id === info.id) family.summary = summary;
    else family.subagents.push({ info, summary });
  }

  const currentInfo = currentId === null ? undefined : byId.get(currentId);
  const currentRootId = currentInfo ? rootOf(currentInfo).id : null;
  const byNewest = (a: Family, b: Family) => newestFirst(modifiedAt(a.root), modifiedAt(b.root));
  const currentFirst = (a: Family, b: Family) => Number(b.root.id === currentRootId) - Number(a.root.id === currentRootId);

  const projects = new Map<string, { key: string; name: string; families: Family[] }>();
  for (const family of families.values()) {
    const key = workspaceKeyOf(family.root);
    let project = projects.get(key);
    if (!project) {
      project = { key, name: projectNameOf(family.root.projectRoot ?? family.root.cwd), families: [] };
      projects.set(key, project);
    }
    project.families.push(family);
  }
  const newestIn = (project: { families: Family[] }) => Math.max(...project.families.map((family) => modifiedAt(family.root)));
  const holdsCurrent = (project: { families: Family[] }) => project.families.some((family) => family.root.id === currentRootId);
  const ordered = [...projects.values()].sort((a, b) => Number(holdsCurrent(b)) - Number(holdsCurrent(a)) || newestFirst(newestIn(a), newestIn(b)));

  const groups: DebugSessionGroup[] = ordered.map((project) => {
    const rows: DebugSessionRow[] = [];
    for (const family of [...project.families].sort(byNewest).sort(currentFirst)) {
      rows.push({
        id: family.root.id,
        depth: 0,
        info: family.root,
        summary: family.summary,
        current: family.root.id === currentId,
        placeholder: family.summary === null,
      });
      const subagents = [...family.subagents].sort((a, b) => newestFirst(modifiedAt(a.info), modifiedAt(b.info)));
      for (const { info, summary } of subagents) {
        rows.push({ id: info.id, depth: 1, info, summary, current: info.id === currentId, placeholder: false });
      }
    }
    return { key: project.key, name: project.name, rows };
  });

  if (unlisted.length > 0) {
    const currentUnlisted = currentId !== null && !currentInfo && unlisted.some((summary) => summary.sessionId === currentId);
    // By short id, then the full id: never the server's registry order, which moves a session to
    // the end each time its stream reconnects.
    const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const rows = [...unlisted]
      .sort((a, b) => Number(b.sessionId === currentId) - Number(a.sessionId === currentId)
        || compareIds(shortDebugId(a.sessionId), shortDebugId(b.sessionId))
        || compareIds(a.sessionId, b.sessionId))
      .map((summary): DebugSessionRow => ({
        id: summary.sessionId,
        depth: 0,
        info: null,
        summary,
        current: summary.sessionId === currentId,
        placeholder: false,
      }));
    const group = { key: UNLISTED_GROUP_KEY, name: null, rows };
    if (currentUnlisted) groups.unshift(group);
    else groups.push(group);
  }
  return groups;
}

/** A session row's tooltip: "a1b2c3d4 · alive · running · 2 event streams · idle check in 8m · started 2×". */
export function debugSessionTitle(summary: DebugSessionSummary, idleInMs: number | null, t: Translate): string {
  const parts = [
    summary.subagent ? t("debug.overlay.subagentId", { id: shortDebugId(summary.sessionId) }) : shortDebugId(summary.sessionId),
    t(DEBUG_SESSION_STATE_KEYS[summary.state] ?? DEBUG_SESSION_STATE_KEYS.none),
  ];
  if (summary.running) parts.push(t("debug.overlay.running"));
  if (summary.awaitingInput) parts.push(t("debug.overlay.awaiting"));
  if (summary.eventStreams > 0) parts.push(t("debug.overlay.streams", { count: summary.eventStreams }));
  if (summary.providers > 0) parts.push(t("debug.overlay.providers", { count: summary.providers }));
  if (idleInMs !== null) {
    parts.push(t(summary.forcedByStop ? "debug.overlay.closesIn" : "debug.overlay.idle", { time: formatShortDebugDuration(idleInMs, t) }));
  }
  if (summary.starts > 1) parts.push(t("debug.overlay.starts", { count: summary.starts }));
  return parts.join(" · ");
}

// ── Keyboard ──

interface EscapeEvent {
  key: string;
  defaultPrevented: boolean;
  /** Set once a handler stopped it: React's handlers run from `document` too, before the panel's. */
  cancelBubble?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

/**
 * Whether an Escape that reached `document` closes the panel: not one something nearer took
 * (a menu, ChatInput stopping a run: preventDefault; the sidebar's search clearing itself:
 * stopPropagation), not an IME's, and not while a dialog is open over the page. Taking it
 * (preventDefault) keeps the window's Stop shortcut from also stopping the run.
 */
export function shouldCloseDebugPanelOnEscape(event: EscapeEvent, dialogOpen: boolean): boolean {
  return event.key === "Escape"
    && !event.defaultPrevented
    && !event.cancelBubble
    && !event.isComposing
    && event.keyCode !== 229
    && !dialogOpen;
}

/** The part of `document` the panel's Escape reads; tests hand over a stand-in. */
export interface DebugEscapeDocument {
  readonly activeElement: Element | null;
  querySelector(selector: string): Element | null;
}

/**
 * The panel's Escape listener for `document`. `onClose` hears whether focus was inside the panel,
 * which leaves the page with it: the caller then gives focus back to the Debug button. Focus
 * anywhere else (the composer, the button itself) stays where it is.
 */
export function createDebugPanelEscapeListener(
  doc: DebugEscapeDocument,
  panel: () => { contains(other: Element | null): boolean } | null,
  onClose: (restoreFocus: boolean) => void,
): (event: EscapeEvent & { preventDefault(): void }) => void {
  return (event) => {
    if (!shouldCloseDebugPanelOnEscape(event, doc.querySelector('[aria-modal="true"]') !== null)) return;
    event.preventDefault();
    const active = doc.activeElement;
    onClose(Boolean(active && panel()?.contains(active)));
  };
}
