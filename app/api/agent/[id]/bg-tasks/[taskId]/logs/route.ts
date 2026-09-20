import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { bgOperationFailureStatus } from "@/lib/background-tasks-bridge";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/bg-tasks/[taskId]/logs - bounded output tail of one task
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const { id, taskId } = await params;
  const session = getRpcSession(id);
  const bridge = session?.getBackgroundTasks() ?? null;
  if (!bridge) {
    return NextResponse.json(
      { error: "pi-background-tasks bridge is not attached (no live session, chat-only session, or package absent)" },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const maxBytesParam = url.searchParams.get("maxBytes");
  const maxBytes = maxBytesParam === null ? undefined : Number(maxBytesParam);
  const tail = url.searchParams.get("tail") !== "false";
  const result = await bridge.logs(taskId, Number.isFinite(maxBytes) ? maxBytes : undefined, tail);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: bgOperationFailureStatus(result.error) });
  }
  return NextResponse.json(result.result);
}
