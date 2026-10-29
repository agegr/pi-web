/**
 * Client-safe shapes of the debug panel: what `GET /api/agent/debug` answers and what the page
 * reads about itself. Everything here is a state, a count or a time (epoch ms on the clock of the
 * side that recorded it); never a prompt, a message, a path inside a session or a config value.
 * Reading any of it starts, keeps alive or reconnects nothing.
 */

// ── Server: GET /api/agent/debug?session=<id> ────────────────────────────────

export interface DebugWrapperRun {
  /** `isRunning()`: a prompt, a queued one, a `!` command or a compaction. */
  running: boolean;
  streaming: boolean;
  promptRunning: boolean;
  /**
   * Prompt calls in flight beyond the running one (a second prompt still passing admission or an
   * input handler); 0 during an ordinary run. Queued steers and follow-ups are `queuedMessages`.
   */
  pendingPrompts: number;
  bashRunning: boolean;
  compacting: boolean;
  retrying: boolean;
  /** Steering and follow-up messages the SDK holds (a count, never their text). */
  queuedMessages: number;
  waitingForMcp: boolean;
  runningTools: number;
  mutatingCommands: number;
  replacement: "fork" | "clone" | null;
}

export interface DebugWrapperIdle {
  /** `PI_WEB_IDLE_TIMEOUT_MS` in effect; 0 = disabled (Stop still arms its forced deadline). */
  timeoutMs: number;
  /**
   * When the idle timer fires next. A check, not a close: a run or an extension's liveness
   * provider re-arms a full timeout then, unless `forcedByStop`; a page's lease renewal moves it
   * a full timeout on. Null: not armed.
   */
  nextCheckAt: number | null;
  lastResetAt: number | null;
  /** Stop set `forceShutdownOnIdle`: the wrapper closes at `nextCheckAt` even while it runs. */
  forcedByStop: boolean;
}

export interface DebugWrapperSnapshot {
  sessionId: string;
  /** "closing" from the moment `shutdown()`/`destroy()` starts until it is disposed. */
  state: "alive" | "closing";
  /** A wrapper built before a hot reload (dev): only `state` and `run.running` are known. */
  stale: boolean;
  subagent: boolean;
  chatOnly: boolean;
  createdAt: number | null;
  startedAt: number | null;
  closingAt: number | null;
  extensions: "binding" | "bound" | "failed" | "none";
  run: DebugWrapperRun;
  idle: DebugWrapperIdle;
  awaitingInput: boolean;
  pendingUiRequests: number;
  customUis: number;
  /** Listeners on the wrapper; each is an open event stream. */
  eventListeners: number;
  /** Last SDK event and last command the wrapper saw (status reads, `get_state`, left out): their type only. */
  lastEvent: { type: string; at: number } | null;
  lastCommand: { type: string; at: number } | null;
}

/** Process-wide history of one session id (survives the wrapper; bounded). */
export interface DebugSessionLifecycle {
  /** Wrappers started for this id since the server started (> 1: rebuilt after a close). */
  starts: number;
  firstStartedAt: number;
  lastStartedAt: number;
  lastClosedAt: number | null;
}

/** An extension's entry in the liveness registry. */
export interface DebugLivenessProvider {
  name: string;
  /** What its `isActive()` answered just now; "error" when it threw or returned a non-boolean. */
  active: boolean | "error";
  /** Registered by session file rather than id. */
  byFile: boolean;
}

/** One open `GET /api/agent/[id]/events` response on the server. */
export interface DebugEventStream {
  /** The page id the stream was opened with (`?holder=`); null for an older page. */
  holder: string | null;
  openedAt: number;
  /** When `connected` was written; null while the stream still starts the wrapper. */
  connectedAt: number | null;
  lastWriteAt: number | null;
  droppedEvents: number;
  /** Bytes the browser has not read yet. */
  queuedBytes: number;
}

export interface DebugSubagentRun {
  sessionId: string;
  parentSessionId: string;
  status: string;
  profile: string | null;
  background: boolean;
  resumed: boolean;
  /** When this run (or resume) entered the run map. */
  dispatchedAt: number | null;
  abortRequested: boolean;
  mcpWaiting: boolean;
}

