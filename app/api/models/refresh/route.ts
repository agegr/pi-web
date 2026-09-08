import { stat } from "fs/promises";
import { resolve } from "path";
import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";
import { syncAllowlist, ensureAllowlistSegments } from "@/lib/allowlist-backfill";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { projectTrustReloadOptions } from "@/lib/project-trust";

export const dynamic = "force-dynamic";

// Mirror pi CLI's interactive catalog refresh budget (refreshModelCatalogs).
const REFRESH_TIMEOUT_MS = 15_000;

export async function POST(req: Request) {
  let cwd: string;
  try {
    const body = await req.json() as { cwd?: unknown };
    cwd = resolve(typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : process.cwd());
  } catch {
    cwd = resolve(process.cwd());
  }

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
    const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
    });

    // Providers configured before the refresh, used after it to seed only the
    // genuinely NEW providers (a global backfill would silently revive providers
    // the user trimmed to zero models — see ensureAllowlistSegments).
    const beforeProviders = new Set((await services.modelRuntime.getAvailable()).map((m) => m.provider));

    // Explicit user action: allow the pi.dev remote catalog to be fetched with
    // `force` so the 4h freshness window is bypassed, like pi's own refresh.
    const result = await services.modelRuntime.refresh({
      allowNetwork: true,
      force: true,
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });

    // Persisted catalogs changed on disk; drop the in-memory models cache so
    // the next /api/models read rebuilds from the refreshed store.
    invalidateModelsCache();

    // A remote refresh may reveal models of providers that have no allowlist
    // segment yet (seed the genuinely new ones), and may drop providers that
    // no longer exist (prune removes their stale entries).
    let sync: { changed: boolean; added: string[]; removed: string[]; warning?: string } = { changed: false, added: [], removed: [] };
    try {
      const prune = await syncAllowlist(services.modelRuntime, services.settingsManager, AbortSignal.timeout(8_000), {
        // A provider whose refresh just errored is temporarily missing from
        // the available list — that is not a removal, keep its entries.
        keepProviders: [...result.errors.keys()],
      });
      const afterProviders = new Set((await services.modelRuntime.getAvailable()).map((m) => m.provider));
      const ensure = ensureAllowlistSegments(services.settingsManager, [...afterProviders].filter((p) => !beforeProviders.has(p)));
      sync = {
        changed: prune.changed || ensure.changed,
        added: ensure.added,
        removed: prune.removed,
        ...(prune.warning ? { warning: prune.warning } : {}),
      };
      if (sync.changed) {
        await services.settingsManager.flush();
        invalidateModelsCache();
      }
    } catch {
      // Never fail the refresh because the allowlist sync hiccapped.
    }

    const errors: { provider: string; error: string }[] = [];
    for (const [provider, error] of result.errors) {
      errors.push({ provider, error: error instanceof Error ? error.message : String(error) });
    }
    return Response.json({
      ok: !result.aborted,
      ...(result.aborted ? { aborted: true } : {}),
      sync,
      errors,
    });
  } catch (error) {
    invalidateModelsCache();
    const message = error instanceof Error ? error.message : String(error);
    const aborted = /abort/i.test(message);
    return Response.json(
      { ok: false, errors: [{ provider: "*", error: aborted ? "Refresh timed out" : message }] },
      { status: aborted ? 504 : 500 },
    );
  }
}
