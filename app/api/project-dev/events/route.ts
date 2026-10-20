import { getAllowedFileRoots } from "@/lib/file-access";
import { authorizeProjectDevCwd } from "@/lib/project-dev-access";
import { subscribeProjectDev } from "@/lib/project-dev-manager";
import type { ProjectDevEvent } from "@/lib/project-dev-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Subscription { requestedCwd: unknown; cwd?: string; error?: string }

export async function GET(req: Request) {
  try {
    const cwd = await authorizeProjectDevCwd(new URL(req.url).searchParams.get("cwd"));
    return eventStream(req, [{ requestedCwd: cwd, cwd }], false);
  } catch (error) { return failure(error); }
}

/** One state-only stream for every project shown in the sidebar. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || !Array.isArray(body.cwds) || body.cwds.length > 100) {
      throw new Error("At most 100 project directories are allowed");
    }
    const roots = await getAllowedFileRoots();
    const subscriptions = await Promise.all(body.cwds.map(async (requestedCwd: unknown): Promise<Subscription> => {
      try {
        const cwd = await authorizeProjectDevCwd(requestedCwd, roots);
        return { requestedCwd, cwd };
      } catch (error) {
        return { requestedCwd, error: error instanceof Error ? error.message : String(error) };
      }
    }));
    return eventStream(req, subscriptions, true);
  } catch (error) { return failure(error); }
}

function eventStream(req: Request, subscriptions: Subscription[], stateOnly: boolean): Response {
  let close: (closeController: boolean) => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const unsubscribers: (() => void)[] = [];
      const abort = () => close(true);
      close = (closeController) => {
        if (closed) return;
        closed = true;
        for (const unsubscribe of unsubscribers) unsubscribe();
        clearInterval(heartbeat);
        req.signal.removeEventListener("abort", abort);
        if (closeController) { try { controller.close(); } catch { /* disconnected */ } }
      };
      const send = (cwd: unknown, event: ProjectDevEvent | { type: "error"; error: string }) => {
        if (closed) return;
        try {
          if ((controller.desiredSize ?? 0) <= 0) { close(true); return; }
          const payload = stateOnly && event.type === "snapshot" ? { ...event, logs: [] } : event;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stateOnly ? { cwd, event: payload } : event)}\n\n`));
        } catch { close(false); }
      };
      const heartbeat = setInterval(() => {
        try {
          if ((controller.desiredSize ?? 0) <= 0) close(true);
          else controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch { close(false); }
      }, 15_000);
      for (const subscription of subscriptions) {
        if (subscription.error) {
          send(subscription.requestedCwd, { type: "error", error: subscription.error });
        } else if (subscription.cwd) {
          unsubscribers.push(subscribeProjectDev(subscription.cwd, (event) => send(subscription.requestedCwd, event)));
        }
      }
      if (closed) return;
      req.signal.addEventListener("abort", abort, { once: true });
      if (req.signal.aborted) { abort(); return; }
    },
    cancel() { close(false); },
  }, { highWaterMark: 1024 * 1024, size: (chunk) => chunk.byteLength });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive", "X-Accel-Buffering": "no",
  } });
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, { status: message.startsWith("Access denied") ? 403 : 400 });
}
