import { stat } from "fs/promises";
import { resolve } from "path";
import { createAgentSessionServices, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";
import { resolveVisibleModels } from "@/lib/model-scope";
import { sanitizeEnabledPatterns } from "@/lib/model-visibility";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { projectTrustReloadOptions } from "@/lib/project-trust";

export const dynamic = "force-dynamic";

const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

interface VisibilityModelEntry {
  id: string;
  name: string;
  provider: string;
}

async function resolveCwd(requested: string | undefined): Promise<string | Response> {
  const cwd = resolve(requested?.trim() || process.cwd());
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
  return cwd;
}

export async function GET(req: Request) {
  const requestedCwd = new URL(req.url).searchParams.get("cwd") ?? undefined;
  const cwd = await resolveCwd(requestedCwd);
  if (cwd instanceof Response) return cwd;

  try {
    const agentDir = getAgentDir();
    // Enumerating models runs a repository's .pi/extensions factories, so honor
    // project trust like /api/models does (see lib/project-trust.ts, #236).
    const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
    });
    const available = await services.modelRuntime.getAvailable();
    const models: VisibilityModelEntry[] = available
      .map((model) => ({ id: model.id, name: model.name, provider: model.provider }))
      .sort((a, b) => modelNameCollator.compare(a.name || a.id, b.name || b.id)
        || modelNameCollator.compare(a.provider, b.provider)
        || modelNameCollator.compare(a.id, b.id));
    const patterns = services.settingsManager.getEnabledModels() ?? null;
    return Response.json({
      patterns,
      models,
      ...(services.modelRuntime.getError() ? { modelError: services.modelRuntime.getError() } : {}),
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  let body: { cwd?: unknown; patterns?: unknown };
  try {
    body = await req.json() as { cwd?: unknown; patterns?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sanitized = sanitizeEnabledPatterns(body.patterns);
  if ("error" in sanitized) {
    return Response.json({ error: sanitized.error }, { status: 400 });
  }

  const requestedCwd = typeof body.cwd === "string" ? body.cwd : undefined;
  const cwd = await resolveCwd(requestedCwd);
  if (cwd instanceof Response) return cwd;

  try {
    // A scope that resolves to zero visible models makes pi fall back to
    // showing everything, silently undoing the edit — reject it instead
    // (same safety net as the scoped-models UI).
    if (sanitized.patterns) {
      const agentDir = getAgentDir();
      const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
      });
      const scope = await resolveVisibleModels(services.modelRuntime, sanitized.patterns);
      // resolveVisibleModels falls back to every available model when the
      // scope matches nothing, so the guard is the resolved scope itself.
      if (scope.scopedModels.length === 0) {
        return Response.json(
          { error: "The selection matches no available models; refusing to save an empty scope." },
          { status: 400 },
        );
      }
    }
    // enabledModels is a global setting; the cwd only selects which project
    // settings file the manager loads alongside it.
    const settings = SettingsManager.create(cwd, getAgentDir());
    settings.setEnabledModels(sanitized.patterns);
    await settings.flush();
    invalidateModelsCache();
    return Response.json({ success: true, patterns: sanitized.patterns ?? null });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
