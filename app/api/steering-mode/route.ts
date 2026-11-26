import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { getGlobalSettingsPath, readGlobalSettings, updateGlobalSettings } from "@/lib/global-settings-file";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { errorMessage } from "@/lib/errors";
import { applySteeringModeToLiveSessions } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// Settings › General's choice for pi's own `steeringMode` (#1771), the TUI's
// /settings "Steering mode": how many queued steers a turn takes. Written to
// the global settings.json under the lock pi's SettingsManager takes;
// "one-at-a-time" is pi's default, so choosing it removes the key. A project's
// .pi/settings.json still overrides it, as in pi. pi reads an older file's
// `queueMode` as `steeringMode` (SettingsManager.migrateSettings) and drops it.

const KEY = "steeringMode";
type SteeringMode = "one-at-a-time" | "all";

async function readMode(): Promise<SteeringMode> {
  return readGlobalSettings(getGlobalSettingsPath(), (settings) => {
    const value = KEY in settings ? settings[KEY] : settings.queueMode;
    return value === "all" ? "all" : "one-at-a-time";
  });
}

function errorResponse(error: unknown) {
  return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json({ mode: await readMode() });
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
  const mode = (body as { mode?: unknown } | null)?.mode;
  if (mode !== "one-at-a-time" && mode !== "all") {
    return NextResponse.json({ error: "mode must be \"one-at-a-time\" or \"all\"" }, { status: 400 });
  }
  try {
    // pi's default with no settings file: nothing to create.
    if (mode === "all" || existsSync(getGlobalSettingsPath())) {
      await updateGlobalSettings(getGlobalSettingsPath(), (settings) => {
        if (mode === "all") settings[KEY] = "all";
        else delete settings[KEY];
        delete settings.queueMode;
      });
    }
    // The TUI applies its choice to the running session at once; here every open one.
    await applySteeringModeToLiveSessions();
    return NextResponse.json({ mode: await readMode() });
  } catch (error) {
    return errorResponse(error);
  }
}
