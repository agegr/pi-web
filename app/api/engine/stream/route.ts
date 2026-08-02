import {
  registerDefaultEngine,
  getEngineRuntimeInstance,
} from "@/lib/unified-engine/unified-engine-adapter";
import type { EngineEvent } from "@/lib/unified-engine/unified-engine-types";

export const dynamic = "force-dynamic";

// GET /api/engine/stream —— SSE 事件流，推送融合引擎全部状态更新
export async function GET(req: Request) {
  registerDefaultEngine();
  const runtime = getEngineRuntimeInstance();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: EngineEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      const unsub = runtime.subscribe(send);
      controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`));

      const onAbort = () => {
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
