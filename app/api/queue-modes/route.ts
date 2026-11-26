import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { getGlobalSettingsPath, readGlobalSettings, updateGlobalSettings } from "@/lib/global-settings-file";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { errorMessage } from "@/lib/errors";
import { applyQueueModesToLiveSessions } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// Settings › General's choices for pi's own `steeringMode` (#1771) and
// `followUpMode`, the TUI's /settings "Steering mode" and "Follow-up mode":
// how many queued steers or follow-ups a turn takes. Written to the global
// settings.json under the lock pi's SettingsManager takes; "one-at-a-time" is
// pi's default, so choosing it removes the key. A project's .pi/settings.json
// still overrides them, as in pi. pi reads an older file's `queueMode` as
// `steeringMode` (SettingsManager.migrateSettings) and drops it.

type QueueMode = "one-at-a-time" | "all";
type QueueModes = { steeringMode: QueueMode; followUpMode: QueueMode };
const KEYS = ["steeringMode", "followUpMode"] as const;

function queueMode(value: unknown): QueueMode {
  return value === "all" ? "all" : "one-at-a-time";
}

async function readModes(): Promise<QueueModes> {
  return readGlobalSettings(getGlobalSettingsPath(), (settings) => ({
    steeringMode: queueMode("steeringMode" in settings ? settings.steeringMode : settings.queueMode),
    followUpMode: queueMode(settings.followUpMode),
  }));
}

function errorResponse(error: unknown) {
  return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json(await readModes());
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
  const update: Partial<QueueModes> = {};
  for (const key of KEYS) {
    const value = (body as Record<string, unknown> | null)?.[key];
    if (value === undefined) continue;
    if (value !== "one-at-a-time" && value !== "all") {
      return NextResponse.json({ error: `${key} must be "one-at-a-time" or "all"` }, { status: 400 });
    }
    update[key] = value;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to change: give steeringMode or followUpMode" }, { status: 400 });
  }
  try {
    // pi's defaults with no settings file: nothing to create.
    if (Object.values(update).includes("all") || existsSync(getGlobalSettingsPath())) {
      await updateGlobalSettings(getGlobalSettingsPath(), (settings) => {
        for (const key of KEYS) {
          const mode = update[key];
          if (mode === "all") settings[key] = "all";
          else if (mode) delete settings[key];
        }
        if (update.steeringMode) delete settings.queueMode;
      });
    }
    // The TUI applies its choice to the running session at once; here every open one.
    await applyQueueModesToLiveSessions();
    return NextResponse.json(await readModes());
  } catch (error) {
    return errorResponse(error);
  }
}
