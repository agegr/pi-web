import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession, type AgentEvent } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

const OMITTED_EVENT_TYPES = new Set(["turn_start", "turn_end", "tool_execution_update"]);

// assistantMessageEvent 中可安全转发给浏览器的轻量字段。`partial`（完整累积
// 消息）被有意剥离——转发它会重新引入 O(n²) 传输（每个 delta 都重发此前
// 生成的全部内容）。`done`/`error` 不在此列：它们的 reason 已包含在
// message_end 的完整消息中，前端从 message_end 获取即可。
const DELTA_FIELDS: Record<string, readonly string[]> = {
  start: [],
  text_start: ["contentIndex"],
  text_delta: ["contentIndex", "delta"],
  text_end: ["contentIndex", "content"],
  thinking_start: ["contentIndex"],
  thinking_delta: ["contentIndex", "delta"],
  thinking_end: ["contentIndex", "content"],
  toolcall_start: ["contentIndex"],
  toolcall_delta: ["contentIndex", "delta"],
  toolcall_end: ["contentIndex", "toolCall"],
};

// done/error 不转发：reason 已随 message_end 的完整消息下发，前端无需重复接收。
const OMITTED_DELTA_TYPES = new Set(["done", "error"]);

function toClientEvent(event: AgentEvent): AgentEvent | null {
  if (OMITTED_EVENT_TYPES.has(event.type)) return null;
  if (event.type === "message_update") {
    const delta = event.assistantMessageEvent as ({ type: string } & Record<string, unknown>) | undefined;
    const fields = delta && typeof delta.type === "string" ? DELTA_FIELDS[delta.type] : undefined;
    if (delta && fields) {
      // 增量事件：只转发轻量 delta 字段，浏览器端据此拼接流式消息。
      const slimDelta: Record<string, unknown> = { type: delta.type };
      for (const field of fields) slimDelta[field] = delta[field];
      // toolcall_start 只携带 contentIndex；id/name 仅存在于 partial（完整累积
      // 消息）中。只提取这两个字段注入，不转发整个 partial，避免重新引入
      // O(n²) 传输——否则流式期间工具卡片无名无 id。
      if (delta.type === "toolcall_start") {
        const partial = delta.partial as
          | { content?: Array<{ type: string; id?: string; name?: string }> }
          | undefined;
        const block = partial?.content?.[Number(delta.contentIndex)];
        if (block?.type === "toolCall") {
          slimDelta.id = block.id;
          slimDelta.name = block.name;
        }
      }
      return { type: "message_delta", assistantMessageEvent: slimDelta } as unknown as AgentEvent;
    }
    if (delta && OMITTED_DELTA_TYPES.has(delta.type)) return null;
    // 无 delta 或未知 delta 类型：降级为完整快照（罕见兜底，浏览器覆盖校准）。
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

  // Fast path: already-running session
  let session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return new Response("Session not found", { status: 404 });
    }
    try {
      ({ session } = await startRpcSession(id, filePath, undefined));
    } catch (error) {
      return new Response(`Failed to start agent: ${error}`, { status: 500 });
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

      // 重连恢复：若 session 正在流式（页面关闭后重新打开、网络闪断重连），
      // 先把当前部分消息作为完整快照发给浏览器，让它重建增量拼接基座——
      // 否则订阅只收到之后的 delta，关闭期间生成的内容要等 message_end
      // 才显示。SDK 保证 streamingMessage 仅在消息流式期间非空，故此处不会
      // 注入已完成的旧消息。
      const streamingMessage = session.streamingMessage;
      if (streamingMessage) {
        encode({ type: "message_update", message: streamingMessage });
      }

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
