import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath, sliceActiveBranch } from "@/lib/session-reader";
import {
  buildTrajectory,
  windowTrajectory,
  DEFAULT_TRAJECTORY_PAGE,
  MAX_TRAJECTORY_PAGE,
} from "@/lib/trajectory";
import type { SessionEntry } from "@/lib/types";
import { jsonResponse } from "@/lib/json-response";

// GET /api/sessions/[id]/trajectory?tail=200&before=<rowId>
// Returns the active branch as an event ledger plus a paged window of it.
//
// Kept separate from /api/sessions/[id] on purpose: the session payload is
// loaded on every session switch and already carries the context window and
// tree, while the ledger is only needed when the trajectory panel is open.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const resolvedPath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !resolvedPath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(resolvedPath!);
    const entries = sm.getEntries() as unknown as SessionEntry[];
    const searchParams = new URL(req.url).searchParams;
    const rawTail = Number(searchParams.get("tail"));
    const tail = Number.isFinite(rawTail) && rawTail > 0
      ? Math.min(rawTail, MAX_TRAJECTORY_PAGE)
      : DEFAULT_TRAJECTORY_PAGE;
    const before = searchParams.get("before") ?? undefined;
    const requestedLeaf = searchParams.get("leafId");
    const leafId = requestedLeaf ?? sm.getLeafId();

    // The ledger follows the branch the chat is showing. Whole-session totals in
    // the session info panel still cover every entry in the file, including
    // abandoned branches and compacted history.
    const branchEntries = activeBranchEntries(entries, leafId);
    const view = buildTrajectory(branchEntries as never);
    const windowed = windowTrajectory(view, { tail, ...(before ? { before } : {}) });

    return jsonResponse(req, {
      sessionId: id,
      leafId,
      span: view.span,
      coverage: view.coverage,
      unmatchedTiming: view.unmatchedTiming,
      branch: {
        rows: view.rows.length,
        turns: view.turns.length,
      },
      rows: windowed.rows,
      turns: windowed.turns,
      hasMore: windowed.hasMore,
      oldestRowId: windowed.oldestRowId,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** Full root-to-leaf chain: the branch the chat is showing, in append order. */
function activeBranchEntries(entries: SessionEntry[], leafId: string | null | undefined): SessionEntry[] {
  if (leafId === null) return [];
  return sliceActiveBranch(entries, leafId ?? null, entries.length);
}
