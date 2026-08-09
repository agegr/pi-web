import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getModelsUiPath, normalizeDisabledProviders, readModelsUiState } from "@/lib/provider-availability";

export const dynamic = "force-dynamic";

function getModelsPath(): string {
  return join(getAgentDir(), "models.json");
}

function readModelsJson(): Record<string, unknown> {
  const path = getModelsPath();
  if (!existsSync(path)) return { providers: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return { providers: {} };
  }
}

function writeModelsJson(data: Record<string, unknown>): void {
  const path = getModelsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writePrivateFileAtomicSync(path, JSON.stringify(data, null, 2));
}

function writeModelsUiState(disabledProviders: string[]): void {
  const path = getModelsUiPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writePrivateFileAtomicSync(path, JSON.stringify({ disabledProviders }, null, 2));
}

export async function GET() {
  return NextResponse.json({
    ...readModelsJson(),
    disabledProviders: readModelsUiState().disabledProviders,
  });
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const disabledProviders = normalizeDisabledProviders(body.disabledProviders);
    const modelsConfig = { ...body };
    delete modelsConfig.disabledProviders;
    writeModelsJson(modelsConfig);
    writeModelsUiState(disabledProviders);
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
