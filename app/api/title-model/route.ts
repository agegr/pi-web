import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  parseTitleModelPreference,
  readTitleModelPreference,
  writeTitleModelPreference,
} from "@/lib/title-model-preference";

export const dynamic = "force-dynamic";

// Which model the Generate title button names a session with: one choice for
// this pi-web instance, so every browser and device names sessions alike, and
// empty until the button's menu sets one. The rules of that value, its file and
// what an empty one means live in lib/title-model-preference.ts.

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json({ titleModel: readTitleModelPreference() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // null clears the choice; a body that is neither null nor an object is a
  // client mistake, and clearing the choice over it would lose it silently.
  const requested = (body as { titleModel?: unknown } | null)?.titleModel;
  if (requested !== null && (typeof requested !== "object" || Array.isArray(requested))) {
    return NextResponse.json({ error: "titleModel must be an object or null" }, { status: 400 });
  }
  try {
    const titleModel = parseTitleModelPreference(requested);
    writeTitleModelPreference(titleModel);
    return NextResponse.json({ titleModel });
  } catch (error) {
    return errorResponse(error);
  }
}
