import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  type ExtensionContext,
  type InlineExtension,
  type McpExposure,
  type McpServerConfig,
  type McpServerEntry,
  type McpTransportFactory,
} from "@earendil-works/pi-coding-agent";
import type { McpHostInactiveInfo, McpScope, McpSessionState, McpSessionStatus } from "./api-types";
import { isBuiltinMcpCommand, isMcpExtensionCommand } from "./mcp-command";
import { canonicalJson, mcpConfigKey } from "./mcp-config-key";
import { scrubMcpLoadError } from "./mcp-json-error";
import {
  forgetMcpHostInactive,
  forgetMcpStatus,
  isCurrentMcpStatus,
  mcpStatusKey,
  recordMcpHostInactive,
  recordMcpStatus,
  replaceMcpStatus,
  type McpStatusEntry,
} from "./mcp-status";
import { createTestRedactor, maskStatusError, maskStatusStderr } from "./mcp-test";
import { hasParentDirectorySegment, isPathWithinRoots, resolveRealRoots } from "./path-security";
import type { McpTransport, PiSdkInternals } from "./pi-sdk-internals";
import { mayReadProjectConfigNow } from "./project-trust";

export { canonicalJson };

// Pi Web decides which MCP servers a session connects (ADR 0006). The SDK's
// MCP extension is created with a `loadConfig` that returns no servers; this
// host reads `mcp.json` itself and hands the servers it wants to the extension
// through `pi.registerMcpServer()`:
//
// - Nothing connects until a session prompts. Browsing, switching sessions,
//   auto-naming and forking build wrappers that never prompt.
// - Before every prompt the wrapper asks the host to sync. Servers whose entry
//   changed are unregistered and registered again, so a change made anywhere
//   (the panel, `pi mcp add`, an editor, `git pull`) reaches every open session
//   on its next message without a reload. The prompt then waits up to 10 s for
//   servers still connecting, and Stop ends that wait.
// - A host that has not prompted for PI_WEB_MCP_IDLE_MS unregisters its servers.
// - Project trust is read fresh on every sync too, never taken from the
//   wrapper (see desiredServers()).
//
// The extension does not report connection state, so the host watches the
// transports it creates through the factory pi-web gives it. A transport exists
// only once the extension has assigned the server's connection, which is what
// makes unregistering safe: before that, the extension's removal finds no
// connection to close, then connects the server anyway and loses it. What the
// host sees — every transport of a server, reconnects included, and what
// stops it registering one — goes to the status store (`lib/mcp-status.ts`)
// for Settings › MCP, keyed by the entry as its file holds it.

export const MCP_HOST_EXTENSION_NAME = "pi-web-mcp-host";

const DEFAULT_MCP_IDLE_MS = 10 * 60 * 1000;
const PROMPT_WAIT_MS = 10_000;
/**
 * How long an unregister waits for the extension to start a connection it can
 * close. One that starts later is refused its transport (`refuseAbandoned()`).
 */
const REPLACE_WAIT_MS = 5_000;
const LIST_METHODS = new Set(["tools/list", "resources/list", "resources/templates/list"]);

/**
 * PI_WEB_MCP_IDLE_MS: how long a session's MCP servers stay connected after its
 * last run. Unset or blank is 10 minutes, `0` keeps them until the session
 * closes, and invalid values fall back to the default with a warning.
 */
export function resolveMcpIdleMs(rawValue: string | undefined = process.env.PI_WEB_MCP_IDLE_MS): number {
  if (rawValue !== undefined && rawValue.trim() !== "") {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 2_147_483_647) return parsed;
    console.warn(`[pi-web] invalid PI_WEB_MCP_IDLE_MS "${rawValue}", falling back to 10 minutes`);
  }
  return DEFAULT_MCP_IDLE_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Hot reload re-evaluates this module; globalThis keeps one log line per error per process.
const CONFIG_ERRORS_LOGGED_KEY: symbol = Symbol.for("pi-web:mcp-config-errors-logged");
const CONFIG_ERRORS_LOGGED_MAX = 200;
/** How many of `loadMcpConfig().errors` one sync logs; well below what the set holds. */
const CONFIG_ERRORS_LOGGED_PER_SYNC = 20;

/**
 * Log an `mcp.json` problem once. Every open session syncs twice per prompt,
 * and a file that stays broken would otherwise repeat the same line each time.
 */
function logConfigErrorOnce(message: string): void {
  const store = globalThis as Record<symbol, Set<string> | undefined>;
  const logged = (store[CONFIG_ERRORS_LOGGED_KEY] ??= new Set());
  if (logged.has(message)) return;
  // The oldest goes, never the whole set: a file with more errors than the set holds
  // would otherwise log every one of them again at each sync.
  if (logged.size >= CONFIG_ERRORS_LOGGED_MAX) logged.delete(logged.values().next().value as string);
  logged.add(message);
  console.warn(`[pi-web] MCP config: ${message}`);
}

/**
 * How many of an untrusted project's entries a sync reports as `not-trusted`.
 * Every one is a record in the status store, which holds 500 across all
 * entries, and a repository can declare tens of thousands: reporting each would
 * evict every other record (the user's Tests, other sessions' reports) and
 * block the event loop on every prompt. Settings lists at most 200 entries of a
 * project file (`MCP_PROJECT_MAX_SERVERS`), and reads trust itself.
 */
export const MCP_UNTRUSTED_REPORT_MAX = 100;

