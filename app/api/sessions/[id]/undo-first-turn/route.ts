import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { getRpcSession, isRpcSessionStarting } from "@/lib/rpc-manager";
import { resolveSessionPath, invalidateSessionListCache } from "@/lib/session-reader";
import { hasActiveSessionLivenessProvider } from "@/lib/session-liveness";
import { sessionHistoryLocks } from "@/lib/session-history-lock";
import { undoFirstTurnFile } from "@/lib/first-turn-undo-file";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  const { id } = await params;
  const target = await request.json().catch(() => null);
  if (typeof target?.entryId !== "string" || typeof target?.leafId !== "string") {
    return NextResponse.json({ error: "entryId and leafId are required" }, { status: 400 });
  }
  const locks = sessionHistoryLocks();
  if (locks.has(id) || isRpcSessionStarting(id)) return NextResponse.json({ error: "Session is busy" }, { status: 409 });
  locks.add(id);
  try {
    const rpc = getRpcSession(id);
    if (rpc?.isAlive() && !rpc.canUndoFirstTurn()) throw new Error("Stop the session and clear queued messages first");
    const filePath = rpc?.sessionFile || await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    if (hasActiveSessionLivenessProvider({ sessionId: id, sessionFile: filePath })) throw new Error("Session has active background work");
    if (rpc?.isAlive() && rpc.inner.sessionManager.getLeafId() !== target.leafId) throw new Error("The active branch has changed");
    await undoFirstTurnFile(filePath, id, target, async () => { await rpc?.shutdown(); });
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  } finally {
    locks.delete(id);
  }
}
