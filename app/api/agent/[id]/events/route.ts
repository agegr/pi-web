import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { subscribeSessionInvalidation } from "@/lib/pi-web-auth";
import { getSessionToken } from "@/lib/pi-web-auth-route";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (req.signal.aborted) return new Response(null, { status: 204 });
  const { id } = await params;
  if (req.signal.aborted) return new Response(null, { status: 204 });

  // Fast path: already-running session
  let session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    const filePath = await resolveSessionPath(id);
    if (req.signal.aborted) return new Response(null, { status: 204 });
    if (!filePath) {
      return new Response("Session not found", { status: 404 });
    }
    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
    try {
      ({ session } = await startRpcSession(id, filePath, cwd));
      if (req.signal.aborted) return new Response(null, { status: 204 });
    } catch (error) {
      return new Response(`Failed to start agent: ${error}`, { status: 500 });
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribeAuth = () => {};
      let unsubscribe = () => {};
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          cleanup();
        }
      }, 30_000);
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        unsubscribeAuth();
        try { controller.close(); } catch { /* stream already closed */ }
      };
      if (req.signal.aborted) {
        cleanup();
        return;
      }
      const encode = (data: unknown) => {
        if (closed) return;
        const text = `data: ${JSON.stringify(data)}\n\n`;
        try { controller.enqueue(new TextEncoder().encode(text)); } catch { cleanup(); }
      };

      // Send initial connected event
      encode({ type: "connected", sessionId: id });
      if (closed) return;

      unsubscribe = session.onEvent((event) => {
        encode(event);
      });

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      // Cleanup when client disconnects
      const sessionToken = getSessionToken(req);
      unsubscribeAuth = sessionToken
        ? subscribeSessionInvalidation(sessionToken, cleanup)
        : () => {};

      // Detect client disconnect via abort signal
      req.signal?.addEventListener("abort", cleanup);
      if (req.signal.aborted) cleanup();
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
