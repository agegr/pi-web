import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  readSessionTitleModel,
  writeSessionTitleModel,
} from "@/lib/session-title-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      model: await readSessionTitleModel(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = (await req.json()) as { model?: unknown };
    if (typeof body.model !== "string") {
      return NextResponse.json({ error: "model must be a string" }, { status: 400 });
    }
    const saved = await writeSessionTitleModel(body.model);
    return NextResponse.json({ model: saved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
