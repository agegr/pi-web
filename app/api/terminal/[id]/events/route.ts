import { hasTerminal, subscribeTerminal, type TerminalEvent } from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!hasTerminal(id)) return new Response("Terminal not found", { status: 404 });
  const cursor = req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("after");
  const after = cursor !== null && /^\d+$/.test(cursor) && Number.isSafeInteger(Number(cursor))
    ? Number(cursor) : undefined;

  let closeStream: (closeController: boolean) => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;
      const cleanup = (closeController: boolean) => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        req.signal.removeEventListener("abort", abort);
        if (closeController) {
          try { controller.close(); } catch { /* already closed */ }
        }
      };
      const abort = () => cleanup(true);
      const send = (event: TerminalEvent) => {
        if (closed) return;
        try {
          if ((controller.desiredSize ?? 0) <= 0) {
            cleanup(true);
            return;
          }
          const eventId = event.type === "output" ? `id: ${event.offset}\n` : "";
          controller.enqueue(encoder.encode(`${eventId}data: ${JSON.stringify(event)}\n\n`));
          if (event.type === "exit" || event.type === "closed") cleanup(true);
        } catch {
          cleanup(false);
        }
      };
      closeStream = cleanup;
      const subscription = subscribeTerminal(id, send, after);
      if (!subscription) {
        cleanup(true);
        return;
      }
      unsubscribe = subscription.unsubscribe;
      controller.enqueue(encoder.encode(":\n\n"));
      send(subscription.output);
      if (subscription.exited) send({ type: "exit", exitCode: subscription.exitCode ?? 0 });
      if (closed) return;
      req.signal.addEventListener("abort", abort, { once: true });
      if (req.signal.aborted) {
        abort();
        return;
      }
      heartbeat = setInterval(() => {
        try {
          if ((controller.desiredSize ?? 0) <= 0) cleanup(true);
          else if (!closed) controller.enqueue(encoder.encode(":\n\n"));
        } catch { cleanup(false); }
      }, 30_000);
    },
    cancel() {
      closeStream(false);
    },
  }, { highWaterMark: 256 * 1024, size: (chunk) => chunk.byteLength });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
