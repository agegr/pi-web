import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    if (rpc?.isAlive()) {
      const state = await rpc.send({ type: "get_state" });
      return Response.json({ running: true, state });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    // Sessions are spawned lazily on first prompt; opening a session must
    // bring its runtime up too, otherwise extension widgets/status rendered
    // from get_state (e.g. rpiv-todo's panel) never appear until a message
    // is sent.
    const { session } = await startRpcSession(id, filePath, undefined);
    const state = await session.send({ type: "get_state" });
    return Response.json({ running: true, state });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
