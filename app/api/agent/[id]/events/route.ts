import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession, type AgentEvent } from "@/lib/rpc-manager";
import { isApiRequestAllowed } from "@/lib/request-security";

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
  if (!isApiRequestAllowed(req)) {
    return new Response("Untrusted API request", { status: 403 });
  }


  // Fast path: already-running session
  let session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return new Response("Session not found", { status: 404 });
    }
    try {
      ({ session } = await startRpcSession(id, filePath, undefined));
    } catch {
      return new Response("Failed to start agent", { status: 500 });
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(text));
      };

      // Send initial connected event
      encode({ type: "connected", sessionId: id });

      const unsubscribe = session.onEvent((event) => {
        const clientEvent = toClientEvent(event);
        if (clientEvent) encode(clientEvent);
      });

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      // Cleanup when client disconnects
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      };

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
