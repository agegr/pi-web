import { NextResponse } from "next/server";
import { listArchivedSessions } from "@/lib/session/session-utils";

export async function GET() {
  try {
    const sessions = listArchivedSessions();
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
