import { NextResponse } from "next/server";
import { ModelsConfigReadError, readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";
import { ContextWindowError, normalizeContextWindowOverrides } from "@/lib/model-context";
import { checkProviderEntries, ProviderEntryError } from "@/lib/model-provider-check";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(readModelsConfig());
  } catch (error) {
    if (error instanceof ModelsConfigReadError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const config = normalizeContextWindowOverrides(body);
    checkProviderEntries(config);
    writeModelsConfig(config);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ContextWindowError || error instanceof ProviderEntryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ModelsConfigReadError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
