import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { projectTrajectory } from "@/lib/trajectory-projection";
import { readTrajectoryFile } from "@/lib/trajectory-store";
import type { TrajectoryDetailLevel, TrajectoryUnsupportedResponse } from "@/lib/trajectory-types";

export const dynamic = "force-dynamic";

function unsupported(id: string, reason: "no_sidecar" | "missing_session"): TrajectoryUnsupportedResponse {
  return {
    schemaVersion: 1,
    detailLevel: "summary",
    code: "trajectory_unsupported",
    session: { id, supported: false, reason },
  };
}

// GET /api/sessions/[id]/trajectory?leafId=&detailLevel=summary|full
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const searchParams = new URL(req.url).searchParams;

  const rawDetail = searchParams.get("detailLevel");
  if (rawDetail !== null && rawDetail !== "summary" && rawDetail !== "full") {
    return Response.json({ error: "detailLevel must be summary or full" }, { status: 400 });
  }
  const detailLevel: TrajectoryDetailLevel = rawDetail === "full" ? "full" : "summary";

  let sm: SessionManager;
  const rpc = getRpcSession(id);
  if (rpc?.isAlive()) {
    sm = rpc.inner.sessionManager;
  } else {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    try {
      sm = SessionManager.open(filePath, undefined);
    } catch {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
  }

  const leafId = searchParams.get("leafId") ?? sm.getLeafId();
  const branchEntryIds = new Set(sm.getBranch(leafId ?? undefined).map((entry) => entry.id));

  const read = await readTrajectoryFile(getAgentDir(), id);
  if (!read) {
    return Response.json(unsupported(id, "no_sidecar"), { status: 409 });
  }
  if (read.header?.sessionId !== id) {
    return Response.json(unsupported(id, "missing_session"), { status: 409 });
  }

  const body = projectTrajectory(read, {
    leafId,
    detailLevel,
    branchEntryIds,
  });
  return Response.json(body);
}
