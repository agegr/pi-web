import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { holdSessionLivenessLease } from "@/lib/session-liveness";
import { hasUnsettledSubagentRun } from "@/lib/subagent-runtime";

const HOLDER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// POST /api/agent/[id]/lease?holder=<page id> - Keep the session a page has selected alive
// (holdSessionLivenessLease()), whether or not the page holds its event stream, and say what
// is under way in it: a hidden page lets go of an idle stream and opens it again when this
// reports activity (#1283). Reads wrapper fields only: never starts a wrapper, never resets
// its idle timer.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const holder = new URL(req.url).searchParams.get("holder");
  if (!holder || !HOLDER_PATTERN.test(holder)) {
    return NextResponse.json({ error: "holder must be 1-64 letters, digits, - or _" }, { status: 400 });
  }
  holdSessionLivenessLease(id, holder);
  const session = getRpcSession(id);
  const alive = Boolean(session?.isAlive());
  return NextResponse.json({
    success: true,
    // A run, a queued prompt, a `!` command or a compaction (isRunning()).
    running: alive && session!.isRunning(),
    // An extension dialog waiting for an answer.
    awaitingInput: alive && session!.isAwaitingInput(),
    // A subagent under this session, at any depth, whose end starts a turn here.
    subagentsActive: hasUnsettledSubagentRun(id),
  }, { headers: { "Cache-Control": "no-store" } });
}
