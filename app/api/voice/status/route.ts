import { NextResponse } from "next/server";
import { getVoiceStatus } from "@/lib/voice-engine";

export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await getVoiceStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
