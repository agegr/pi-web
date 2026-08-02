// GET /api/plan/[id]/events —— SSE 事件流
// 先推送当前快照（snapshot 事件），再实时推送编排器事件，直至 done/error/cancelled。
import { NextResponse } from "next/server";
import { getOrchestrator, type OrchestratorEvent } from "@/lib/agent-orchestrator";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orch = getOrchestrator(id);
  if (!orch) {
    return NextResponse.json({ error: "编排会话不存在" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* 已关闭 */
        }
      };

      // 1) 当前快照，便于前端初始化。
      send({ type: "snapshot", snapshot: orch.getSnapshot() });

      // 2) 订阅后续事件。
      unsub = orch.subscribe((e: OrchestratorEvent) => {
        send(e);
        if (e.type === "done" || e.type === "error") {
          try {
            controller.close();
          } catch {
            /* noop */
          }
        }
      });

      // 3) 若编排在订阅前已结束，补发收尾。
      const s = orch.getSnapshot().status;
      if (s === "done" || s === "failed" || s === "cancelled") {
        send({ type: "done", snapshot: orch.getSnapshot(), at: Date.now() });
        try {
          controller.close();
        } catch {
          /* noop */
        }
      }
    },
    cancel() {
      unsub?.();
    },
  });

  // 请求中断时清理订阅。
  req.signal.addEventListener("abort", () => unsub?.());

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
