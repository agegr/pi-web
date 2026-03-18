import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";

export async function GET() {
  try {
    const sessions = await listAllSessions();
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
