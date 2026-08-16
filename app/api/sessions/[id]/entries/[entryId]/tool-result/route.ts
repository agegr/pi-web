import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { normalizeToolCalls } from "@/lib/normalize";
import type { SessionEntry } from "@/lib/types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const entries = (liveRpc
      ? liveRpc.inner.sessionManager.getEntries()
      : getSessionEntries(filePath!)) as unknown as SessionEntry[];
    const entry = entries.find((candidate) => candidate.id === entryId);
    if (!entry || entry.type !== "message" || entry.message.role !== "toolResult") {
      return Response.json({ error: "Tool result not found" }, { status: 404 });
    }

    return Response.json({ result: normalizeToolCalls(entry.message) });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
