import { NextResponse } from "next/server";
import { attachSessionProjectInfo, getIndexedSessionInfoById } from "@/lib/session-reader";
import { getRpcSessionInfos } from "@/lib/rpc-manager";
import { createServerTiming } from "@/lib/server-timing";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const timing = createServerTiming();
  const { id } = await params;
  try {
    const runtime = getRpcSessionInfos().find((session) => session.id === id);
    const session = runtime
      ? (await timing.time("runtime-project", () => attachSessionProjectInfo([runtime])))[0] ?? null
      : await timing.time("session-meta", () => getIndexedSessionInfoById(id));
    if (!session) {
      return timing.finish(NextResponse.json(
        { error: "Session not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      ));
    }
    return timing.finish(NextResponse.json(
      { session },
      { headers: { "Cache-Control": "no-store" } },
    ));
  } catch (error) {
    return timing.finish(NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    ));
  }
}
