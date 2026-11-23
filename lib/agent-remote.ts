/**
 * The web server's side of docs/adr/0008-agent-process-boundary.md.
 *
 * Spawns an agent host, or adopts one that outlived a previous server, and
 * speaks the NDJSON protocol in lib/agent-host-protocol.ts over a Unix socket.
 *
 * `RemoteAgentSession` mirrors the parts of `AgentSessionWrapper` the app uses,
 * so `lib/rpc-manager.ts` can hand either one to the routes. What it cannot
 * mirror — `inner`, the in-process SDK session — is deliberately absent: routes
 * that need the SDK session manager already fall back to reading the session
 * file when `inner` is missing.
 */

import { spawn, type ChildProcess } from "child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "fs";
import { connect, type Socket } from "net";
import { join } from "path";
import {
  AGENT_HOST_PROTOCOL_VERSION,
  createFrameReader,
  encodeFrame,
  type AgentHostClientFrame,
  type AgentHostFrame,
  type AgentHostHello,
} from "./agent-host-protocol";
import {
  agentSocketPath,
  agentStateDir,
  isAgentRecordStale,
  readAgentRecord,
  removeAgentRecord,
  removeAgentSocket,
  AGENT_RECORD_VERSION,
  type AgentRecord,
} from "./agent-registry";

/** How long to wait for a freshly spawned host to accept connections. */
const HOST_START_TIMEOUT_MS = 20_000;
const HOST_POLL_INTERVAL_MS = 100;

export type AgentEventListener = (event: { type: string; [key: string]: unknown }) => void;

export interface AttachResult {
  session: RemoteAgentSession;
  /** True when an agent spawned by an earlier web server was adopted. */
  adopted: boolean;
  record: AgentRecord;
}

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface RemoteState {
  isStreaming?: boolean;
  isBashRunning?: boolean;
  isCompacting?: boolean;
  isPromptRunning?: boolean;
}

/** A connection to one agent host. Closing it leaves the host running. */
export class RemoteAgentSession {
  private socket: Socket;
  private readonly pending = new Map<string, PendingCommand>();
  private readonly listeners = new Set<AgentEventListener>();
  private readonly destroyListeners = new Set<() => void>();
  private nextCommandId = 1;
  private closed = false;
  private alive = true;
  private destroyed = false;
  private extensionShutdownRequested = false;
  private running: boolean;
  private streaming: unknown = null;
  private firstSnapshotResolve: (() => void) | null = null;
  private readonly firstSnapshot: Promise<void>;

  /** From the host's `hello` frame. */
  readonly sessionId: string;
  readonly sessionFile: string | null;
  readonly cwd: string;
  readonly startedAt: number;
  /** Whether a turn or shell command was running when this client attached. */
  readonly runningOnAttach: boolean;
  private readonly chatOnly: boolean;
  private readonly suppressedNotifications: boolean;
  /** Latest `get_state` result, sent by the host right after `hello`. */
  state: unknown = null;

  private constructor(socket: Socket, hello: AgentHostHello) {
    this.socket = socket;
    this.sessionId = hello.sessionId;
    this.sessionFile = hello.sessionFile;
    this.cwd = hello.cwd;
    this.startedAt = hello.startedAt;
    this.runningOnAttach = hello.running;
    this.chatOnly = hello.chatOnly;
    this.suppressedNotifications = hello.suppressedCompletionNotifications;
    this.running = hello.running;
    this.firstSnapshot = new Promise<void>((resolve) => {
      this.firstSnapshotResolve = resolve;
    });

    // The data reader lives in `attach`, which sees the `hello` frame first and
    // keeps any bytes that arrived with it. See the note there.
    socket.on("close", () => this.handleDisconnect("connection closed"));
    socket.on("error", (error) => this.handleDisconnect(error.message));
  }

