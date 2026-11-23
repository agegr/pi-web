/**
 * Wire format between an agent host process and its clients.
 *
 * See docs/adr/0008-agent-process-boundary.md. The host owns one AgentSession;
 * a client is the web server, and it may come and go. Frames are NDJSON: one
 * JSON object per line, terminated by `\n`, in both directions.
 *
 * Do not read this stream with a generic line reader: it splits on U+2028 and
 * U+2029 as well, and both are legal inside a JSON string. Split on `\n` only,
 * which is what `createFrameReader` does.
 */

export const AGENT_HOST_PROTOCOL_VERSION = 1;

/** First frame the host sends on every connection. */
export interface AgentHostHello {
  type: "hello";
  protocol: number;
  sessionId: string;
  sessionFile: string | null;
  cwd: string;
  /** Whether a turn or a shell command was still running when the client attached. */
  running: boolean;
  /** Resource policy of the session, so the client can answer without a round trip. */
  chatOnly: boolean;
  /** Whether completion notifications are muted for this session. */
  suppressedCompletionNotifications: boolean;
  startedAt: number;
}

/**
 * Sent right after `hello`. `state` is the session's own `get_state` result, so
 * a client that attached mid-turn can rebuild what is running instead of waiting
 * for the turn to end. Nothing replays individual stream deltas.
 */
export interface AgentHostSnapshot {
  type: "snapshot";
  state: unknown;
}

/** One session event, exactly as `AgentSessionWrapper.onEvent` delivered it. */
export interface AgentHostEvent {
  type: "event";
  event: { type: string; [key: string]: unknown };
}

/** Answer to one command. `id` echoes the command's id. */
export interface AgentHostResponse {
  type: "response";
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export type AgentHostFrame =
  | AgentHostHello
  | AgentHostSnapshot
  | AgentHostEvent
  | AgentHostResponse;

export interface AgentHostCommand {
  type: "command";
  id: string;
  command: Record<string, unknown>;
}

/**
 * Commands the host answers itself instead of forwarding to the session, because
 * they are method calls on the wrapper rather than entries in its command switch.
 */
export const AGENT_HOST_LOCAL_COMMANDS = ["set_tool_selection"] as const;

export type AgentHostClientFrame = AgentHostCommand;

export function encodeFrame(frame: AgentHostFrame | AgentHostClientFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * Split a buffer into complete frames. Malformed lines are dropped rather than
 * failing the connection: one bad frame from a half-written process should not
 * take down a client that can still serve the session.
 */
export function decodeFrames<T>(buffer: string): { frames: T[]; rest: string } {
  const frames: T[] = [];
  let start = 0;
  for (;;) {
    const end = buffer.indexOf("\n", start);
    if (end === -1) break;
    const line = buffer.slice(start, end).trim();
    start = end + 1;
    if (line.length === 0) continue;
    try {
      frames.push(JSON.parse(line) as T);
    } catch {
      // Ignore: see the note above.
    }
  }
  return { frames, rest: buffer.slice(start) };
}

/** Stateful reader for a socket stream. */
export function createFrameReader<T>(onFrame: (frame: T) => void): (chunk: Buffer | string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const { frames, rest } = decodeFrames<T>(buffer);
    buffer = rest;
    for (const frame of frames) onFrame(frame);
  };
}
