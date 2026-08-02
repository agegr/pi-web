import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { startRpcSession, getRpcSession } from "@/lib/rpc-manager";

// POST /api/agent/[id] - Send a command to an existing session
const ALLOWED_AGENT_COMMANDS = new Set([
  "prompt",
  "abort",
  "get_state",
  "fork",
  "navigate_tree",
  "compact",
  "set_model",
  "set_thinking_level",
  "set_session_name",
  "get_session_stats",
  "get_last_assistant_text",
  "set_auto_compaction",
  "clear_queue",
  "steer",
  "follow_up",
  "get_tools",
  "get_commands",
  "set_tools",
  "reload",
  "abort_compaction",
  "extension_ui_response",
  "extension_ui_input",
  "set_auto_retry",
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const body = (await req.json()) as { type: string; [key: string]: unknown };

    if (!ALLOWED_AGENT_COMMANDS.has(body.type)) {
      return NextResponse.json({ error: `unknown command: ${body.type}` }, { status: 400 });
    }

    // Fast path: already-running session
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      const result = await existing.send(body);
      return NextResponse.json({ success: true, data: result });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const { session } = await startRpcSession(id, filePath, undefined);
    const result = await session.send(body);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
