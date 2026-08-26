import { NextRequest, NextResponse } from "next/server";
import {
  parseSessionSearchQuery,
  searchSessionContents,
} from "@/lib/session-search";

export const dynamic = "force-dynamic";

// GET /api/sessions/search?q=text[&mode=substring|words|regex][&case=1]
//   [&roles=user,assistant,...][&projectKey=<key>][&limit=20][&hits=3]
//
// Returns { results, totalMatches, stats }. An empty q returns an empty result
// set rather than an error so the UI can clear without special-casing.
export async function GET(req: NextRequest) {
  const query = parseSessionSearchQuery(req.nextUrl.searchParams);

  try {
    const response = await searchSessionContents({ ...query, signal: req.signal });
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // An invalid user-supplied regex is a client error, not a server fault.
    if (query.mode === "regex" && error instanceof SyntaxError) {
      return NextResponse.json(
        { error: `Invalid regular expression: ${error.message}` },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
