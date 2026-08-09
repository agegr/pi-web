import { NextResponse } from "next/server";
import { assignSession, SessionFolderError } from "@/lib/session-folders";

// PATCH /api/session-folders/assignments  body: { sessionId: string, folderId: string | null }
// folderId: null moves the session back to "unfiled".
export async function PATCH(req: Request) {
  try {
    const { sessionId, folderId } = await req.json() as { sessionId?: string; folderId?: string | null };
    if (typeof sessionId !== "string" || !sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    assignSession(sessionId, folderId ?? null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SessionFolderError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
