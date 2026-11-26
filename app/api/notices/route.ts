import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { getGlobalSettingsPath, readGlobalSettings, updateGlobalSettings } from "@/lib/global-settings-file";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { errorMessage } from "@/lib/errors";
import { isRecord } from "@/lib/is-record";
import { DEFAULT_NOTICE_SETTINGS, isNoticeSettingKey, type NoticeSettings } from "@/lib/transcript-notices";
import { migrateNoticeSettings, noticeSettingsOf } from "@/lib/transcript-notices-server";

export const dynamic = "force-dynamic";

// Settings › General's switches for pi's own `notices.*` (#1265, pi 1.6.1), in
// the global settings.json under the lock pi's SettingsManager takes. A save
// writes one key, as pi's `setNotice()` does, after pi's migration of the
// legacy `showCacheMissNotices`. A project's .pi/settings.json still
// overrides each key, as in pi.

async function readNotices(): Promise<NoticeSettings> {
  return readGlobalSettings(getGlobalSettingsPath(), (settings) => ({ ...DEFAULT_NOTICE_SETTINGS, ...noticeSettingsOf(settings) }));
}

function errorResponse(error: unknown) {
  return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json({ notices: await readNotices() });
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
  const { key, shown } = isRecord(body) ? body : {};
  if (!isNoticeSettingKey(key)) {
    return NextResponse.json({ error: "key must be one of pi's notices settings" }, { status: 400 });
  }
  if (typeof shown !== "boolean") {
    return NextResponse.json({ error: "shown must be a boolean" }, { status: 400 });
  }
  try {
    // Off with no settings file is already pi's default: nothing to create.
    if (!shown && !existsSync(getGlobalSettingsPath())) return NextResponse.json({ notices: { ...DEFAULT_NOTICE_SETTINGS } });
    await updateGlobalSettings(getGlobalSettingsPath(), (settings) => {
      migrateNoticeSettings(settings);
      settings.notices = { ...(isRecord(settings.notices) ? settings.notices : {}), [key]: shown };
    });
    return NextResponse.json({ notices: await readNotices() });
  } catch (error) {
    return errorResponse(error);
  }
}
