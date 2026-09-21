import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/bg-tasks - list background tasks of a live session
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getRpcSession(id);
  const bridge = session?.getBackgroundTasks() ?? null;
  if (!bridge) {
    // No live wrapper (or chat-only session): the pi-background-tasks bridge
    // is not attached. Degrade explicitly instead of erroring (#7).
    return NextResponse.json(
      { error: "pi-background-tasks bridge is not attached (no live session, chat-only session, or package absent)" },
      { status: 404 },
    );
  }
  if (!(await bridge.probeCapabilities())) {
    return NextResponse.json(
      { error: "pi-background-tasks is unavailable (package not installed in this session)" },
      { status: 404 },
    );
  }
  const result = await bridge.listTasks();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ tasks: result.result });
}
