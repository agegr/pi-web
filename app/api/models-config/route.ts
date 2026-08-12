import { NextResponse } from "next/server";
import { readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";
import { refreshRpcSessionModelConfigs } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(readModelsConfig());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    writeModelsConfig(body);
    // Live AgentSessions snapshot models.json at creation; reload their
    // ModelRuntime so header/provider edits take effect immediately
    // instead of after a restart or the idle-timeout teardown.
    await refreshRpcSessionModelConfigs();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
