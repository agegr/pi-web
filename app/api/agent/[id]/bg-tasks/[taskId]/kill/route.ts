import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { bgOperationFailureStatus } from "@/lib/background-tasks-bridge";

export const dynamic = "force-dynamic";

// POST /api/agent/[id]/bg-tasks/[taskId]/kill - kill one background task
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const { id, taskId } = await params;
  const session = getRpcSession(id);
  const bridge = session?.getBackgroundTasks() ?? null;
  if (!bridge) {
    return NextResponse.json(
      { error: "pi-background-tasks bridge is not attached (no live session, chat-only session, or package absent)" },
      { status: 404 },
    );
  }
  const result = await bridge.kill(taskId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: bgOperationFailureStatus(result.error) });
  }
  return NextResponse.json({ task: result.result.task, message: result.result.message });
}
