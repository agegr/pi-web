import { isApiRequestAllowed } from "@/lib/request-security";
import { getTerminalSession } from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";

const HEARTBEAT_INTERVAL_MS = 30_000;

// GET /api/terminal/[id]/events - SSE stream of terminal output
// Frames: { type: "connected", session } → { type: "data", data }* → { type: "exit", exitCode }
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isApiRequestAllowed(req)) {
    return new Response("Untrusted API request", { status: 403 });
  }
  if (req.signal.aborted) return new Response(null, { status: 204 });

  const { id } = await params;
  const session = getTerminalSession(id);
  if (!session || !session.isRunning) {
    return new Response("Terminal not found", { status: 404 });
  }

  // Captured by `start` so the stream's `cancel()` can tear down subscriptions.
  let cancelStream: (closeController: boolean) => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribeData: (() => void) | null = null;
      let unsubscribeExit: (() => void) | null = null;
      let abortHandler: (() => void) | null = null;

      const cleanup = (closeController: boolean) => {
        if (closed) return;
        closed = true;
        if (heartbeat !== null) clearInterval(heartbeat);
        unsubscribeData?.();
        unsubscribeData = null;
        unsubscribeExit?.();
        unsubscribeExit = null;
        if (abortHandler) req.signal.removeEventListener("abort", abortHandler);
        if (closeController) {
          try { controller.close(); } catch { /* stream already closed */ }
        }
      };
      cancelStream = cleanup;

      const enqueue = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup(false);
        }
      };

      abortHandler = () => cleanup(true);
      if (req.signal.aborted) {
        cleanup(true);
        return;
      }
      req.signal.addEventListener("abort", abortHandler, { once: true });

      unsubscribeData = session.subscribeData((data) => enqueue({ type: "data", data }));
      unsubscribeExit = session.subscribeExit((exitCode) => {
        enqueue({ type: "exit", exitCode });
        // Give the browser a chance to read the exit frame before closing.
        setTimeout(() => cleanup(true), 50);
      });

      enqueue({ type: "connected", session: session.toPublicInfo() });
      heartbeat = setInterval(() => {
        if (!closed) {
          try { controller.enqueue(encoder.encode(":\n\n")); } catch { cleanup(false); }
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      // The request was closed by the client; only stop forwarding events.
      // The shell itself keeps running so the terminal can reconnect later.
      cancelStream(false);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}