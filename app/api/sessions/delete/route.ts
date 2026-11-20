import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { deleteSessions, MAX_SESSION_DELETE_IDS, type SessionDeleteResult } from "@/lib/session-delete";
import { SESSION_ID_PATTERN } from "@/lib/session-ui-state-shared";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// A project group's "Delete all sessions": the ids the sidebar showed in its
// confirmation, each with the subagent sessions below it, in one pass over
// the catalogue (lib/session-delete.ts). A session that started running since
// is kept and reported, never stopped; an id already gone is reported too.

const NO_STORE = { "Cache-Control": "no-store" };

function refusal(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

// POST /api/sessions/delete - body { ids: string[] } (at most MAX_SESSION_DELETE_IDS).
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return refusal(403, "Untrusted API request");
  if (!hasJsonContentType(req)) return refusal(415, "Content-Type must be application/json");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refusal(400, "Invalid JSON body");
  }
  const ids = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as { ids?: unknown }).ids : undefined;
  if (!Array.isArray(ids) || ids.length === 0) return refusal(400, "ids must be a non-empty array");
  if (ids.length > MAX_SESSION_DELETE_IDS) return refusal(400, `ids may hold at most ${MAX_SESSION_DELETE_IDS} session ids`);
  if (!ids.every((id) => typeof id === "string" && SESSION_ID_PATTERN.test(id))) return refusal(400, "ids must be session ids");

  try {
    const result = await deleteSessions(ids as string[], { keepRunning: true });
    return NextResponse.json(result satisfies SessionDeleteResult, { headers: NO_STORE });
  } catch (error) {
    return refusal(500, errorMessage(error));
  }
}
