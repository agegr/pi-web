import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { listAllSessions } from "@/lib/session-reader";

export async function GET() {
  try {
    const sessions = await listAllSessions();
    return NextResponse.json({
      sessions: sessions.map((session) => ({
        ...session,
        cwdExists: session.cwd ? existsSync(session.cwd) : false,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
