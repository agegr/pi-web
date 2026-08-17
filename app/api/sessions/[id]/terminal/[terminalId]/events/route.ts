import { getTerminal, type TerminalEvent } from "@/lib/terminal-manager";
import { getTerminalAccessError } from "@/lib/terminal-security";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  const blocked = getTerminalAccessError(req);
  if (blocked) return Response.json({ error: blocked.error }, { status: blocked.status });

  const { id, terminalId } = await params;
  const terminal = getTerminal(id, terminalId);
  if (!terminal) return Response.json({ error: "Terminal not found" }, { status: 404 });
  // The browser supplies Last-Event-ID only on its own automatic retries. A panel
  // that deliberately dropped its stream while backgrounded reopens a brand new
  // EventSource, which cannot set headers, so it resumes through the query string.
  const requestedSequence = req.headers.get("last-event-id")
    ?? new URL(req.url).searchParams.get("after")
    ?? "0";
  const parsedSequence = Number(requestedSequence);
  const afterSequence = Number.isSafeInteger(parsedSequence) && parsedSequence >= 0 ? parsedSequence : 0;

  let cancel = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;
      let abortHandler: (() => void) | null = null;

      const cleanup = (closeController: boolean) => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        if (abortHandler) req.signal.removeEventListener("abort", abortHandler);
        if (closeController) {
          try { controller.close(); } catch { /* stream already closed */ }
        }
      };
      cancel = () => cleanup(false);
      const enqueue = (text: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(text)); } catch { cleanup(false); }
      };
      const send = (event: TerminalEvent) => {
        enqueue(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
        if (event.type === "exit") cleanup(true);
      };

      // Announce the connection before replaying, so a resuming client is not
      // handed buffered output while it still believes it is offline.
      enqueue(`data: ${JSON.stringify({ type: "connected", terminalId })}\n\n`);
      unsubscribe = terminal.subscribe(afterSequence, send);
      heartbeat = setInterval(() => enqueue(":\n\n"), 30_000);
      heartbeat.unref?.();
      abortHandler = () => cleanup(true);
      if (req.signal.aborted) cleanup(true);
      else req.signal.addEventListener("abort", abortHandler, { once: true });
    },
    cancel() {
      cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
