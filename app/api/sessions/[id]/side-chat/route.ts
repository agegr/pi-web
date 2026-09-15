import { NextResponse } from "next/server";
import {
  disposeSideChatsForParent,
  getSideChatForParent,
  startSideChatSession,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// Side conversations ("/btw"): ephemeral forks of a session.
//
// GET    /api/sessions/[id]/side-chat  -> the live side conversation, if any
// POST   /api/sessions/[id]/side-chat  -> open one (reuses the live one)
// DELETE /api/sessions/[id]/side-chat  -> discard it
//
// One side conversation per parent session at a time. It has no session file,
// never appears in the session list, and is dropped on delete or when its
// runtime goes idle.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return NextResponse.json({
    success: true,
    data: { sideChat: getSideChatForParent(id) ?? null },
  });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const existing = getSideChatForParent(id);
    if (existing) {
      return NextResponse.json({ success: true, data: { sideChat: existing, reused: true } });
    }
    const sideChat = await startSideChatSession(id);
    return NextResponse.json({ success: true, data: { sideChat, reused: false } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const notFound = message === "Session not found";
    return NextResponse.json({ error: message }, { status: notFound ? 404 : 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sideChat = getSideChatForParent(id);
  if (!sideChat) {
    return NextResponse.json({ success: true, data: { disposed: 0 } });
  }
  const disposed = await disposeSideChatsForParent(id);
  return NextResponse.json({ success: true, data: { disposed } });
}