/** A background run's completion still being delivered to its parent (`notifyParent()`). */
export interface DebugParentNotification {
  sessionId: string;
  parentSessionId: string;
  since: number | null;
}

export interface DebugMcpServer {
  name: string;
  scope: string;
  state: string;
  hasError: boolean;
  released: boolean;
}

export interface DebugMcpHost {
  active: boolean;
  disposed: boolean;
  runActive: boolean;
  /** `PI_WEB_MCP_IDLE_MS`; 0 = never released. */
  idleMs: number;
  /** When idle servers are let go; null while a run is active or nothing is connected. */
  idleReleaseAt: number | null;
  servers: DebugMcpServer[];
  /** Servers that are configured but not registered or not trusted. */
  problems: number;
}

export interface DebugSessionDetail {
  sessionId: string;
  wrapper: DebugWrapperSnapshot | null;
  lifecycle: DebugSessionLifecycle | null;
  /** A `startRpcSession()` under way for this id. */
  starting: boolean;
  /** Null: the registry predates this server code (dev hot reload) and cannot list. */
  providers: DebugLivenessProvider[] | null;
  eventStreams: DebugEventStream[];
  subagents: {
    /** `hasUnsettledSubagentRun()`: what keeps a hidden page's stream open. */
    active: boolean;
    runs: DebugSubagentRun[];
    notifications: DebugParentNotification[];
  };
  /** Null: no wrapper, or a session without an MCP host (Chat only, MCP unavailable). */
  mcp: DebugMcpHost | null;
}

/** One session the server holds something for: a wrapper or an event stream. */
export interface DebugSessionSummary {
  sessionId: string;
  state: "alive" | "closing" | "none";
  running: boolean;
  awaitingInput: boolean;
  subagent: boolean;
  eventStreams: number;
  /**
   * Extension liveness providers registered for the session. Only the detail asks them whether
   * they are active: a summary runs no extension code.
   */
  providers: number;
  nextIdleCheckAt: number | null;
  forcedByStop: boolean;
  starts: number;
}

export interface DebugServerGlobal {
  /** Process start, so a server restart reads apart from a reaped wrapper. */
  startedAt: number;
  idleTimeoutMs: number;
  heartbeatMs: number;
  /**
   * `starting`: `startRpcSession()` calls under way with no alive wrapper yet, a fresh composer's
   * (`__new__…`) and a rebuild's (`__recreate__…`) included.
   */
  wrappers: { alive: number; closing: number; starting: number };
  eventStreams: {
    /** Every open agent event stream, from all pages and browsers. */
    total: number;
    /** Streams per page id (null: opened without one). */
    byHolder: { holder: string | null; count: number }[];
  };
  fileWatches: number;
  terminals: {
    count: number;
    /** Open terminal event streams. */
    listeners: number;
    /** Shells with no stream, killed at their cleanup time unless one reattaches. */
    detached: number;
    exited: number;
    nextCleanupAt: number | null;
  };
}

export interface DebugSnapshotResponse {
  /** Server clock when the snapshot was taken: subtract it, never the browser's clock. */
  now: number;
  server: DebugServerGlobal;
  sessions: DebugSessionSummary[];
  /** Detail of `?session=`; null without one. */
  session: DebugSessionDetail | null;
}

// ── Browser: the page and its selected session ───────────────────────────────

export type DebugEventStreamState =
  /** No stream and no retry pending. */
  | "idle"
  /** Opened, waiting for `connected`. */
  | "connecting"
  | "connected"
  /** Dropped; a reconnect is scheduled. */
  | "retrying";

/**
 * Why the page closed its stream: "released" (hidden page, #1283), "grace_end" (a non-selected id's
 * grace ran out), "send_failed", "set_tools" (a tool change moved to a new id), "rebuilt" (the
 * server rebuilt the wrapper), "deselected" (another session was shown), "stuck" (a source never
 * left CONNECTING), "replaced" (a stream for another id took its place).
 */