  /** Connect to a running host and wait for its `hello`. */
  static attach(record: AgentRecord, options: { timeoutMs?: number; snapshotTimeoutMs?: number } = {}): Promise<RemoteAgentSession> {
    const timeoutMs = options.timeoutMs ?? HOST_START_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const socket = connect(record.socketPath);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error(`Agent host for ${record.sessionId} did not answer within ${timeoutMs}ms`));
      }, timeoutMs);

      // One reader for the whole connection: the host writes `hello` and then
      // its state snapshot immediately, and they can share a TCP chunk. A second
      // reader installed after `hello` would start with an empty buffer and lose
      // whatever arrived alongside it.
      let session: RemoteAgentSession | null = null;
      const read = createFrameReader<AgentHostFrame>((frame) => {
        if (!session) {
          if (settled || frame.type !== "hello") return;
          if (frame.protocol !== AGENT_HOST_PROTOCOL_VERSION) {
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            reject(new Error(`Agent host protocol ${frame.protocol} is not ${AGENT_HOST_PROTOCOL_VERSION}`));
            return;
          }
          settled = true;
          clearTimeout(timer);
          const attached = new RemoteAgentSession(socket, frame);
          session = attached;
          // Wait for the state snapshot so a caller that attached mid-turn has
          // something to render immediately. A host that cannot answer yet must
          // not hold the attach open.
          void Promise.race([
            attached.firstSnapshot,
            new Promise<void>((resolve) => setTimeout(resolve, options.snapshotTimeoutMs ?? 1_500)),
          ]).then(() => resolve(attached));
          return;
        }
        session.handleFrame(frame);
      });

      socket.on("data", read);
      socket.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // The AgentSessionWrapper surface the routes and the event stream rely on
  // ---------------------------------------------------------------------------

  isAlive(): boolean {
    return this.alive && !this.closed && !this.socket.destroyed;
  }

  isExtensionShutdownRequested(): boolean {
    return this.extensionShutdownRequested;
  }

  /**
   * Advisory. Derived from the host's `hello`, its state snapshots, and turn
   * events; the authoritative busy check runs inside the host's wrapper, which
   * rejects the command on its own.
   */
  isRunning(): boolean {
    return this.running;
  }

  get isStreaming(): boolean {
    return Boolean((this.state as RemoteState | null)?.isStreaming) || this.streaming !== null;
  }

  get streamingMessage(): unknown {
    return this.streaming;
  }

  isChatOnly(): boolean {
    return this.chatOnly;
  }

  hasSuppressedCompletionNotifications(): boolean {
    return this.suppressedNotifications;
  }

  /** The host already started the session. */
  start(): void {}

  /** The host already bound extensions; see `waitUntilReady`. */
  beginExtensionBinding(): void {}

  /** Resolves once the host's state snapshot has arrived, or immediately if it never does. */
  waitUntilReady(): Promise<void> {
    return Promise.race([
      this.firstSnapshot,
      new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
    ]);
  }

  /** Whether the on-disk session file has entries this connection has not seen. */
  evictIfDiskAhead(): boolean {
    return false;
  }

  setActiveToolSelection(toolNames: string[]): void {
    void this.send({ type: "set_tool_selection", toolNames }).catch(() => {
      // The next `set_tools` recreates the session from the file anyway.
    });
  }

  onEvent(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onDestroy(callback: () => void): void {
    this.destroyListeners.add(callback);
  }

  /** Called by the connection's frame reader. */
  handleFrame(frame: AgentHostFrame): void {
    if (frame.type === "event") {
      this.trackEvent(frame.event);
      for (const listener of this.listeners) listener(frame.event);
      return;
    }
    if (frame.type === "snapshot") {
      this.state = frame.state;
      this.running = isRunningState(frame.state);
      this.firstSnapshotResolve?.();
      this.firstSnapshotResolve = null;
      return;
    }
    if (frame.type === "response") {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      this.pending.delete(frame.id);
      if (frame.success) pending.resolve(frame.data);
      else pending.reject(new Error(frame.error ?? "Agent host reported a failed command"));
    }
  }

  /** Keep `isRunning` and `streamingMessage` roughly current between snapshots. */
  private trackEvent(event: { type: string; [key: string]: unknown }): void {
    switch (event.type) {
      case "message_update":
      case "agent_start":
      case "prompt_accepted":
        this.running = true;
        break;
      case "session_shutdown":
        this.extensionShutdownRequested = true;
        this.running = false;
        this.streaming = null;
        break;
      case "agent_settled":
        this.running = false;
        this.streaming = null;
        break;
      default:
        break;
    }
    if (event.type === "message_update") {
      this.streaming = event.message ?? null;
    }
  }

  private handleDisconnect(reason: string): void {
    if (this.alive) {
      this.alive = false;
      for (const listener of this.listeners) listener({ type: "agent_host_disconnected", reason });
    }
    for (const pending of this.pending.values()) {
      pending.reject(new Error(`Agent host disconnected: ${reason}`));
    }
    this.pending.clear();
    this.fireDestroy();
  }

  private fireDestroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const callback of this.destroyListeners) {
      try {
        callback();
      } catch (error) {
        console.error("[pi-web] agent session destroy listener failed:", error);
      }
    }
    this.destroyListeners.clear();
  }

  /** Send one command and await its answer. */
  send(command: Record<string, unknown>): Promise<unknown> {
    if (!this.isAlive()) return Promise.reject(new Error("Agent host is not connected"));
    const id = String(this.nextCommandId++);
    const frame: AgentHostClientFrame = { type: "command", id, command };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(encodeFrame(frame), (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  /** Ask the host to end the session; the host then exits. */
  async shutdown(): Promise<void> {
    try {
      await this.send({ type: "shutdown" });
    } catch {
      // The host may already be gone; closing the socket is enough.
    }
    this.close();
    this.fireDestroy();
  }

  /**
   * Local teardown, matching the wrapper's `destroy()`. The session lives in
   * another process now, so this only drops the connection — `shutdown()` is
   * what ends the session. The distinction matters on process exit: pi-web tears
   * every session down through this path, and a remote host must keep running
   * through it.
   */
  destroy(): void {
    this.close();
    this.fireDestroy();
  }

  /** Detach. The host and its session keep running. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    this.socket.destroy();
  }
}

function isRunningState(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;
  const value = state as RemoteState;
  return Boolean(value.isStreaming || value.isBashRunning || value.isCompacting || value.isPromptRunning);
}

function hostEntryPath(): string {
  const override = process.env.PI_WEB_AGENT_HOST_ENTRY;
  if (override) return override;
  return join(process.cwd(), "bin", "agent-host.js");
}

/**
 * Start a detached host for this session. Detached matters: the host must
 * survive the web server that spawned it, which is the point of the change.
 */
export function spawnAgentHost(options: {
  sessionId: string;
  sessionFile: string | null;
  cwd: string;
  socketPath?: string;
}): { pid: number; socketPath: string; logPath: string } {
  if (process.platform === "win32") {
    throw new Error("Agent host sockets are Unix-only for now; see docs/adr/0008-agent-process-boundary.md");
  }
  const entry = hostEntryPath();
  if (!existsSync(entry)) throw new Error(`Agent host entry not found: ${entry}`);

  const socketPath = options.socketPath ?? agentSocketPath(options.sessionId);
  mkdirSync(agentStateDir(), { recursive: true });
  const logPath = join(agentStateDir(), `${options.sessionId}.log`);
  const logFd = openSync(logPath, "a");

  const args = [
    entry,
    "--session-id", options.sessionId,
    "--socket", socketPath,
    "--cwd", options.cwd,
    ...(options.sessionFile ? ["--session-file", options.sessionFile] : []),
  ];

  let child: ChildProcess;
  try {
    child = spawn(process.execPath, args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      // The host runs the in-process path itself; inheriting the flag would make
      // it spawn a host of its own.
      env: { ...process.env, PI_WEB_AGENT_PROCESS: "0" },
    });
  } finally {
    closeSync(logFd);
  }
  if (!child.pid) throw new Error("Agent host did not start");
  child.unref();
  return { pid: child.pid, socketPath, logPath };
}

async function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (existsSync(socketPath)) {
      const result = await new Promise<boolean>((resolve) => {
        const probe = connect(socketPath);
        probe.once("connect", () => {
          probe.destroy();
          resolve(true);
        });
        probe.once("error", () => {
          probe.destroy();
          resolve(false);
        });
      });
      if (result) return;
    }
    if (Date.now() >= deadline) throw new Error(`Agent host socket never appeared: ${socketPath}`);
    await new Promise((resolve) => setTimeout(resolve, HOST_POLL_INTERVAL_MS));
  }
}

