import { NextResponse } from "next/server";
import { readRetrySettings, writeRetrySettings } from "@/lib/retry-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readRetrySettings());
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
    return NextResponse.json(await writeRetrySettings({
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      maxRetries: typeof body.maxRetries === "number" ? body.maxRetries : undefined,
      baseDelayMs: typeof body.baseDelayMs === "number" ? body.baseDelayMs : undefined,
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
