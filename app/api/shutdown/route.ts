import { NextResponse } from "next/server";
import { shutdownTimer } from "@/lib/shutdown-timer";

export const dynamic = "force-dynamic";

// GET /api/shutdown - current countdown state.
export async function GET() {
  return NextResponse.json(shutdownTimer.status(), {
    headers: { "Cache-Control": "no-store" },
  });
}

// POST /api/shutdown { action: "start" | "cancel" }
export async function POST(req: Request) {
  let action: unknown;
  try {
    const body = await req.json();
    action = body?.action;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    if (action === "start") await shutdownTimer.start();
    else if (action === "cancel") await shutdownTimer.cancel();
    else return NextResponse.json({ error: "action must be start or cancel" }, { status: 400 });
  } catch (error) {
    // Do not echo command names or stderr back to clients; log server-side.
    console.error("[shutdown] action failed:", error);
    return NextResponse.json({ error: "Shutdown command failed" }, { status: 500 });
  }

  return NextResponse.json(shutdownTimer.status());
}
