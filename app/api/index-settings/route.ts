import { NextResponse } from "next/server";
import { readSessionIndexSettings, writeSessionIndexSettings } from "@/lib/index-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readSessionIndexSettings());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    return NextResponse.json(await writeSessionIndexSettings({
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
