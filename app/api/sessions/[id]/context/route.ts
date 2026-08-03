import { NextResponse } from "next/server";
import { SessionManager } from "@oh-my-pi/pi-coding-agent";
import { resolveSessionPath, buildSessionContext, getHistoricalContextUsage } from "@/lib/session-reader";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = await SessionManager.open(filePath);
    const entries = sm.getEntries() as never;
    const context = buildSessionContext(entries, leafId, {
      deferThinking,
      deferToolResultImages,
    });
    const contextUsage = await getHistoricalContextUsage(entries, leafId);

    return NextResponse.json({
      context,
      ...(contextUsage ? { contextUsage } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
