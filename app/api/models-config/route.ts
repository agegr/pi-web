import { NextResponse } from "next/server";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { pruneRemovedEnabledModels } from "@/lib/enabled-model-pruning";
import { invalidateModelsCache } from "@/lib/models-cache";
import { readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(readModelsConfig());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const previousConfig = readModelsConfig();
    const nextConfig = writeModelsConfig(body);
    const settings = SettingsManager.create(process.cwd(), getAgentDir());
    const prunedEnabledModels = await pruneRemovedEnabledModels(
      settings,
      previousConfig,
      nextConfig,
    );
    if (prunedEnabledModels > 0) invalidateModelsCache();
    return NextResponse.json({ success: true, prunedEnabledModels });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
