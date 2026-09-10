import { NextResponse } from "next/server";
import {
  restoreTrashedSession,
  SessionTrashConflictError,
  SessionTrashNotFoundError,
} from "@/lib/session-trash";
import {
  invalidateSessionListCache,
  invalidateSessionPathCache,
} from "@/lib/session-reader";

// POST /api/sessions/trash/[id]/restore
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const restoredIds = restoreTrashedSession(id);
    for (const restoredId of restoredIds) invalidateSessionPathCache(restoredId);
    invalidateSessionListCache();
    return NextResponse.json({ ok: true, restoredIds });
  } catch (error) {
    const status = error instanceof SessionTrashNotFoundError
      ? 404
      : error instanceof SessionTrashConflictError ? 409 : 500;
    return NextResponse.json({ error: String(error) }, { status });
  }
}