export type DebugStreamCloseReason =
  | "released"
  | "grace_end"
  | "send_failed"
  | "set_tools"
  | "rebuilt"
  | "deselected"
  | "stuck"
  | "replaced";

export interface DebugEventConnectionSnapshot {
  sessionId: string | null;
  state: DebugEventStreamState;
  /** EventSource.readyState (0 connecting, 1 open, 2 closed); null without a source. */
  readyState: number | null;
  openedAt: number | null;
  connectedAt: number | null;
  /** Last data of any kind, heartbeats included (what the watchdog judges). */
  lastSeenAt: number | null;
  lastHeartbeatAt: number | null;
  /** Events handed to the page (heartbeats excluded) on the current stream. */
  events: number;
  /** Sources opened by this connection object (one per page mount and session). */
  opens: number;
  /** Reconnects after a drop. */
  retries: number;
  retryDueAt: number | null;
  watchdogArmed: boolean;
  staleAfterMs: number | null;
  lastError: { reason: "ready_timeout" | "startup_error" | "error" | "stale"; message: string | null; at: number } | null;
  lastClose: { reason: DebugStreamCloseReason | null; at: number } | null;
}

export interface DebugLeaseReplySummary {
  running: boolean;
  awaitingInput: boolean;
  subagentsActive: boolean;
}

export interface DebugClientLease {
  renewIntervalMs: number;
  /** When the renewal interval started (the next renewal is a multiple of the interval later). */
  renewStartedAt: number | null;
  inFlightSince: number | null;
  requests: number;
  unanswered: number;
  errors: number;
  last: {
    at: number;
    durationMs: number;
    /** "unanswered": no reply within SESSION_LEASE_TIMEOUT_MS (a starved HTTP/1.1 pool) or no network. */
    outcome: "reply" | "unanswered" | "error";
    httpStatus: number | null;
    reply: DebugLeaseReplySummary | null;
  } | null;
}

export interface DebugClientSession {
  /** This page's id (the `?holder=` of its event streams); null until the page first made one. */
  pageId: string | null;
  /** The id the chat works on (a fresh composer's session before its prop catches up). */
  sessionId: string | null;
  selectedSessionId: string | null;
  mounted: boolean;
  /** What `shouldMaintain()` answers now: whether the page wants the stream open. */
  wantsStream: boolean;
  connection: DebugEventConnectionSnapshot | null;
  /** The selected session's idle stream let go while the page was hidden (#1283). */
  released: { active: boolean; count: number; lastAt: number | null };
  reattached: { count: number; lastAt: number | null; lastReason: "visible" | "activity" | null };
  /** The hidden-page release check; null when not armed (page visible, or the stream is busy). */
  hiddenReleaseDueAt: number | null;
  hiddenGraceMs: number;
  /** A non-selected id's 30 s grace before its stream closes; null when none. */
  graceDueAt: number | null;
  run: { agentRunning: boolean; bashRunning: boolean; compacting: boolean; dialogs: number };
  lease: DebugClientLease;
}

export type DebugTrackedEventSourceKind = "agent" | "file-watch" | "terminal";

/** An EventSource this page holds open (or is reconnecting). */
export interface DebugTrackedEventSource {
  id: number;
  kind: DebugTrackedEventSourceKind;
  label: string | null;
  state: "connecting" | "open";
  createdAt: number;
  opens: number;
  errors: number;
  lastOpenAt: number | null;
  lastErrorAt: number | null;
}

export interface DebugPageVisibility {
  state: "visible" | "hidden";
  /** Since tracking started (the page's first chat mount). */
  trackingSince: number | null;
  lastHiddenAt: number | null;
  lastVisibleAt: number | null;
  hiddenCount: number;
}

/** The sidebar's `GET /api/agent/running` poll (every 2.5 s while visible): the page's heartbeat to the server. */
export interface DebugRunningPoll {
  count: number;
  failures: number;
  last: {
    at: number;
    durationMs: number;
    /** "aborted": the page hid or a newer poll replaced it. */
    outcome: "ok" | "error" | "aborted";
    httpStatus: number | null;
  } | null;
}
