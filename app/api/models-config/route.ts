import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";

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
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

interface ModelDef {
  id?: unknown;
  name?: unknown;
  api?: unknown;
  baseUrl?: unknown;
}

function validateProviderModels(providerId: string, models: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(models)) return errors;
  for (let i = 0; i < models.length; i++) {
    const m = models[i] as ModelDef | undefined;
    if (!m || typeof m !== "object") {
      errors.push(`Provider "${providerId}", model #${i + 1}: must be an object`);
      continue;
    }
    if (typeof m.id !== "string" || m.id.trim().length === 0) {
      errors.push(`Provider "${providerId}", model #${i + 1}: "id" must be a non-empty string`);
    }
  }
  return errors;
}

function validateModelsJson(body: unknown): string[] {
  const errors: string[] = [];
  const root = body as Record<string, unknown> | undefined;
  if (!root || typeof root !== "object") {
    errors.push("Root must be an object with a \"providers\" field");
    return errors;
  }
  const providers = root.providers;
  if (!providers || typeof providers !== "object") {
    errors.push("Missing or invalid \"providers\" field");
    return errors;
  }
  for (const [providerId, provider] of Object.entries(providers)) {
    if (!provider || typeof provider !== "object") {
      errors.push(`Provider "${providerId}": must be an object`);
      continue;
    }
    const p = provider as Record<string, unknown>;
    errors.push(...validateProviderModels(providerId, p.models));
  }
  return errors;
}

export async function GET() {
  return NextResponse.json(readModelsJson());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;

    const errors = validateModelsJson(body);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join("\n") }, { status: 400 });
    }

    writeModelsJson(body);
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
