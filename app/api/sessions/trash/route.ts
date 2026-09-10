import { NextResponse } from "next/server";
import { invalidateSessionListCache } from "@/lib/session-reader";
import {
  listTrashedSessions,
  permanentlyDeleteTrashedSessions,
  purgeExpiredTrashedSessions,
  SessionTrashNotFoundError,
} from "@/lib/session-trash";

export const dynamic = "force-dynamic";

// GET /api/sessions/trash?projectKey=...
export async function GET(req: Request) {
  try {
    const projectKey = new URL(req.url).searchParams.get("projectKey");
    if (!projectKey) {
      return NextResponse.json({ error: "projectKey is required" }, { status: 400 });
    }
    const purgedIds = purgeExpiredTrashedSessions();
    if (purgedIds.length > 0) invalidateSessionListCache();
    return NextResponse.json(
      { sessions: listTrashedSessions(projectKey) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

// DELETE /api/sessions/trash  body: { ids: string[] }
export async function DELETE(req: Request) {
  try {
    const body = await req.json() as { ids?: unknown };
    if (
      !Array.isArray(body.ids)
      || body.ids.length === 0
      || body.ids.some((id) => typeof id !== "string" || !id)
    ) {
      return NextResponse.json({ error: "ids must be a non-empty string array" }, { status: 400 });
    }
    const deletedIds = permanentlyDeleteTrashedSessions(body.ids);
    invalidateSessionListCache();
    return NextResponse.json({ ok: true, deletedIds });
  } catch (error) {
    const status = error instanceof SessionTrashNotFoundError ? 404 : 500;
    return NextResponse.json({ error: String(error) }, { status });
  }
}
