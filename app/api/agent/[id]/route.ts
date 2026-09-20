import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, isSessionReloadedFromDiskError, setRpcSessionTools, startRpcSession } from "@/lib/rpc-manager";

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let commandType: string | undefined;
  let promptAccepted = false;

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };
    commandType = typeof body.type === "string" ? body.type : undefined;
    const requestedToolNames = body.toolNames;
    if (
      requestedToolNames !== undefined
      && (!Array.isArray(requestedToolNames) || requestedToolNames.some((name) => typeof name !== "string"))
    ) {
      throw new Error("toolNames must be an array of strings");
    }
    const toolNames = requestedToolNames as string[] | undefined;

    // Fast path: already-running session
    const existing = getRpcSession(id);
    if (body.type === "set_tools") {
      const filePath = existing?.sessionFile || await resolveSessionPath(id) || undefined;
      if (!existing?.isAlive() && !filePath) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      const changed = await setRpcSessionTools(id, filePath, toolNames);
      return NextResponse.json({
        success: true,
        data: { sessionId: changed.sessionId, recreated: changed.recreated },
      });
    }
    // Prompt submissions probe disk-ahead inside AgentSessionWrapper.send(),
    // AFTER prompt admission is acquired, so an external append between the
    // probe and the submission can no longer chain the prompt onto a stale
    // in-memory head and fork the session tree. When that probe evicts the
    // wrapper, send() throws SessionReloadedFromDiskError; fall through to
    // the cold-start path below so the prompt continues against freshly
    // loaded state and the response reports the reload to the client.
    let reloadedFromDisk = false;
    if (existing?.isAlive()) {
      try {
        const result = await existing.send(body);
        promptAccepted = body.type === "prompt";
        return NextResponse.json({ success: true, data: result });
      } catch (error) {
        if (!isSessionReloadedFromDiskError(error)) throw error;
        reloadedFromDisk = true;
      }
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({
        error: "Session not found",
        ...(body.type === "prompt"
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      }, { status: 404 });
    }

    const { session } = await startRpcSession(id, filePath, undefined, {
      ...(toolNames !== undefined ? { toolNames } : {}),
    });
    const result = await session.send(body);
    promptAccepted = body.type === "prompt";

    // Prompt results are otherwise always null; report the external-write
    // reload through the prompt payload so the client can surface a notice.
    return NextResponse.json({
      success: true,
      data: reloadedFromDisk && body.type === "prompt" ? { reloadedFromDisk: true } : result,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(commandType === "prompt" && !promptAccepted
        ? { code: "prompt_rejected", accepted: false }
        : {}),
    }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }

    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
