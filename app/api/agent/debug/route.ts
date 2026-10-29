import { NextResponse } from "next/server";
import { buildDebugSnapshot } from "@/lib/debug-snapshot";

export const dynamic = "force-dynamic";
// The registries it reads live in this Node process.
export const runtime = "nodejs";

const MAX_SESSION_ID_LENGTH = 512;

// GET /api/agent/debug?session=<id> - The debug panel's server view: the global layer and the
// selected session's detail in one request, since over HTTP/1.1 each request competes for the
// browser's six connections. Reads only (lib/debug-snapshot.ts): never starts a wrapper, opens
// a stream or moves an idle timer.
export async function GET(req: Request) {
  const requested = new URL(req.url).searchParams.get("session");
  const sessionId = requested && requested.length <= MAX_SESSION_ID_LENGTH ? requested : null;
  return NextResponse.json(buildDebugSnapshot(sessionId), { headers: { "Cache-Control": "no-store" } });
}
