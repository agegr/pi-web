import { getModelList, getDefaultModel } from "@/lib/session-reader";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const customModels = getModelList();
  const defaultModel = getDefaultModel();

  // Build name map keyed by "provider:id" to avoid cross-provider collisions
  const nameMap = new Map<string, string>();
  for (const m of customModels) nameMap.set(`${m.provider}:${m.id}`, m.name);

  let registryModels: { id: string; name: string; provider: string }[] = [];
  try {
    const authStorage = AuthStorage.create();
    const registry = new ModelRegistry(authStorage);
    const available = await registry.getAvailable();
    registryModels = available.map((m: { id: string; name: string; provider: string }) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
    }));
    for (const m of registryModels) nameMap.set(`${m.provider}:${m.id}`, m.name);
  } catch { /* use custom models only */ }

  // Union: registry models + custom models not already covered by registry
  const registryKeys = new Set(registryModels.map((m) => `${m.provider}:${m.id}`));
  const customOnly = customModels.filter((m) => !registryKeys.has(`${m.provider}:${m.id}`));
  const modelList = [...registryModels, ...customOnly];

  return Response.json({ models: Object.fromEntries(nameMap), modelList, defaultModel });
}
