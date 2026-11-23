import { NextResponse } from "next/server";
import { openSessionManager, resolveSessionPath } from "@/lib/session-reader";
import { sessionToMarkdown } from "@/lib/session-markdown";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/sessions/[id]/markdown
// One session's active branch as the bounded transcript a # session reference
// quotes: user messages and assistant final replies, the beginning and the
// recent end when the caps hit. Read-only, never starts a wrapper (the same
// disk path as GET /api/sessions/[id]).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const sm = openSessionManager(filePath);
    // SAFETY: the SDK's SessionManager parses the JSONL into entries whose shape
    // matches our SessionEntry structural types; session-reader.ts reads the
    // same files through the same manager.
    const result = sessionToMarkdown(
      sm.getEntries() as unknown as SessionEntry[],
      sm.getLeafId(),
    );
    return NextResponse.json({
      sessionId: id,
      title: sm.getSessionName(),
      path: filePath,
      ...result,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}