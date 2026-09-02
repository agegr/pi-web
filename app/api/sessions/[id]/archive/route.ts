import { NextResponse } from "next/server";
import { archiveSession, unarchiveSession } from "@/lib/session-archive";
import { getRpcSession } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// POST /api/sessions/[id]/archive — archive a session (moves the jsonl into
// the project's archive/ directory, cascading to direct children)
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await getRpcSession(id)?.shutdown();
    const result = await archiveSession(id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]/archive — restore an archived session
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await unarchiveSession(id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
