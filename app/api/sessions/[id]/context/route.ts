import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath, buildSessionContext } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath || !existsSync(filePath)) {
      // Not flushed to disk yet — read entries from the live in-memory session
      // instead of letting SessionManager.open mint a new one under a stale path.
      const rpc = getRpcSession(id);
      const detail = rpc?.isAlive() ? rpc.getMemorySessionDetail() : null;
      if (!detail) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      const context = buildSessionContext(detail.entries as never, leafId);
      return NextResponse.json({ context });
    }

    const sm = SessionManager.open(filePath);
    const context = buildSessionContext(sm.getEntries() as never, leafId);

    return NextResponse.json({ context });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
