import { NextResponse } from "next/server";
import { buildFullIndex, incrementallyIndexSessionFile, enumerateSessionFiles } from "@/lib/session-index-builder";
import { readSessionIndexSettings } from "@/lib/index-settings";
import { getIndexStats } from "@/lib/session-index";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await readSessionIndexSettings();
    const stats = settings.enabled ? getIndexStats() : { sessions: 0, entries: 0, dbSizeBytes: 0 };
    return NextResponse.json({ enabled: settings.enabled, ...stats });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const settings = await readSessionIndexSettings();
    if (!settings.enabled) {
      return NextResponse.json({ error: "Session index is disabled" }, { status: 400 });
    }

    const body = await req.json() as Record<string, unknown>;
    const mode = typeof body.mode === "string" ? body.mode : "full";

    if (mode === "incremental") {
      const files = enumerateSessionFiles();
      let totalIndexed = 0;
      for (const file of files) {
        try {
          const result = await incrementallyIndexSessionFile(file);
          totalIndexed += result.indexedLines;
        } catch {
          // Skip unreadable files
        }
      }
      const stats = getIndexStats();
      return NextResponse.json({ mode: "incremental", indexedLines: totalIndexed, ...stats });
    }

    const result = await buildFullIndex();
    const stats = getIndexStats();
    return NextResponse.json({ mode: "full", ...result, ...stats });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
