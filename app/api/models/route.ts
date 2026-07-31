import { stat } from "fs/promises";
import { resolve } from "path";
import { getSupportedEfforts } from "@oh-my-pi/pi-catalog/model-thinking";
import { loadModelsWithCache, withModelRuntimeError, type ModelsData } from "@/lib/models-cache";
import { resolveVisibleModels, selectInitialModelScope } from "@/lib/model-scope";
import { listModelRoles, readDefaultModelRole } from "@/lib/model-roles";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { getOmpRuntime, getSettingsForCwd } from "@/lib/omp-runtime";

export const dynamic = "force-dynamic";

const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelEntries(
  a: { id: string; name: string; provider: string },
  b: { id: string; name: string; provider: string }
): number {
  return modelNameCollator.compare(a.name || a.id, b.name || b.id)
    || modelNameCollator.compare(a.provider, b.provider)
    || modelNameCollator.compare(a.id, b.id);
}

async function loadModels(cwd: string): Promise<ModelsData> {
  const nameMap = new Map<string, string>();
  let defaultModel: { provider: string; modelId: string } | null = null;
  const thinkingLevels: Record<string, string[]> = {};

  const { modelRegistry } = await getOmpRuntime();
  const settings = await getSettingsForCwd(cwd);
  const modelError = modelRegistry.getError()?.message;
  // `enabledModels` supports globs and fuzzy patterns, so resolve it the same
  // way the CLI does instead of comparing pattern strings literally.
  const scope = await resolveVisibleModels(modelRegistry, settings.get("enabledModels"), settings);
  const { visible, thinkingLevelPins, warnings } = scope;
  const modelList = visible.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
  })).sort(compareModelEntries);
  for (const m of visible) {
    const key = `${m.provider}:${m.id}`;
    nameMap.set(key, m.name);
    thinkingLevels[key] = [...getSupportedEfforts(m)];
  }

  const defaultRole = readDefaultModelRole(settings);
  const initial = selectInitialModelScope(scope, {
    ...(defaultRole ? { defaultModel: defaultRole } : {}),
  });
  if (initial.model) {
    defaultModel = { provider: initial.model.provider, modelId: initial.model.id };
  }

  // omp assigns a model per scope of work; ship the whole role table so the
  // browser's selector can group models the same way `/model` does.
  const roles = listModelRoles(settings, [...visible]);

  return withModelRuntimeError(
    {
      models: Object.fromEntries(nameMap),
      modelList,
      defaultModel,
      thinkingLevels,
      thinkingLevelMaps: {},
      thinkingLevelPins,
      roles,
      ...(warnings.length > 0 ? { modelScopeWarnings: warnings } : {}),
    },
    modelError,
  );
}

const EMPTY_MODELS: ModelsData = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
  thinkingLevelMaps: {},
  thinkingLevelPins: {},
  roles: [],
};

export async function GET(req: Request) {
  const requestedCwd = new URL(req.url).searchParams.get("cwd") || process.cwd();
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
    return Response.json(await loadModelsWithCache(cwd, () => loadModels(cwd)));
  } catch {
    return Response.json(EMPTY_MODELS);
  }
}
