import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { PiWebSettingsLockedError, readPiWebSettings, updatePiWebSettings } from "@/lib/pi-web-settings";
import { parsePiWebSettingsRequest } from "@/lib/pi-web-settings-shared";

export const dynamic = "force-dynamic";

// This fork's own preferences (Settings › General › Chat) in
// `pi-web-settings.json`, beside `pi-web-session-state.json`: one file for the
// whole server, so a choice made in one browser shows in every one and on
// every device. `lib/pi-web-settings.ts` holds the file rules.

const NO_STORE = { "Cache-Control": "no-store" };

function refusal(status: number, reason: string, error: string) {
  return NextResponse.json({ error, reason }, { status, headers: NO_STORE });
}

// GET /api/pi-web-settings - every setting, defaults included.
export async function GET() {
  return NextResponse.json({ settings: readPiWebSettings() }, { headers: NO_STORE });
}

// PUT /api/pi-web-settings - any subset of the settings; answers with all of them.
export async function PUT(req: Request) {
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
  const parsed = parsePiWebSettingsRequest(body);
  if (!parsed.ok) return refusal(400, "invalid-request", parsed.error);

  try {
    const settings = await updatePiWebSettings(parsed.patch);
    return NextResponse.json({ settings }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof PiWebSettingsLockedError) return refusal(409, "locked", error.message);
    return refusal(500, "internal", error instanceof Error ? error.message : String(error));
  }
}