const PROJECT_CONFIG_MAX_BYTES = 1024 * 1024;
/** Windows defines neither flag; it has no FIFOs, and the realpath check still refuses a link that leads outside. */
const NAMES_OPEN_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK || 0) | (constants.O_NOFOLLOW || 0);

/**
 * The entries an untrusted project's `.pi/mcp.json` declares, so the host can
 * report why they do not connect: each name with its raw value, which is only
 * hashed into the key its status is recorded under (`mcpConfigKey()`), never
 * validated, resolved, or run. The file is repository-controlled and read
 * before anyone trusted it, so only a regular file of at most 1 MiB that
 * resolves inside the project is parsed. The resolved path is opened once,
 * without following a link swapped in since and without blocking on a FIFO,
 * and the checks run on what was opened rather than on the path again: a link
 * to a file elsewhere on the disk is refused before opening, and a FIFO or a
 * device is opened without blocking and never read.
 */
export function untrustedProjectServerEntries(cwd: string): [name: string, value: unknown][] {
  const path = join(cwd, CONFIG_DIR_NAME, "mcp.json");
  let fd: number | undefined;
  try {
    if (hasParentDirectorySegment(path)) return [];
    const realPath = realpathSync(path);
    if (!isPathWithinRoots(realPath, resolveRealRoots(new Set([cwd])))) return [];
    fd = openSync(realPath, NAMES_OPEN_FLAGS);
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.size > PROJECT_CONFIG_MAX_BYTES) return [];
    // One byte past the size it reported: a file still growing is not parsed.
    const buffer = Buffer.alloc(stats.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > stats.size) return [];
    const parsed: unknown = JSON.parse(buffer.toString("utf8", 0, length));
    return isRecord(parsed) && isRecord(parsed.mcpServers) ? Object.entries(parsed.mcpServers) : [];
  } catch {
    // Missing, unreadable, swapped for a link, or not JSON: there are no names to report.
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const SCRIPT_EXPOSURES = new Set<McpExposure>(["codemode", "codemode-deferred"]);

/**
 * Without a working codemode sandbox, tools only scripts can reach would be
 * unreachable; `deferred` offers them through `tool_search` instead.
 */
export function withReachableExposure(config: McpServerConfig, codemodeAvailable: boolean): McpServerConfig {
  if (codemodeAvailable) return config;
  const exposure = config.exposure ?? "codemode";
  const toolExposure = config.toolExposure
    ? Object.fromEntries(Object.entries(config.toolExposure).map(([tool, value]) => [
        tool,
        SCRIPT_EXPOSURES.has(value) ? "deferred" as const : value,
      ]))
    : undefined;
  return {
    ...config,
    exposure: SCRIPT_EXPOSURES.has(exposure) ? "deferred" : exposure,
    ...(toolExposure ? { toolExposure } : {}),
  };
}

// ---------------------------------------------------------------------------
// Watching a connection through its transport
// ---------------------------------------------------------------------------

/** The part of pi-mcp's `McpTransport` the host observes. */
interface ObservedTransport {
  send(message: unknown): Promise<void>;
  start?(): Promise<void>;
  close?(): Promise<void>;
  onMessage(listener: (message: unknown) => void): () => void;
  onClose(listener: () => void): () => void;
  /** A stdio transport's stderr so far (pi-mcp keeps at most 64 KiB). */
  readonly stderr?: unknown;
}

/**
 * Report when a connection is ready, meaning the extension has registered its
 * tools, or when its transport closed first. The client sends `initialize`,
 * then `notifications/initialized`, then lists tools and resources when the
 * server's capabilities offer them, a page at a time; the extension registers
 * the tools in the same microtask chain that settles the last list. So once
 * every list request is answered and a macrotask passed without another one,
 * the tools are registered. Listening adds a listener and an own `send` on the
 * instance; the transport keeps its class, which the SDK checks.
 */
export function watchConnection(transport: ObservedTransport, done: (outcome: "ready" | "closed") => void): void {
  let finished = false;
  let initialized = false;
  let expectsLists: boolean | undefined;
  let listsSent = 0;
  const pending = new Set<unknown>();
  const finish = (outcome: "ready" | "closed") => {
    if (finished) return;
    finished = true;
    done(outcome);
  };
  const check = () => {
    setImmediate(() => {
      if (finished || !initialized || expectsLists === undefined || pending.size > 0) return;
      if (expectsLists && listsSent === 0) return;
      finish("ready");
    });
  };
  const send = transport.send.bind(transport);
  transport.send = (message: unknown) => {
    if (isRecord(message) && typeof message.method === "string") {
      if (message.id !== undefined && LIST_METHODS.has(message.method)) {
        pending.add(message.id);
        listsSent += 1;
      } else if (message.id === undefined && message.method === "notifications/initialized") {
        initialized = true;
        check();
      }
    }
    return send(message);
  };
  transport.onMessage((message) => {
    if (!isRecord(message) || message.method !== undefined || message.id === undefined) return;
    if (expectsLists === undefined && isRecord(message.result) && isRecord(message.result.capabilities)) {
      const { capabilities } = message.result;
      // As the SDK decides: tools when the capability is set, resources when it is present.
      expectsLists = Boolean(capabilities.tools) || capabilities.resources !== undefined;
      check();
      return;
    }
    if (pending.delete(message.id)) check();
  });
  transport.onClose(() => finish("closed"));
}

/** What one transport of a server did, as `watchTransport()` reports it. */
export type McpTransportEvent =
  | { type: "ready" }
  /** It closed before the server was ready: the connection failed, or the server asked for a sign-in. */
  | { type: "failed"; authRequired: boolean; error?: unknown; stderr?: string }
  /**
   * It closed after it was ready: `dropped` when it closed by itself (a stdio
   * server that exited), not when the client closed it (a session ending, a
   * reconnect, a sign-in asked for by a later request, which `authRequired` says).
   */
  | { type: "closed"; dropped: boolean; authRequired: boolean; stderr?: string };

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

/**
 * Whether a request failed because the server wants an OAuth sign-in, as the
 * SDK's `McpServerConnection.needsSignIn()` decides: the auth provider gave
 * up (`McpOAuthAuthorizationRequiredError`), or an OAuth server still answered
 * 401 (`McpAuthRequiredError`). A server with an `Authorization` header gets
 * no auth provider, and its 401 is a failure. Told by name: neither class is
 * among the SDK modules Pi Web loads, and a second module copy would defeat
 * `instanceof` anyway.
 */
function asksForSignIn(error: unknown, usesOAuth: boolean): boolean {
  const name = errorName(error);
  return name === "McpOAuthAuthorizationRequiredError" || (usesOAuth && name === "McpAuthRequiredError");
}

/**
 * Follow one transport for its whole life: ready or failed, as
 * `watchConnection()` decides, then whether it closes afterwards. Like that,
 * it adds listeners and own `start`, `send` and `close` properties on the
 * instance, never a wrapper object. What it notes along the way:
 * - the first error `start` or a request's `send` rejected with (a spawn
 *   failure, an HTTP error), or the server's error answer to `initialize`; a
 *   request on a transport already closed says nothing and is skipped;
 * - whether one of those asked for a sign-in;
 * - whether anything called `close()`: a transport closing on its own is a
 *   drop, one the client closed is not news;
 * - a stdio server's stderr, read when it closes.
 */
export function watchTransport(
  transport: ObservedTransport,
  usesOAuth: boolean,
  report: (event: McpTransportEvent) => void,
): void {
  let ready = false;
  let authRequired = false;
  let failure: unknown;
  let closeCalled = false;
  let initializeId: unknown;
  const note = (error: unknown) => {
    if (asksForSignIn(error, usesOAuth)) authRequired = true;
    else if (failure === undefined && errorName(error) !== "McpConnectionClosedError") failure = error;
  };
  const stderr = () => {
    const text = typeof transport.stderr === "string" ? transport.stderr.trim() : "";
    return text ? { stderr: text } : {};
  };
  watchConnection(transport, (outcome) => {
    if (outcome === "ready") {
      ready = true;
      report({ type: "ready" });
    } else {
      report({ type: "failed", authRequired, ...(failure === undefined ? {} : { error: failure }), ...stderr() });
    }
  });
  if (typeof transport.start === "function") {
    const start = transport.start;
    transport.start = () => start.call(transport).catch((error: unknown) => {
      note(error);
      throw error;
    });
  }
  // watchConnection's own `send`, which this one calls in turn.
  const send = transport.send;
  transport.send = (message: unknown) => {
    if (isRecord(message) && message.method === "initialize" && message.id !== undefined) initializeId = message.id;
    return send.call(transport, message).catch((error: unknown) => {
      note(error);
      throw error;
    });
  };
  if (typeof transport.close === "function") {
    const close = transport.close;
    transport.close = () => {
      closeCalled = true;
      return close.call(transport);
    };
  }
  transport.onMessage((message) => {
    if (failure !== undefined || initializeId === undefined || !isRecord(message) || message.id !== initializeId) return;
    if (isRecord(message.error) && typeof message.error.message === "string") failure = message.error.message;
  });
  // After watchConnection's listener, which reports a close before ready itself.
  transport.onClose(() => {
    if (ready) report({ type: "closed", dropped: !closeCalled, authRequired, ...stderr() });
  });
}

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

export type McpHostServerState =
  | "connecting"
  | "ready"
  | "failed"
  /** The server asked for an OAuth sign-in. */
  | "needs-auth"
  /** It was ready, then its transport closed by itself; the extension reconnects at the next call. */
  | "disconnected"
  /** Another extension registered the name first (`conflict` names it), or the extension refused the config. */
  | "not-registered"
  /** The project's `.pi/mcp.json` declares it, but the project is not trusted, so it is not read. */
  | "not-trusted";

export interface McpHostServerStatus {
  name: string;
  scope: McpScope;
  state: McpHostServerState;
  error?: string;
  /** A stdio server's stderr tail, masked, when it failed or dropped. */
  stderr?: string;
  /** `not-registered`: the extension that registered a server of this name first. */
  conflict?: string;
}

/** Which entry a status is about (`lib/mcp-status.ts`), with the `mcpConfigKey()` of the entry as its file holds it. */
type StatusTarget = McpStatusEntry & { configKey: string };

/** What a session reports to the status store, before the session, folder and time are added. */
type SessionReport = Pick<McpSessionStatus, "state" | "error" | "stderr" | "conflict">;

type AttemptState = "connecting" | "ready" | "failed" | "needs-auth" | "disconnected";

const SESSION_STATES: Record<AttemptState, McpSessionState> = {
  connecting: "connecting",
  ready: "connected",
  failed: "failed",
  "needs-auth": "needs-auth",
  disconnected: "disconnected",
};

/** For a transport that closed before the server was ready, when nothing said why. */
const NOT_READY_MESSAGE = "The connection closed before the server was ready";

/** One registration of a server, and every transport the extension opens for it until the host lets it go. */
class ConnectAttempt {
  /** Set once the extension created the server's transport, or the attempt ended. */
  started = false;
  /** Set at its first outcome other than connecting, which is what a prompt waits for. */
  settled = false;
  /** A prompt already waited for this attempt until the deadline; later prompts do not. */
  waited = false;
  /**
   * The host let it go (unregistered it, or the session ended): whatever its
   * transports do afterwards is the extension closing them, not news.
   */
  released = false;
  state: AttemptState = "connecting";
  error: string | undefined;
  stderr: string | undefined;
  /** The transport the extension opened last; an older one that closes late no longer says how the server is. */
  current: object | undefined;
  /** What this attempt last wrote to the status store. */
  recorded: McpSessionStatus | undefined;
  private readonly startedListeners = new Set<() => void>();
  private readonly settledListeners = new Set<() => void>();

  constructor(readonly configKey: string, readonly scope: McpScope, readonly target: StatusTarget) {}

  markStarted(): void {
    if (this.started) return;
    this.started = true;
    for (const listener of this.startedListeners) listener();
    this.startedListeners.clear();
  }

  update(state: AttemptState, details: { error?: string; stderr?: string } = {}): void {
    this.state = state;
    this.error = details.error;
    this.stderr = details.stderr;
    if (state === "connecting" || this.settled) return;
    this.settled = true;
    this.markStarted();
    for (const listener of this.settledListeners) listener();
    this.settledListeners.clear();
  }

  whenStarted(): Promise<void> {
    return this.started ? Promise.resolve() : new Promise((resolve) => this.startedListeners.add(resolve));
  }

  whenSettled(): Promise<void> {
    return this.settled ? Promise.resolve() : new Promise((resolve) => this.settledListeners.add(resolve));
  }
}

/** Something that keeps a server from being registered, as `serverStates()` lists it and the status store gets it. */
interface HostProblem {
  status: McpHostServerStatus;
  target: StatusTarget;
  report: SessionReport;
}

/** `pi.registerMcpServer()`'s words when another extension holds the name (SDK `loader.js`). */
const ALREADY_REGISTERED = /is already registered by extension "(.+)"$/;

function sessionIdOf(ctx: ExtensionContext): string {
  try {
    return ctx.sessionManager?.getSessionId() ?? "";
  } catch {
    return "";
  }
}

function delay(ms: number): { promise: Promise<void>; cancel: () => void } {
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

/** A server the host wants registered: its config as registered, and the entry its status is about. */
interface DesiredServer {
  config: McpServerConfig;
  scope: McpScope;
  target: StatusTarget;
}

/** One load of the host extension; a reload binds a new one. */
class HostInstance {
  private ctx: ExtensionContext | undefined;
  private active = false;
  /** Disposed: its session is closing, or a reload replaced it. Nothing it hears afterwards is recorded. */
  private disposed = false;
  private readonly attempts = new Map<string, ConnectAttempt>();
  /**
   * Registrations unregistered before the extension opened their connection
   * (`unregister()` gave up waiting), by `name\0configKey`, counted. The
   * extension assigns a connection only after loading the MCP runtime, and
   * its unregister closes only one already assigned, so a connection it
   * assigns later is never closed. It still asks this host's factory for a
   * transport, which is refused, so nothing is started.
   */
  private readonly abandoned = new Map<string, number>();
  /** Keyed by scope and name: an untrusted project entry may share its name with a global one. */
  private problems = new Map<string, HostProblem>();
  /** What each problem last wrote to the status store, by status key, so a sync repeats a report only once it was replaced. */
  private readonly problemReports = new Map<string, { signature: string; target: StatusTarget; status: McpSessionStatus }>();
  /** The record saying this session's `/mcp` is another extension's, while it is. */
  private inactiveReport: { sessionId: string; info: McpHostInactiveInfo } | undefined;
  private queue: Promise<void> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | undefined;
  /** Between agent_start and agent_end; the idle timer never runs meanwhile. */
  private runActive = false;
  /** Prompts waiting in prepareForPrompt(); nor does it run while one waits. */
  private preparing = 0;

  constructor(private readonly pi: ExtensionAPI, private readonly options: Required<McpHostOptions>) {
    pi.on("session_start", (_event, ctx) => {
      if (this.disposed) return;
      this.ctx = ctx;
      // The built-in MCP extension may be switched off (-builtin:mcp) or replaced by one that
      // registers /mcp (several are named mcp:1, mcp:2, …); such an extension would connect
      // these servers its own way, so the host hands it nothing.
      const commands = pi.getCommands().filter(isMcpExtensionCommand);
      this.active = commands.some(isBuiltinMcpCommand);
      // `-builtin:mcp` leaves no /mcp at all, which Settings reads from the files; a prompt
      // template named mcp is no owner. Another extension's /mcp only a session can see, by
      // loading the extensions.
      this.reportActivity(ctx, this.active ? undefined : commands[0]?.sourceInfo?.path);
    });
    pi.on("before_agent_start", () => {
      this.clearIdle();
      // Prompts that do not come through the wrapper, such as an extension's, still connect.
      void this.sync();
    });
    pi.on("agent_start", () => {
      this.runActive = true;
      this.clearIdle();
    });
    pi.on("agent_end", () => {
      this.runActive = false;
      this.armIdle();
    });
    pi.on("session_shutdown", () => {
      // The wrapper disposes the host when it starts closing (`McpHost.dispose()`), before any
      // extension hears session_shutdown, so this is a repeat: handlers run one after another,
      // this one after the MCP extension's and every other extension's, and a close of theirs
      // that never returns (a stdio grandchild holding stdout, a refresh in flight) would
      // otherwise leave this session's records describing connections nobody holds.
      this.dispose();
    });
  }

  /**
   * Called by the transport factory for every connection the extension opens,
   * the first and every one after: a reconnect after a drop or a sign-in, an
   * HTTP retry. Each belongs to the registration it was opened for, until the
   * host lets that go.
   */
  attemptFor(entry: McpServerEntry): ConnectAttempt | undefined {
    const attempt = this.attempts.get(entry.name);
    return attempt && !attempt.released && attempt.configKey === canonicalJson(entry.config) ? attempt : undefined;
  }

  /**
   * Whether a transport is asked for a registration this host unregistered
   * before the extension opened its connection, and no registration of it
   * now claims it: that connection is out of the extension's reach, so its
   * transport is refused. Counted: each abandoned registration refuses one.
   */
  refuseAbandoned(entry: McpServerEntry): boolean {
    const key = `${entry.name}\0${canonicalJson(entry.config)}`;
    const count = this.abandoned.get(key);
    if (!count) return false;
    if (count > 1) this.abandoned.set(key, count - 1);
    else this.abandoned.delete(key);
    console.warn(`[pi-web] MCP server "${entry.name}" was unregistered before its connection opened; its transport is refused`);
    return true;
  }

  /** The factory could not build a transport (a PI_WEB_PASSWORD reference, a failing `!command`). */
  transportFailed(attempt: ConnectAttempt, entry: McpServerEntry, error: unknown): void {
    attempt.current = undefined;
    const redact = createTestRedactor(entry.config, [], { isCommandConfigValue: this.isCommandValue });
    this.update(attempt, "failed", { error: maskStatusError(errorMessage(error), redact) });
  }

  /** Follow a transport the extension opened for `attempt`; the latest one speaks for the server. */
  watch(attempt: ConnectAttempt, entry: McpServerEntry, transport: McpTransport, usesOAuth: boolean): void {
    attempt.markStarted();
    attempt.current = transport;
    this.update(attempt, "connecting");
    let redactor: ((text: string) => string) | undefined;
    const redact = (text: string) => {
      redactor ??= createTestRedactor(entry.config, [transport], { isCommandConfigValue: this.isCommandValue });
      return redactor(text);
    };
    const stderr = (text: string | undefined) => (text === undefined ? {} : { stderr: maskStatusStderr(text, redact) });
    watchTransport(transport as unknown as ObservedTransport, usesOAuth, (event) => {
      // An attempt the host let go still settles, for a prompt still waiting on it; `update()` records nothing for it.
      if (attempt.current !== transport) return;
      if (event.type === "ready") {
        this.update(attempt, "ready");
      } else if (event.type === "failed") {
        if (event.authRequired) this.update(attempt, "needs-auth");
        else {
          const error = event.error === undefined ? NOT_READY_MESSAGE : errorMessage(event.error);
          this.update(attempt, "failed", { error: maskStatusError(error, redact), ...stderr(event.stderr) });
        }
      } else if (event.authRequired) {
        // A later request asked for a sign-in, and the SDK dropped the client to wait for one.
        this.update(attempt, "needs-auth");
      } else if (event.dropped) {
        this.update(attempt, "disconnected", stderr(event.stderr));
      }
      // Closed by the client otherwise: a reconnect opens the next transport, and a session that ends lets go first.
    });
  }

  sync(): Promise<void> {
    const synced = this.enqueue(async () => {
      if (!this.active || !this.ctx) return;
      const desired = this.desiredServers(this.ctx);
      for (const [name, attempt] of [...this.attempts]) {
        const wanted = desired.get(name);
        if (wanted && canonicalJson(wanted.config) === attempt.configKey) continue;
        await this.unregister(name);
      }
      for (const [name, wanted] of desired) {
        if (!this.attempts.has(name)) this.register(name, wanted);
      }
      this.reportProblems();
    });
    // A prompt can register servers and then start no run: Stop during the wait, a
    // slash command, a preflight that rejects it. None reaches agent_end, so the idle
    // timer starts once the servers are registered, also when the sync finishes after
    // the prompt gave up on it. A run that does start stops the timer at agent_start.
    void synced.then(() => this.armIdle());
    return synced;
  }

  async prepareForPrompt(signal: AbortSignal, wait: boolean): Promise<void> {
    this.clearIdle();
    // The wrapper prepares only prompts sent while no run is going, so none is running
    // now; this also recovers from a run whose agent_end never arrived.
    this.runActive = false;
    this.preparing += 1;
    try {
      await this.waitForServers(signal, wait);
    } finally {
      this.preparing -= 1;
      // Started now in case the prompt starts no run; agent_start stops it if one does.
      this.armIdle();
    }
  }

  private async waitForServers(signal: AbortSignal, wait: boolean): Promise<void> {
    const stopped = aborted(signal);
    await Promise.race([this.sync(), stopped]);
    if (signal.aborted || !wait) return;
    const connecting = [...this.attempts.values()].filter((attempt) => !attempt.settled && !attempt.waited);
    if (connecting.length === 0) return;
    const deadline = delay(this.options.promptWaitMs);
    const timedOut = await Promise.race([
      Promise.all(connecting.map((attempt) => attempt.whenSettled())).then(() => false),
      deadline.promise.then(() => true),
      stopped.then(() => false),
    ]);
    deadline.cancel();
    // A server that outlasted one full wait is not waited for again; its tools arrive when it connects.
    if (timedOut) for (const attempt of connecting) attempt.waited = true;
  }

  serverStates(): McpHostServerStatus[] {
    const states: McpHostServerStatus[] = [...this.problems.values()].map((problem) => problem.status);
    for (const [name, attempt] of this.attempts) {
      states.push({
        name,
        scope: attempt.scope,
        state: attempt.state,
        ...(attempt.error ? { error: attempt.error } : {}),
        ...(attempt.stderr ? { stderr: attempt.stderr } : {}),
      });
    }
    return states.sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
  }

  /** Unregister everything, for idle and for a host whose session goes away. */
  release(): Promise<void> {
    return this.enqueue(async () => {
      for (const name of [...this.attempts.keys()]) await this.unregister(name);
    });
  }

  /**
   * Lets go of everything this host reported: its attempts, its problem
   * records and its host-inactive record. Safe to repeat, and in any order
   * with the MCP extension closing the connections: a released attempt
   * records nothing its transports do afterwards.
   */
  dispose(): void {
    this.disposed = true;
    this.active = false;
    this.clearIdle();
    this.letGoOfAll();
    this.reportActivity(undefined, undefined);
  }

  private readonly isCommandValue = (value: string): boolean =>
    // The SDK's rule (`isCommandConfigValue()`), for hosts given no value parser, such as tests'.
    this.options.internals.isCommandConfigValue?.(value) ?? value.startsWith("!");

  /** Writes what this session sees of `target` to the status store, and returns the record. */
  private write(target: StatusTarget, report: SessionReport): McpSessionStatus | undefined {
    const ctx = this.ctx;
    if (!ctx) return undefined;
    const status: McpSessionStatus = {
      origin: "session",
      state: report.state,
      sessionId: sessionIdOf(ctx),
      cwd: ctx.cwd,
      updatedAt: Date.now(),
      ...(report.error ? { error: report.error } : {}),
      ...(report.stderr ? { stderr: report.stderr } : {}),
      ...(report.conflict ? { conflict: report.conflict } : {}),
    };
    recordMcpStatus(target, target.configKey, status);
    return status;
  }

  /** A change of `attempt`'s state, recorded unless the host let it go. */
  private update(attempt: ConnectAttempt, state: AttemptState, details: { error?: string; stderr?: string } = {}): void {
    attempt.update(state, details);
    if (attempt.released) return;
    attempt.recorded = this.write(attempt.target, { state: SESSION_STATES[state], ...details });
  }

  /**
   * The host no longer follows `attempt`, and the extension is about to close
   * its connection. Its last state stays recorded as the last thing this
   * session saw, unless someone wrote another since, with two exceptions that
   * would describe a connection nobody holds: "connecting", which nothing would
   * ever finish, goes, and "connected" is marked closed (`closedAt`), so a
   * session that idled out or ended does not read as connected for as long as
   * the server process runs. A failure, a sign-in asked for, or a drop is
   * still true of the server afterwards and stays as it is.
   */
  private letGo(attempt: ConnectAttempt): void {
    attempt.released = true;
    const { target, recorded } = attempt;
    if (!recorded) return;
    if (attempt.state === "connecting") forgetMcpStatus(target, target.configKey, recorded);
    else if (attempt.state === "ready") replaceMcpStatus(target, target.configKey, recorded, { ...recorded, closedAt: Date.now() });
  }

  /**
   * For a host that stops: its session ended, or a reload replaces it. Besides
   * its attempts, the problems it reported go: unlike what a connection did,
   * they are found again at every sync, and a host that no longer syncs no
   * longer sees them (another extension holding the name is that session's).
   */
  private letGoOfAll(): void {
    for (const attempt of this.attempts.values()) this.letGo(attempt);
    for (const { target, status } of this.problemReports.values()) forgetMcpStatus(target, target.configKey, status);
    this.problemReports.clear();
  }

  /**
   * Records the problems of the last sync. Each sync finds them again (a
   * registration is retried, trust is read again), so one is written only when
   * it changed, or when its record was replaced since (by a test, or another
   * session), which makes it the latest report again.
   */
  private reportProblems(): void {
    const reported = new Set<string>();
    for (const { target, report } of this.problems.values()) {
      const key = mcpStatusKey(target);
      reported.add(key);
      const signature = [target.configKey, report.state, report.conflict ?? "", report.error ?? ""].join("\0");
      const previous = this.problemReports.get(key);
      if (previous?.signature === signature && isCurrentMcpStatus(target, target.configKey, previous.status)) continue;
      const status = this.write(target, report);
      if (status) this.problemReports.set(key, { signature, target, status });
    }
    for (const key of [...this.problemReports.keys()]) if (!reported.has(key)) this.problemReports.delete(key);
  }

  /** Records (`owner`) or forgets that this session's `/mcp` is another extension's. */
  private reportActivity(ctx: ExtensionContext | undefined, owner: string | undefined): void {
    if (this.inactiveReport) forgetMcpHostInactive(this.inactiveReport.sessionId, this.inactiveReport.info);
    this.inactiveReport = undefined;
    if (!ctx) return;
    const sessionId = sessionIdOf(ctx);
    if (!owner) {
      // A host of this session before a reload may have recorded one.
      forgetMcpHostInactive(sessionId);
      return;
    }
    const info: McpHostInactiveInfo = { owner, cwd: ctx.cwd, updatedAt: Date.now() };
    recordMcpHostInactive(sessionId, info);
    this.inactiveReport = { sessionId, info };
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.queue.then(operation);
    this.queue = run.catch((error: unknown) => {
      console.error("[pi-web] MCP host operation failed:", errorMessage(error));
    });
    return this.queue;
  }

  private desiredServers(ctx: ExtensionContext): Map<string, DesiredServer> {
    this.problems = new Map();
    const desired = new Map<string, DesiredServer>();
    // Project entries follow the project's trust, as in the pi CLI: the SDK reads
    // `.pi/mcp.json` only once the project is trusted (ADR 0006). Trust is read
    // fresh here, never from ctx.isProjectTrusted(): that is the wrapper's
    // SettingsManager flag, fixed when the wrapper was built (true for a folder that
    // needed no trust then) and refreshed only on reload, so a `.pi/mcp.json` that
    // appeared since would connect on the next prompt with no trust decision. The
    // default read also answers false for a folder that needs no trust: the SDK
    // reads the file again itself, and a file landing between the two reads would
    // otherwise be read without a decision.
    const projectReadable = this.options.mayReadProjectConfig(ctx.cwd);
    let loaded: ReturnType<McpHostOptions["internals"]["loadMcpConfig"]> | undefined;
    try {
      loaded = this.options.internals.loadMcpConfig({
        agentDir: this.options.agentDir,
        cwd: ctx.cwd,
        projectTrusted: projectReadable,
      });
    } catch (error) {
      logConfigErrorOnce(`cannot read mcp.json: ${errorMessage(error)}`);
    }
    // The path the SDK reads the project's entries from, which Settings lists them under.
    const projectPath = join(ctx.cwd, CONFIG_DIR_NAME, "mcp.json");
    // After the SDK's read, so a file that landed since the trust read is reported too.
    if (!projectReadable) {
      const entries = untrustedProjectServerEntries(ctx.cwd);
      for (const [name, value] of entries.slice(0, MCP_UNTRUSTED_REPORT_MAX)) {
        // One entry the host cannot key (`mcpConfigKey()` is total, so this is a guard) never drops the others.
        try {
          this.problems.set(`project\0${name}`, {
            status: { name, scope: "project", state: "not-trusted" },
            target: { scope: "project", sourcePath: projectPath, name, configKey: mcpConfigKey(value) },
            report: { state: "not-trusted" },
          });
        } catch (error) {
          logConfigErrorOnce(`${projectPath}: server "${name}" is not reported: ${errorMessage(error)}`);
        }
      }
      if (entries.length > MCP_UNTRUSTED_REPORT_MAX) {
        logConfigErrorOnce(`${projectPath}: ${entries.length - MCP_UNTRUSTED_REPORT_MAX} more servers of this untrusted project are not reported`);
      }
    }
    if (!loaded) return desired;
    // Each names its file: an unparsable file, or an entry the SDK refused and skipped. A parse
    // error quotes the file around the bad token, often part of a secret, so it is reworded.
    // At most a few per sync: errors past what the dedupe set holds would each be logged again
    // at every sync, so the rest are one line with their count.
    const loadedPaths = [join(this.options.agentDir, "mcp.json"), projectPath];
    for (const error of loaded.errors.slice(0, CONFIG_ERRORS_LOGGED_PER_SYNC)) logConfigErrorOnce(scrubMcpLoadError(error, loadedPaths));
    if (loaded.errors.length > CONFIG_ERRORS_LOGGED_PER_SYNC) {
      logConfigErrorOnce(`${loaded.errors.length - CONFIG_ERRORS_LOGGED_PER_SYNC} more errors in mcp.json are not logged`);
    }
    for (const entry of loaded.servers) {
      if (entry.config.enabled === false) continue;
      const scope = entry.scope === "project" ? "project" : "global";
      try {
        desired.set(entry.name, {
          config: withReachableExposure(entry.config, this.options.codemodeAvailable()),
          scope,
          // The validator hands back the parsed entry itself, so this is the key Settings lists it with.
          target: { scope, sourcePath: entry.source, name: entry.name, configKey: mcpConfigKey(entry.config) },
        });
      } catch (error) {
        logConfigErrorOnce(`${entry.source}: server "${entry.name}" is not connected: ${errorMessage(error)}`);
      }
    }
    return desired;
  }

  private register(name: string, wanted: DesiredServer): void {
    const { config, scope, target } = wanted;
    const attempt = new ConnectAttempt(canonicalJson(config), scope, target);
    this.attempts.set(name, attempt);
    try {
      this.pi.registerMcpServer(name, config);
    } catch (error) {
      this.attempts.delete(name);
      const message = errorMessage(error);
      const owner = this.registeredOwner(name) ?? ALREADY_REGISTERED.exec(message)?.[1];
      const redact = createTestRedactor(config, [], { isCommandConfigValue: this.isCommandValue });
      this.problems.set(`${scope}\0${name}`, {
        status: { name, scope, state: "not-registered", error: message, ...(owner ? { conflict: owner } : {}) },
        target,
        report: owner ? { state: "conflict", conflict: owner } : { state: "failed", error: maskStatusError(message, redact) },
      });
    }
  }

  /** The extension a server of this name is registered by, read from the registry rather than from words. */
  private registeredOwner(name: string): string | undefined {
    try {
      return this.pi.getMcpServers?.().find((server) => server.name === name)?.extensionPath;
    } catch {
      return undefined;
    }
  }

  private async unregister(name: string): Promise<void> {
    const attempt = this.attempts.get(name);
    if (attempt && !attempt.started) {
      const deadline = delay(this.options.replaceWaitMs);
      await Promise.race([attempt.whenStarted(), deadline.promise]);
      deadline.cancel();
    }
    this.attempts.delete(name);
    if (attempt && !attempt.started) {
      const key = `${name}\0${attempt.configKey}`;
      this.abandoned.set(key, (this.abandoned.get(key) ?? 0) + 1);
    }
    // Before the extension closes it: that close is the host's doing, not a drop.
    if (attempt) this.letGo(attempt);
    try {
      this.pi.unregisterMcpServer(name);
    } catch (error) {
      console.error(`[pi-web] cannot unregister MCP server "${name}":`, errorMessage(error));
    }
  }

  private clearIdle(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private armIdle(): void {
    this.clearIdle();
    if (this.runActive || this.preparing > 0 || this.options.idleMs <= 0 || this.attempts.size === 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.ctx && !this.ctx.isIdle()) return;
      void this.release();
    }, this.options.idleMs);
    this.idleTimer.unref?.();
  }
}

export interface McpHostOptions {
  agentDir: string;
  /** `loadMcpConfig`, and the SDK's `!command` test for masking what servers say (else a leading `!`, as the SDK decides). */
  internals: Pick<PiSdkInternals, "loadMcpConfig"> & Partial<Pick<PiSdkInternals, "isCommandConfigValue">>;
  /** Whether codemode can run scripts; servers it cannot reach become `deferred`. */
  codemodeAvailable: () => boolean;
  /**
   * Whether the project's `.pi/mcp.json` may be read, asked on every sync.
   * Defaults to a fresh read of the folder and `trust.json`
   * (`mayReadProjectConfigNow()`): true only while a decision trusts a folder
   * that requires trust. While it is false, the names the file declares are
   * reported as `not-trusted`.
   */
  mayReadProjectConfig?: (cwd: string) => boolean;
  idleMs?: number;
  promptWaitMs?: number;
  /** How long an unregister waits for the extension to open the connection it will close. */
  replaceWaitMs?: number;
}

/**
 * The MCP host of one session wrapper. Its extension is loaded beside the
 * SDK's MCP extension, and its transport factory wraps the one that extension
 * connects through.
 */
export class McpHost {
  private readonly options: Required<McpHostOptions>;
  private current: HostInstance | undefined;

  constructor(options: McpHostOptions) {
    this.options = {
      idleMs: resolveMcpIdleMs(),
      promptWaitMs: PROMPT_WAIT_MS,
      replaceWaitMs: REPLACE_WAIT_MS,
      ...options,
      mayReadProjectConfig: options.mayReadProjectConfig ?? ((cwd) => mayReadProjectConfigNow(cwd, options.agentDir)),
    };
  }

  extension(): InlineExtension {
    return {
      name: MCP_HOST_EXTENSION_NAME,
      hidden: true,
      factory: (pi) => {
        this.current?.dispose();
        this.current = new HostInstance(pi, this.options);
      },
    };
  }

  wrapTransportFactory(factory: McpTransportFactory): McpTransportFactory {
    return (entry, cwd, authProvider) => {
      const host = this.current;
      const attempt = host?.attemptFor(entry);
      if (!attempt && host?.refuseAbandoned(entry)) {
        throw new Error(`MCP server "${entry.name}" was removed before it connected, so Pi Web did not start it`);
      }
      let transport: ReturnType<McpTransportFactory>;
      try {
        transport = factory(entry, cwd, authProvider);
      } catch (error) {
        if (host && attempt) host.transportFailed(attempt, entry, error);
        throw error;
      }
      // The connection passes an auth provider exactly when the server signs in with OAuth.
      if (host && attempt) host.watch(attempt, entry, transport as McpTransport, authProvider !== undefined);
      return transport;
    };
  }

  /**
   * For a wrapper that starts closing: the host lets go of what it reported
   * before extensions hear `session_shutdown`, whose handlers run in order and
   * whose MCP connection closes have no upper bound. The wrapper disposes the
   * SDK session after `PI_WEB_SHUTDOWN_DEADLINE_MS` either way, and nothing
   * else would reach the host then.
   */
  dispose(): void {
    this.current?.dispose();
  }

  /**
   * Sync the session's servers with `mcp.json`, then wait for the ones still
   * connecting, unless `wait` is false (the built-in `/mcp`, which starts no
   * run but acts on the registered servers; `mcpPromptPreparation()`).
   */
  prepareForPrompt(signal: AbortSignal, options: { wait?: boolean } = {}): Promise<void> {
    return this.current?.prepareForPrompt(signal, options.wait ?? true) ?? Promise.resolve();
  }

  serverStates(): McpHostServerStatus[] {
    return this.current?.serverStates() ?? [];
  }

  /** Unregister every server now, as the idle timer does. */
  release(): Promise<void> {
    return this.current?.release() ?? Promise.resolve();
  }
}
