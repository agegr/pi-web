import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { openSessionManager, resolveSessionPath } from "@/lib/session-reader";
import type { CustomEntry } from "@/lib/types";

// Custom entries across the whole session, in append order, not a projected chat branch.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const searchParams = new URL(req.url).searchParams;
  const customTypes = new Set(searchParams.getAll("customType"));
  const after = searchParams.get("after");
  const limit = Number(searchParams.get("limit") ?? 100);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    return NextResponse.json({ error: "limit must be an integer between 1 and 1000" }, { status: 400 });
  }
  if (customTypes.has("") || after === "") {
    return NextResponse.json({ error: "customType and after must not be empty" }, { status: 400 });
  }

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? openSessionManager(filePath!);
    const entries = sm.getEntries();
    const afterIndex = after === null ? -1 : entries.findIndex((entry) => entry.id === after);
    if (after !== null && afterIndex === -1) {
      return NextResponse.json({ error: "Unknown after entry ID" }, { status: 400 });
    }

    const page: CustomEntry[] = [];
    let nextAfter = after;
    let hasMore = false;
    for (let index = afterIndex + 1; index < entries.length; index++) {
      const entry = entries[index];
      if (entry.type === "custom" && (customTypes.size === 0 || customTypes.has(entry.customType))) {
        if (page.length === limit) {
          hasMore = true;
          break;
        }
        page.push(entry);
      }
      // Advance through unmatched entries too, so catch-up need not scan them again.
      nextAfter = entry.id;
    }

    return NextResponse.json({
      entries: page,
      leafId: sm.getLeafId(),
      nextAfter,
      hasMore,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
