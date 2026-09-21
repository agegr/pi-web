import {
  isEventIncludedInSnapshot,
  toClientAgentEvent,
  type AgentEventLike,
} from "./agent-event-wire";
import { acquireSessionLivenessLease } from "./session-liveness";

export interface AgentEventStreamSession {
  readonly isStreaming: boolean;
  readonly streamingMessage: unknown;
  isAlive?(): boolean;
  onEvent(listener: (event: AgentEventLike) => void): () => void;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Registry of live SSE streams, closed from the SIGINT/SIGTERM hook in
 * instrumentation.ts.
 *
 * In production Next 16 handles those signals with `server.close()` and waits
 * for every connection to end, with no timeout and no `closeAllConnections`
 * (that call is dev-only in next/dist/server/lib/start-server.js). An SSE
 * stream only ends when the client disconnects, so without this the process
 * stops listening (502 upstream) but never exits.
 *
 * instrumentation.ts and the route handlers are bundled into separate module
 * graphs, each with its own copy of this module; a plain module-level Set
 * would be two disconnected registries. Symbol.for + globalThis shares one.
 */
const CLOSER_REGISTRY: symbol = Symbol.for("pi-web.agentEventStreamClosers");
type StreamCloser = (closeController: boolean | "error") => void;
const activeStreamClosers: Set<StreamCloser> =
  ((globalThis as Record<symbol, Set<StreamCloser>>)[CLOSER_REGISTRY] ??= new Set<StreamCloser>());

/** Close every live SSE stream (called on process shutdown signals). */
export function closeAllAgentEventStreams(): void {
  for (const close of [...activeStreamClosers]) {
    try { close("error"); } catch { /* stream already closed */ }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Open the SSE transport immediately, then publish the session snapshot only
 * after the agent is ready and its event listener has been installed.
 */
export function createAgentEventStream(
  req: Request,
  sessionId: string,
  sessionPromise: Promise<AgentEventStreamSession>,
): ReadableStream<Uint8Array> {
  let cancelStream: (closeController: boolean | "error") => void = () => {};
  let releaseLease: () => void = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;
      let abortHandler: (() => void) | null = null;

      // "error": hard-terminate the response (SSE client sees a broken
      // stream and reconnects). Used on process shutdown: a plain close() is
      // swallowed by the Next/Node response pipeline without emitting a
      // chunked termination, so the socket stays ESTABLISHED and Next's
      // server.close() drain never completes (the original zombie bug).
      // "true": graceful close after we finished writing a final event.
      const cleanup = (closeController: boolean | "error") => {
        if (closed) return;
        closed = true;
        releaseLease();
        releaseLease = () => {};
        activeStreamClosers.delete(cleanup);
        if (heartbeat !== null) clearInterval(heartbeat);
        unsubscribe?.();
        unsubscribe = null;
        if (abortHandler) req.signal.removeEventListener("abort", abortHandler);
        if (closeController === "error") {
          try { controller.error(new Error("pi-web server shutting down")); } catch { /* already closed */ }
        } else if (closeController) {
          try { controller.close(); } catch { /* stream already closed */ }
        }
      };
      cancelStream = cleanup;
      releaseLease = acquireSessionLivenessLease(sessionId).release;
      activeStreamClosers.add(cleanup);

      const enqueueText = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup(false);
        }
      };
      const encode = (data: unknown) => {
        enqueueText(`data: ${JSON.stringify(data)}\n\n`);
      };
      const forwardEvent = (event: AgentEventLike, snapshot: unknown) => {
        if (isEventIncludedInSnapshot(event, snapshot)) return;
        const clientEvent = toClientAgentEvent(event);
        if (clientEvent) encode(clientEvent);
      };

      const publishSession = async () => {
        try {
          const session = await sessionPromise;
          if (closed) return;
          if (session.isAlive && !session.isAlive()) {
            cleanup(true);
            return;
          }

          const bufferedEvents: AgentEventLike[] = [];
          let snapshotPublished = false;
          const handleEvent = (event: AgentEventLike) => {
            if (event.type === "session_shutdown") {
              cleanup(true);
              return;
            }
            if (!snapshotPublished) {
              bufferedEvents.push(event);
              return;
            }
            forwardEvent(event, snapshot);
          };

          const stopListening = session.onEvent(handleEvent);
          if (closed) {
            stopListening();
            return;
          }
          if (session.isAlive && !session.isAlive()) {
            stopListening();
            cleanup(true);
            return;
          }
          unsubscribe = stopListening;

          const snapshot = session.streamingMessage;
          encode({
            type: "connected",
            sessionId,
            isStreaming: session.isStreaming,
          });
          for (const event of bufferedEvents) forwardEvent(event, snapshot);
          if (snapshot !== undefined && snapshot !== null) {
            encode({ type: "message_start", message: snapshot });
          }
          snapshotPublished = true;
        } catch (error) {
          if (closed) return;
          encode({
            type: "startup_error",
            errorMessage: `Failed to start agent: ${errorMessage(error)}`,
          });
          cleanup(true);
        }
      };

      // Attach the rejection handler before checking the request signal. The
      // route may already have started a shared cold-start promise.
      void publishSession();

      abortHandler = () => cleanup(true);
      if (req.signal.aborted) {
        cleanup(true);
        return;
      }
      req.signal.addEventListener("abort", abortHandler, { once: true });

      heartbeat = setInterval(() => enqueueText(":\n\n"), HEARTBEAT_INTERVAL_MS);

      // Force the response headers through without claiming that the agent is
      // ready. The client waits for the later `connected` data event.
      enqueueText(":\n\n");
    },
    cancel() {
      cancelStream(false);
    },
  });
}
