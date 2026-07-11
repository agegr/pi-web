import { NextResponse } from "next/server";
import { statSync } from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  resolveSessionPath,
  buildFullHistory,
} from "@/lib/session-reader";
import { getCachedEntries, setCachedEntries } from "@/lib/session-cache";

// GET /api/sessions/[id]/history?leafId=xxx&offset=0&limit=200
// Returns paginated full history (root → leaf) including messages before compaction.
// Used when user clicks "Show full history" in the UI.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // One stat call gives us both the freshness signal for the cache and
    // the mtime to record on the new entry. The cache returns undefined on
    // a miss or when the file has changed since the entry was written, so
    // we never serve stale entries without going back to disk.
    let fileMtime: number;
    try {
      fileMtime = statSync(filePath).mtimeMs;
    } catch {
      return NextResponse.json({ error: "Session file unreadable" }, { status: 500 });
    }

    let entries = getCachedEntries(id, fileMtime);
    if (!entries) {
      const sm = SessionManager.open(filePath);
      entries = sm.getEntries();
      setCachedEntries(id, entries, fileMtime);
    }

    const url = new URL(req.url);
    const leafId = url.searchParams.get("leafId") ?? undefined;
    const rawOffset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const rawLimit = parseInt(url.searchParams.get("limit") ?? "200", 10);
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.floor(rawLimit) : 200, 1), 500);
    const result = buildFullHistory(entries as never, leafId, offset, limit);
    return NextResponse.json({ context: result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
