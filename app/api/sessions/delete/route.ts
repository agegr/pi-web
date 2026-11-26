import { NextResponse } from "next/server";
import { deleteSessions, MAX_SESSION_DELETE_IDS, type SessionDeleteResult } from "@/lib/session-delete";
import { NO_STORE, noStoreRefusal, readSessionIdsRequest } from "@/lib/session-ids-request";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// A project group's "Delete all sessions": the ids the sidebar showed in its
// confirmation, each with the subagent sessions below it, in one pass over
// the catalogue (lib/session-delete.ts). A session that started running since
// is kept and reported, never stopped; an id already gone is reported too.

// POST /api/sessions/delete - body { ids: string[] } (at most MAX_SESSION_DELETE_IDS).
export async function POST(req: Request) {
  const ids = await readSessionIdsRequest(req, MAX_SESSION_DELETE_IDS);
  if (ids instanceof Response) return ids;

  try {
    const result = await deleteSessions(ids, { keepRunning: true });
    return NextResponse.json(result satisfies SessionDeleteResult, { headers: NO_STORE });
  } catch (error) {
    return noStoreRefusal(500, errorMessage(error));
  }
}
