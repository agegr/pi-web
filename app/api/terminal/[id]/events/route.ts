import { hasTerminal, subscribeTerminal, type TerminalEvent } from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!hasTerminal(id)) return new Response("Terminal not found", { status: 404 });

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
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup(false);
        }
      };
      closeStream = cleanup;
      const subscription = subscribeTerminal(id, send);
      if (!subscription) {
        cleanup(true);
        return;
      }
      unsubscribe = subscription.unsubscribe;
      controller.enqueue(encoder.encode(":\n\n"));
      if (subscription.backlog) send({ type: "output", data: subscription.backlog });
      if (subscription.exited) send({ type: "exit", exitCode: subscription.exitCode ?? 0 });
      req.signal.addEventListener("abort", abort, { once: true });
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(":\n\n"));
      }, 30_000);
    },
    cancel() {
      closeStream(false);
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
