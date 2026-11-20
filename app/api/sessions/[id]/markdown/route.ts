import { NextResponse } from "next/server";
import { openSessionManager, resolveSessionPath } from "@/lib/session-reader";
import { sessionToMarkdown } from "@/lib/session-markdown";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/sessions/[id]/markdown
// The composer's # session mention: the referenced session's active branch as
// bounded Markdown, inserted into the composer so it reaches the agent's
// context as text. Read-only, never starts a wrapper (the same disk path as
// GET /api/sessions/[id]).
export async function GET(
  _req: Request,
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
      cwd: sm.getHeader()?.cwd ?? "",
      messageCount: sm.getEntries().length,
      ...result,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
