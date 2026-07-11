import { NextResponse } from "next/server";
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
    // Use cached entries if available and fresh
    let cached = getCachedEntries(id);
    if (!cached) {
      const sm = SessionManager.open(filePath);
      const entries = sm.getEntries() as any[];
      setCachedEntries(id, entries);
      cached = getCachedEntries(id)!;
    }
    const url = new URL(req.url);
    const leafId = url.searchParams.get("leafId") ?? undefined;
    const rawOffset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const rawLimit = parseInt(url.searchParams.get("limit") ?? "200", 10);
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.floor(rawLimit) : 200, 1), 500);
    const result = buildFullHistory(cached.entries, leafId, offset, limit);
    return NextResponse.json({ context: result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
