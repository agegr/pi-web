import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  readPiWebSettings,
  writeAutoSessionTitleEnabled,
} from "@/lib/auto-title-settings";

export const dynamic = "force-dynamic";

// GET /api/sessions/settings - current automatic session title preference
export async function GET() {
  try {
    return NextResponse.json({ autoSessionTitle: readPiWebSettings().autoSessionTitle });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

// PUT /api/sessions/settings - update the automatic session title preference
export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    return NextResponse.json({
      autoSessionTitle: writeAutoSessionTitleEnabled(body.enabled).autoSessionTitle,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
