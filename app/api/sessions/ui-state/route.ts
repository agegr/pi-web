import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  readSessionUiState,
  SessionUiStateLockedError,
  updateSessionUiState,
} from "@/lib/session-ui-state";
import {
  MAX_PROJECT_NAMES,
  PROJECT_NAMES_MAX_BYTES,
  parseSessionUiStateRequest,
  storedProjectName,
  type SessionUiStateErrorResponse,
  type SessionUiStateRefusalReason,
  type SessionUiStateResponse,
} from "@/lib/session-ui-state-shared";

export const dynamic = "force-dynamic";

// The sidebar's pins, archive, project order and project names
// (lib/session-ui-state.ts). Ids and projectKeys are not checked against the
// session list: an entry for a session that is gone is harmless, and deleting
// a session removes its entry; a project no longer shown keeps its place in
// the order and its name.

const NO_STORE = { "Cache-Control": "no-store" };

function refusal(status: number, reason: SessionUiStateRefusalReason, error: string) {
  return NextResponse.json({ error, reason } satisfies SessionUiStateErrorResponse, { status, headers: NO_STORE });
}

// GET /api/sessions/ui-state
export async function GET() {
  return NextResponse.json({ state: readSessionUiState() } satisfies SessionUiStateResponse, { headers: NO_STORE });
}

// POST /api/sessions/ui-state - one change; answers with the state after it.
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return refusal(403, "request-denied", "Untrusted API request");
  }
  if (!hasJsonContentType(req)) {
    return refusal(415, "content-type", "Content-Type must be application/json");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refusal(400, "invalid-request", "Invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return refusal(400, "invalid-request", "Expected a JSON object");
  }
  const parsed = parseSessionUiStateRequest(body);
  if (!parsed.ok) return refusal(400, "invalid-request", parsed.error);

  const { request } = parsed;
  try {
    const state = await updateSessionUiState(request);
    // A name with no room left was not stored (nothing was written): say so,
    // rather than answer with a state that quietly lacks it.
    if (request.action === "rename-project" && request.name !== null && storedProjectName(state, request.projectKey) !== request.name) {
      return refusal(409, "full", `No room for another project name (at most ${MAX_PROJECT_NAMES}, ${PROJECT_NAMES_MAX_BYTES / 1024} KiB in all)`);
    }
    return NextResponse.json({ state } satisfies SessionUiStateResponse, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SessionUiStateLockedError) return refusal(409, "locked", error.message);
    return refusal(500, "internal", error instanceof Error ? error.message : String(error));
  }
}
