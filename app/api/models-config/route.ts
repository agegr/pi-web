import { NextResponse } from "next/server";
import { ensureAllowlistSegments, pruneAllowlistProviders } from "@/lib/allowlist-backfill";
import { readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";
import { invalidateModelsCache } from "@/lib/models-cache";
import { SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { resolve } from "path";

export const dynamic = "force-dynamic";

function providerKeys(config: unknown): string[] {
  if (typeof config !== "object" || config === null) return [];
  const providers = (config as Record<string, unknown>).providers;
  if (typeof providers !== "object" || providers === null) return [];
  return Object.keys(providers);
}

function providerMap(config: unknown): Record<string, unknown> {
  if (typeof config !== "object" || config === null) return {};
  const providers = (config as Record<string, unknown>).providers;
  if (typeof providers !== "object" || providers === null) return {};
  return providers as Record<string, unknown>;
}

function modelIds(provider: unknown): string[] {
  if (typeof provider !== "object" || provider === null) return [];
  const models = (provider as Record<string, unknown>).models;
  if (!Array.isArray(models)) return [];
  return models
    .map((m) => (typeof m === "object" && m !== null && typeof (m as Record<string, unknown>).id === "string" ? (m as Record<string, unknown>).id as string : ""))
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function GET() {
  return NextResponse.json(readModelsConfig());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    // Diff provider keys/models before writing so removals and additions are
    // reflected in the enabledModels allowlist: deleted providers/models leave
    // stale entries behind (resolver warns "No models match pattern" on every
    // read), and newly added providers must not be hidden by an existing
    // allowlist. A rename is deliberately treated as remove + add: the
    // allowlist records trims per provider key, so a new key is a new provider;
    // content-based rename detection was rejected as unpredictable (a rename
    // with any concurrent edit still resets).
    const oldConfig = readModelsConfig();
    const before = providerKeys(oldConfig);
    const after = providerKeys(body);
    const removed = before.filter((p) => !after.includes(p));
    const added = after.filter((p) => !before.includes(p));

    const oldProviders = providerMap(oldConfig);
    const newProviders = providerMap(body);
    const removedModels: Record<string, string[]> = {};
    for (const p of after) {
      const beforeIds = modelIds(oldProviders[p]); // new providers have no old entry → empty
      if (beforeIds.length === 0) continue;
      const afterIds = new Set(modelIds(newProviders[p]));
      const gone = beforeIds.filter((id) => !afterIds.has(id));
      if (gone.length > 0) removedModels[p] = gone;
    }

    writeModelsConfig(body);
    invalidateModelsCache();

    if (removed.length > 0 || added.length > 0 || Object.keys(removedModels).length > 0) {
      try {
        const settings = SettingsManager.create(resolve(process.cwd()), getAgentDir());
        // One SettingsManager instance for prune + seed: both mutate its in-memory
        // state immediately, so ordering never depends on write-queue timing.
        // Prune by explicit name — no runtime, so a transient catalog hiccup can
        // never prune entries of providers that are merely temporarily unavailable.
        let changed = pruneAllowlistProviders(settings, removed, removedModels).changed;
        const ensure = ensureAllowlistSegments(settings, added); // seed p/* for genuinely new providers only
        changed = changed || ensure.changed;
        if (changed) {
          await settings.flush(); // make the write durable before responding
          invalidateModelsCache();
        }
      } catch {
        // Never fail the config save because the allowlist sync hiccapped.
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
