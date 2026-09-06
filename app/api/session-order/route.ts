import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { MAX_PINNED_SESSIONS_PER_PROJECT } from "@/lib/session-order";
import {
  readSessionOrderPreferences,
  writeProjectSessionOrder,
} from "@/lib/session-order-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(readSessionOrderPreferences(getAgentDir()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as { projectKey?: unknown; pinnedSessionIds?: unknown };
    if (typeof body.projectKey !== "string" || body.projectKey.length === 0 || body.projectKey.length > 2048) {
      return NextResponse.json({ error: "projectKey is required" }, { status: 400 });
    }
    if (!Array.isArray(body.pinnedSessionIds)
      || body.pinnedSessionIds.length > MAX_PINNED_SESSIONS_PER_PROJECT
      || body.pinnedSessionIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 256)) {
      return NextResponse.json({ error: "pinnedSessionIds must be a valid string array" }, { status: 400 });
    }

    const preferences = writeProjectSessionOrder(
      getAgentDir(),
      body.projectKey,
      body.pinnedSessionIds as string[],
    );
    return NextResponse.json(preferences, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: String(error) }, { status });
  }
}
