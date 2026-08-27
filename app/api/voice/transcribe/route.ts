import { NextResponse } from "next/server";
import { transcribeWav } from "@/lib/voice-engine";
import type { VoiceLang } from "@/lib/wav-pcm";

export const runtime = "nodejs";
export const maxDuration = 60;

const LANGS = new Set<VoiceLang>(["auto", "zh", "en"]);

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const langRaw = url.searchParams.get("lang") ?? "auto";
    const lang: VoiceLang = LANGS.has(langRaw as VoiceLang) ? langRaw as VoiceLang : "auto";
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength < 100) {
      return NextResponse.json({ error: "Empty audio" }, { status: 400 });
    }
    if (bytes.byteLength > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "Audio is too large" }, { status: 413 });
    }
    const text = await transcribeWav(bytes, lang);
    return NextResponse.json({ text, engine: "sensevoice", lang });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
