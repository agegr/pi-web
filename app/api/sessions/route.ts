import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { getWorktreeMeta } from "@/lib/worktree-sessions";

export async function GET() {
  try {
    const sessions = await listAllSessions();
    return NextResponse.json({ sessions, worktrees: getWorktreeMeta() });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
