/**
 * The agent side of docs/adr/0008-agent-process-boundary.md.
 *
 * Owns exactly one AgentSession and serves it over a Unix socket. Clients come
 * and go; the session does not. When the web server restarts, it re-attaches to
 * this process and finds the turn still running.
 *
 * Run through bin/agent-host.js, which is what the web server spawns.
 */

import { createServer, type Server, type Socket } from "net";
import {
  AGENT_HOST_PROTOCOL_VERSION,
  createFrameReader,
  encodeFrame,
  type AgentHostClientFrame,
  type AgentHostFrame,
} from "./agent-host-protocol";
import {
  agentSocketDir,
  agentSocketPath,
  removeAgentRecord,
  removeAgentSocket,
  writeAgentRecord,
  AGENT_RECORD_VERSION,
} from "./agent-registry";
import { startRpcSession, type AgentSessionWrapper } from "./rpc-manager";
import { mkdirSync } from "fs";


export interface AgentHostOptions {
  sessionId: string;
  sessionFile: string | null;
  cwd: string | undefined;
  socketPath?: string;
}

export interface AgentHostHandle {
  session: AgentSessionWrapper;
  socketPath: string;
  close(): Promise<void>;
}

function send(socket: Socket, frame: AgentHostFrame): void {
  if (socket.destroyed || !socket.writable) return;
  socket.write(encodeFrame(frame));
}

/**
 * Start the session, announce it in the registry, and accept clients until the
 * session is destroyed or the process is asked to stop.
 */
export async function runAgentHost(options: AgentHostOptions): Promise<AgentHostHandle> {
  const socketPath = options.socketPath ?? agentSocketPath(options.sessionId);
  const { session } = await startRpcSession(options.sessionId, options.sessionFile as string, options.cwd);

  // Extension binding is deliberately not awaited before the socket is up: a
  // restarted web server must be able to adopt a running session immediately,
  // and `get_state` answers before the bindings finish. Prompts wait for them
  // through the session wrapper itself.
  void session.waitUntilReady().catch((error: unknown) => {
    console.error(`[pi-web agent-host] extensions failed to bind: ${error instanceof Error ? error.message : String(error)}`);
  });

  const startedAt = Date.now();
  const clients = new Set<Socket>();

  const broadcast = (frame: AgentHostFrame): void => {
    for (const client of clients) send(client, frame);
  };

  const unsubscribe = session.onEvent((event) => {
    broadcast({ type: "event", event: event as { type: string; [key: string]: unknown } });
  });

  const handleCommand = async (socket: Socket, frame: Extract<AgentHostClientFrame, { type: "command" }>): Promise<void> => {
    try {
      let data: unknown;
      if (frame.command.type === "shutdown") {
        // Answer first: the session teardown closes this socket.
        send(socket, { type: "response", id: frame.id, success: true, data: null });
        void session.shutdown().catch(() => {});
        return;
      }
      if (frame.command.type === "set_tool_selection") {
        // A wrapper method, not a command: answer it here instead of forwarding.
        const toolNames = frame.command.toolNames;
        if (!Array.isArray(toolNames) || toolNames.some((name) => typeof name !== "string")) {
          throw new Error("toolNames must be an array of strings");
        }
        session.setActiveToolSelection(toolNames as string[]);
        data = null;
      } else {
        data = await session.send(frame.command);
      }
      send(socket, { type: "response", id: frame.id, success: true, data });
    } catch (error) {
      send(socket, {
        type: "response",
        id: frame.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  mkdirSync(agentSocketDir(), { recursive: true });
  // A stale socket file makes bind fail; the process that owned it is gone.
  removeAgentSocket(socketPath);

  const server: Server = createServer((socket: Socket) => {
    clients.add(socket);
    // The client learns what it is talking to, and what is running right now,
    // before it sends anything.
    send(socket, {
      type: "hello",
      protocol: AGENT_HOST_PROTOCOL_VERSION,
      sessionId: session.sessionId,
      sessionFile: session.sessionFile ?? null,
      cwd: session.cwd,
      running: session.isRunning(),
      chatOnly: session.isChatOnly(),
      suppressedCompletionNotifications: session.hasSuppressedCompletionNotifications(),
      startedAt,
    });
    void session.send({ type: "get_state" })
      .then((state) => send(socket, { type: "snapshot", state }))
      .catch(() => {
        // A session that cannot answer yet still serves events below.
      });

    const read = createFrameReader<AgentHostClientFrame>((frame) => {
      if (frame?.type === "command" && typeof frame.id === "string") {
        void handleCommand(socket, frame);
      }
    });
    socket.on("data", read);
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const record = {
    version: AGENT_RECORD_VERSION,
    protocol: AGENT_HOST_PROTOCOL_VERSION,
    sessionId: session.sessionId,
    pid: process.pid,
    socketPath,
    sessionFile: session.sessionFile ?? null,
    cwd: session.cwd,
    startedAt,
  };
  // The caller looks the host up by the id it spawned it with, which is the
  // real session id only for an existing session; a new session gets a generated
  // one. Announce under both so either lookup finds the same host.
  const recordIds = new Set([session.sessionId, options.sessionId]);
  for (const id of recordIds) writeAgentRecord({ ...record, sessionId: id });

  let closed = false;
  const close = async (reason: string): Promise<void> => {
    if (closed) return;
    closed = true;
    console.error(`[pi-web agent-host] closing (${reason})`);
    unsubscribe();
    for (const id of recordIds) removeAgentRecord(id);
    for (const client of clients) client.destroy();
    clients.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    removeAgentSocket(socketPath);
  };

  // The session wrapper tears itself down when it goes idle or a client asks it
  // to; the host follows it out so no process outlives its session.
  session.onDestroy(() => {
    void close("session destroyed").finally(() => process.exit(0));
  });

  const stop = (signal: string): void => {
    console.error(`[pi-web agent-host] stopping on ${signal}`);
    void session.shutdown()
      .catch(() => {})
      .finally(() => close(`signal ${signal}`).finally(() => process.exit(0)));
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGHUP", () => stop("SIGHUP"));

  return { session, socketPath, close: () => close("requested by caller") };
}
