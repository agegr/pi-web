import { NextResponse } from "next/server";
import { getPtySession } from "@/lib/pty-manager";

export const dynamic = "force-dynamic";

// GET /api/pty/[id] — SSE stream: replays the backlog, then live output.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getPtySession(id);
  if (!session) return new Response("Terminal session not found", { status: 404 });
  if (req.signal.aborted) return new Response(null, { status: 204 });

  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribeOutput: (() => void) | null = null;
  let unsubscribeExit: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let acquired = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat !== null) clearInterval(heartbeat);
        unsubscribeOutput?.();
        unsubscribeExit?.();
        if (acquired) {
          acquired = false;
          session.release();
        }
        if (req.signal.aborted) return;
        try { controller.close(); } catch { /* already closed */ }
      };

      // "start" lets the client reset before the backlog replay so
      // EventSource auto-reconnects render exactly once.
      send({ type: "start" });
      send({ type: "data", data: session.takeBacklog() });
      if (!session.isAlive()) {
        send({ type: "exit" });
        cleanup();
        return;
      }

      acquired = true;
      session.acquire();

      unsubscribeOutput = session.onOutput((data) => send({ type: "data", data }));
      unsubscribeExit = session.onExit(() => {
        send({ type: "exit" });
        cleanup();
      });
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 30_000);

      req.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      closed = true;
      unsubscribeOutput?.();
      unsubscribeExit?.();
      if (heartbeat !== null) clearInterval(heartbeat);
      if (acquired) {
        acquired = false;
        session.release();
      }
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

// POST /api/pty/[id]  body: { action: "input" | "resize", data? | cols?, rows? }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getPtySession(id);
  if (!session) return NextResponse.json({ error: "Terminal session not found" }, { status: 404 });

  const body = await req.json().catch(() => ({})) as {
    action?: unknown;
    data?: unknown;
    cols?: unknown;
    rows?: unknown;
  };

  if (body.action === "input") {
    if (typeof body.data !== "string") {
      return NextResponse.json({ error: "data must be a string" }, { status: 400 });
    }
    session.write(body.data);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "resize") {
    const cols = Number(body.cols);
    const rows = Number(body.rows);
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
      return NextResponse.json({ error: "cols and rows are required" }, { status: 400 });
    }
    session.resize(Math.floor(cols), Math.floor(rows));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// DELETE /api/pty/[id] — kill the terminal process.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getPtySession(id);
  if (session) session.kill();
  return NextResponse.json({ ok: true });
}
