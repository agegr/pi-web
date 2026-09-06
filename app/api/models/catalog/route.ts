import { stat } from "fs/promises";
import { resolve } from "path";
import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { projectTrustReloadOptions } from "@/lib/project-trust";
import { resolveVisibleModels } from "@/lib/model-scope";

export const dynamic = "force-dynamic";

interface CatalogModel {
  id: string;
  name: string;
  api: string;
  reasoning: boolean;
  input: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  /** Present in the UI-visible scope (enabledModels-resolved selector list). */
  visible: boolean;
}

function serializeCost(cost: unknown): CatalogModel["cost"] | undefined {
  if (typeof cost !== "object" || cost === null) return undefined;
  const c = cost as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const serialized = {
    input: pick(c.input),
    output: pick(c.output),
    cacheRead: pick(c.cacheRead),
    cacheWrite: pick(c.cacheWrite),
  };
  return serialized.input !== undefined || serialized.output !== undefined ? serialized : undefined;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const providerId = url.searchParams.get("provider")?.trim() ?? "";
  if (!providerId) {
    return Response.json({ error: "provider is required" }, { status: 400 });
  }
  const requestedCwd = url.searchParams.get("cwd") || process.cwd();
  const cwd = resolve(requestedCwd);

  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!cwdStat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const agentDir = getAgentDir();
    // Enumerating the catalog imports repository extension factories the same
    // way /api/models does, so honor project trust here too.
    const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
    });
    const runtime = services.modelRuntime;
    if (!runtime.getProvider(providerId)) {
      return Response.json({ error: `Unknown provider: ${providerId}` }, { status: 404 });
    }

    const settings = services.settingsManager;
    const scope = await resolveVisibleModels(runtime, settings.getEnabledModels());
    const visibleKeys = new Set(scope.visible.map((m) => `${m.provider}\0${m.id}`));

    const models: CatalogModel[] = runtime.getModels(providerId)
      .map((m) => ({
        id: m.id,
        name: m.name,
        api: m.api,
        reasoning: m.reasoning === true,
        input: [...(m.input ?? [])],
        ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
        ...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
        ...(serializeCost(m.cost) ? { cost: serializeCost(m.cost) } : {}),
        visible: visibleKeys.has(`${m.provider}\0${m.id}`),
      }))
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { numeric: true, sensitivity: "base" }));

    const enabledModels = settings.getEnabledModels();
    return Response.json({
      provider: providerId,
      models,
      // Null when unset: every catalog model is visible by default, so the UI
      // must not offer an "enable" toggle (there is nothing to append to).
      enabledModels: Array.isArray(enabledModels) ? enabledModels : null,
      modelScopeWarnings: scope.warnings,
    });
  } catch {
    return Response.json({ error: "Failed to load model catalog" }, { status: 500 });
  }
}
