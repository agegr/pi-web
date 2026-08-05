import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession, type AgentEvent, type AgentSessionWrapper } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

const OMITTED_EVENT_TYPES = new Set(["turn_start", "turn_end", "tool_execution_update"]);

function toClientEvent(event: AgentEvent): AgentEvent | null {
  if (OMITTED_EVENT_TYPES.has(event.type)) return null;
  if (event.type === "message_update") {
    const clientEvent = { ...event };
    delete clientEvent.assistantMessageEvent;
    return clientEvent;
  }
  if (event.type === "agent_end") return { type: "agent_end" };
  return event;
}

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 404 needs a non-200 response, so resolve the file path before building
  // the stream. An already-running session skips this.
  const running = getRpcSession(id);
  const filePath = running?.isAlive() ? undefined : await resolveSessionPath(id);
  if (!filePath && !running?.isAlive()) {
    return new Response("Session not found", { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const encode = (data: unknown) => {
        try {
          const text = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(text));
        } catch {
          // stream already closed
        }
      };

      // Send connected immediately so the browser-side event stream is ready;
      // a cold start (startRpcSession) can take seconds and used to run before
      // this event, blowing the client's connect timeout.
      encode({ type: "connected", sessionId: id });

      let unsubscribe: (() => void) | null = null;

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      const attach = (session: AgentSessionWrapper) => {
        unsubscribe = session.onEvent((event) => {
          const clientEvent = toClientEvent(event);
          if (clientEvent) encode(clientEvent);
        });
      };

      // Cleanup when client disconnects or startup fails
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // controller already closed
        }
      };

      const ready = getRpcSession(id);
      if (ready?.isAlive()) {
        attach(ready);
      } else {
        // A prompt POST shares startRpcSession's start lock (__piStartLocks),
        // so subscription always lands before the prompt is dispatched.
        void startRpcSession(id, filePath!, undefined)
          .then(({ session }) => {
            if (req.signal?.aborted) return;
            attach(session);
          })
          .catch((error) => {
            encode({
              type: "session_error",
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            cleanup();
          });
      }

      // Detect client disconnect via abort signal
      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
