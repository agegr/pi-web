import { NextResponse } from "next/server";
import { getSubagentRun } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

/**
 * Legacy run status for sessions created by the removed built-in engine.
 * Live delegation is owned by the user-installed `pi-subagents` package, so
 * steering and aborting are no longer exposed here.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const run = await getSubagentRun(id);
    if (!run) return NextResponse.json({ error: "Subagent not found" }, { status: 404 });
    return NextResponse.json({ run });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
