import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { invalidateModelsCache } from "@/lib/models-cache";
import { invalidateOmpRuntime } from "@/lib/omp-runtime";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
export const dynamic = "force-dynamic";

/**
 * Custom provider config lives in `~/.omp/agent/models.yml`.
 *
 * omp reads `models.yml` first and falls back to `models.yaml`; a legacy
 * `models.json` is migrated to YAML on first load. Read whichever exists, but
 * always write back to `models.yml` so the CLI and omp-web agree on one file.
 */
const CANONICAL_FILE = "models.yml";
const READ_CANDIDATES = ["models.yml", "models.yaml", "models.json"] as const;

function getModelsPath(): string {
  const agentDir = getAgentDir();
  for (const candidate of READ_CANDIDATES) {
    const path = join(agentDir, candidate);
    if (existsSync(path)) return path;
  }
  return join(agentDir, CANONICAL_FILE);
}

function getWritePath(): string {
  return join(getAgentDir(), CANONICAL_FILE);
}

function readModelsConfig(): Record<string, unknown> {
  const path = getModelsPath();
  if (!existsSync(path)) return { providers: {} };
  try {
    // `parse` handles JSON too — it is a subset of YAML — so a not-yet-migrated
    // `models.json` still loads.
    const parsed: unknown = parseYaml(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { providers: {} };
    return parsed as Record<string, unknown>;
  } catch {
    return { providers: {} };
  }
}

function writeModelsConfig(data: Record<string, unknown>): void {
  const path = getWritePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writePrivateFileAtomicSync(path, stringifyYaml(data, { lineWidth: 0 }));
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  return NextResponse.json(readModelsConfig());
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "models config must be an object" }, { status: 400 });
    }
    const config = body as Record<string, unknown>;
    if (
      "providers" in config
      && (typeof config.providers !== "object" || config.providers === null || Array.isArray(config.providers))
    ) {
      return NextResponse.json({ error: "providers must be an object" }, { status: 400 });
    }
    writeModelsConfig(config);
    invalidateModelsCache();
    // The registry caches models.yml at construction; drop it so the next
    // request rebuilds against the edited providers.
    invalidateOmpRuntime();
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unable to save models config" }, { status: 500 });
  }
}
