import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { searchAllSessions } from "@/lib/session-search-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  if (!query) return NextResponse.json({ results: [], hasMore: false });
  if (query.length > 200) {
    return NextResponse.json({ error: "Search query is too long" }, { status: 400 });
  }

  const requestedLimit = Number(params.get("limit") ?? 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(100, Math.trunc(requestedLimit)))
    : 50;

  try {
    const result = await searchAllSessions(query, limit);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
