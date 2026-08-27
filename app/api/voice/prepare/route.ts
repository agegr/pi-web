import { NextResponse } from "next/server";
import { ensureVoiceModel } from "@/lib/voice-engine";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  try {
    const status = await ensureVoiceModel();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
