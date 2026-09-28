import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { projectTrustReloadOptions } from "@/lib/project-trust";
import { CODING_TOOL_NAMES } from "@/lib/subagents";
import type { SubagentToolInfo } from "@/lib/api-types";

export const dynamic = "force-dynamic";

interface CachedTools {
  expiresAt: number;
  tools: SubagentToolInfo[];
}

/** Keep the editor snappy without re-loading extensions on every open. */
const TOOLS_CACHE_TTL_MS = 60_000;
/** Bound the cache: Map preserves insertion order, so the oldest cwd is first. */
const TOOLS_CACHE_MAX_ENTRIES = 32;
const toolsCache = new Map<string, CachedTools>();

function cacheTools(cwd: string, tools: SubagentToolInfo[]): void {
  // Re-insert on refresh so the newest cwd moves to the end of the eviction order.
  toolsCache.delete(cwd);
  toolsCache.set(cwd, { expiresAt: Date.now() + TOOLS_CACHE_TTL_MS, tools });
  while (toolsCache.size > TOOLS_CACHE_MAX_ENTRIES) {
    const oldest = toolsCache.keys().next().value;
    if (oldest === undefined) break;
    toolsCache.delete(oldest);
  }
}

async function validateCwd(cwd: unknown): Promise<string> {
  if (typeof cwd !== "string" || !cwd || !existsSync(cwd)) throw new Error("Valid cwd required");
  if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) throw new Error("Access denied");
  return cwd;
}

/**
 * Every tool a child session can be allowed: the builtin coding set plus the
 * tools registered by loaded extensions. The complete runtime registry only
 * exists inside a live session, but extension tools are registered at load
 * time, so loading the same services `/api/models` uses already enumerates
 * them without starting a session or writing a session file.
 */
async function listTools(cwd: string): Promise<SubagentToolInfo[]> {
  const agentDir = getAgentDir();
  const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
  });
  const builtin = CODING_TOOL_NAMES
    .filter((name) => name !== "powershell" || process.platform === "win32")
    .map((name): SubagentToolInfo => ({ name, source: "builtin" }));
  const seen = new Set(builtin.map((tool) => tool.name));
  const extensionTools: SubagentToolInfo[] = [];
  for (const extension of services.resourceLoader.getExtensions().extensions) {
    for (const { definition } of extension.tools.values()) {
      if (seen.has(definition.name)) continue;
      seen.add(definition.name);
      extensionTools.push({
        name: definition.name,
        ...(definition.description ? { description: definition.description } : {}),
        source: "extension",
      });
    }
  }
  extensionTools.sort((a, b) => a.name.localeCompare(b.name));
  return [...builtin, ...extensionTools];
}

export async function GET(req: Request) {
  try {
    const cwd = await validateCwd(new URL(req.url).searchParams.get("cwd"));
    const cached = toolsCache.get(cwd);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ tools: cached.tools });
    }
    const tools = await listTools(cwd);
    cacheTools(cwd, tools);
    return NextResponse.json({ tools });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 });
  }
}
