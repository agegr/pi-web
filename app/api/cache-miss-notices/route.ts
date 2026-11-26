import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { getGlobalSettingsPath, readGlobalSettings, updateGlobalSettings } from "@/lib/global-settings-file";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Settings › General's switch for pi's own `showCacheMissNotices` (#1265), in
// the global settings.json under the lock pi's SettingsManager takes. Off is
// pi's default, so turning it off removes the key. A project's
// .pi/settings.json still overrides it, as in pi.

const KEY = "showCacheMissNotices";

async function readEnabled(): Promise<boolean> {
  return readGlobalSettings(getGlobalSettingsPath(), (settings) => settings[KEY] === true);
}

function errorResponse(error: unknown) {
  return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json({ enabled: await readEnabled() });
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
  const enabled = (body as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  try {
    // Off with no settings file is already pi's default: nothing to create.
    if (!enabled && !existsSync(getGlobalSettingsPath())) return NextResponse.json({ enabled: false });
    await updateGlobalSettings(getGlobalSettingsPath(), (settings) => {
      if (enabled) settings[KEY] = true;
      else delete settings[KEY];
    });
    return NextResponse.json({ enabled: await readEnabled() });
  } catch (error) {
    return errorResponse(error);
  }
}
