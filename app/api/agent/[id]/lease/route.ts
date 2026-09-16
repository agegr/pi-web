import { NextResponse } from "next/server";
import { renewSessionLivenessLeases } from "@/lib/session-liveness";

// POST /api/agent/[id]/lease - Renew selected-session SSE leases.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return NextResponse.json({
    success: true,
    renewed: renewSessionLivenessLeases(id),
  }, { headers: { "Cache-Control": "no-store" } });
}
