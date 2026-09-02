import { NextResponse } from "next/server";
import { listArchivedSessions } from "@/lib/session-archive";

export const dynamic = "force-dynamic";

// GET /api/sessions/archive — list all archived sessions
export async function GET() {
  try {
    const sessions = await listArchivedSessions();
    return NextResponse.json(
      { sessions },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