/**
 * Adopt the session's running host if it has one, otherwise start one. This is
 * what a restarted web server calls, and why a restart no longer ends a turn.
 */
export async function attachOrSpawnAgent(options: {
  sessionId: string;
  sessionFile: string | null;
  cwd: string;
  socketPath?: string;
}): Promise<AttachResult> {
  const existing = readAgentRecord(options.sessionId);
  if (existing && !isAgentRecordStale(existing)) {
    try {
      const session = await RemoteAgentSession.attach(existing, { timeoutMs: HOST_POLL_INTERVAL_MS * 10 });
      return { session, adopted: true, record: existing };
    } catch {
      // The process is alive but not answering: a half-dead host is worse than
      // a new one, so drop the record and start over.
      removeAgentRecord(existing.sessionId);
      removeAgentSocket(existing.socketPath);
    }
  } else if (existing) {
    removeAgentRecord(existing.sessionId);
    removeAgentSocket(existing.socketPath);
  }

  const socketPath = options.socketPath ?? agentSocketPath(options.sessionId);
  removeAgentSocket(socketPath);
  const started = spawnAgentHost({ ...options, socketPath });
  await waitForSocket(started.socketPath, HOST_START_TIMEOUT_MS);
  const record: AgentRecord = {
    version: AGENT_RECORD_VERSION,
    protocol: AGENT_HOST_PROTOCOL_VERSION,
    sessionId: options.sessionId,
    pid: started.pid,
    socketPath: started.socketPath,
    sessionFile: options.sessionFile,
    cwd: options.cwd,
    startedAt: Date.now(),
  };
  const session = await RemoteAgentSession.attach(record);
  return { session, adopted: false, record: { ...record, sessionId: session.sessionId } };
}
