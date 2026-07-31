import { NextResponse } from "next/server";
import { PluginManager } from "@oh-my-pi/pi-coding-agent/extensibility/plugins";
import type { InstalledPlugin } from "@oh-my-pi/pi-coding-agent/extensibility/plugins";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import type {
  PluginDiagnostic,
  PluginPackageInfo,
  PluginResourceCounts,
  PluginResourceInfo,
  PluginScope,
  PluginsResponse,
} from "@/lib/api-types";

export const dynamic = "force-dynamic";

type PluginAction = "install" | "remove" | "update" | "disable" | "enable";

function emptyCounts(): PluginResourceCounts {
  return { extensions: 0, skills: 0, prompts: 0, themes: 0 };
}

/**
 * Effective feature list for a plugin.
 *
 * `enabledFeatures === null` means "manifest defaults", i.e. every feature
 * declared with `default: true`.
 */
function effectiveFeatures(plugin: InstalledPlugin): string[] {
  if (plugin.enabledFeatures) return plugin.enabledFeatures;
  return Object.entries(plugin.manifest.features ?? {})
    .filter(([, feature]) => feature.default)
    .map(([name]) => name);
}

/**
 * Entry points a plugin contributes, flattened into the panel's resource rows.
 *
 * omp plugins expose extensions, tools, hooks, and command files; the panel's
 * four counters were modelled on pi's package layout, so tools and hooks are
 * reported under `extensions` (they are all code the session loads) and command
 * files under `prompts` (they are all `/`-invocable text).
 */
function collectResources(plugin: InstalledPlugin): {
  counts: PluginResourceCounts;
  resources: PluginResourceInfo[];
} {
  const counts = emptyCounts();
  const resources: PluginResourceInfo[] = [];
  const features = new Set(effectiveFeatures(plugin));
  const manifest = plugin.manifest;

  const push = (kind: PluginResourceInfo["kind"], relativePath: string, countKey: keyof PluginResourceCounts) => {
    counts[countKey] += 1;
    resources.push({
      kind,
      name: relativePath.replace(/\.[cm]?[jt]s$/, "").replace(/^\.\//, ""),
      path: `${plugin.path}/${relativePath}`,
      relativePath,
    });
  };

  for (const entry of manifest.extensions ?? []) push("extension", entry, "extensions");
  if (manifest.tools) push("extension", manifest.tools, "extensions");
  if (manifest.hooks) push("extension", manifest.hooks, "extensions");
  for (const entry of manifest.commands ?? []) push("prompt", entry, "prompts");

  for (const [name, feature] of Object.entries(manifest.features ?? {})) {
    if (!features.has(name)) continue;
    for (const entry of feature.extensions ?? []) push("extension", entry, "extensions");
    for (const entry of feature.tools ?? []) push("extension", entry, "extensions");
    for (const entry of feature.hooks ?? []) push("extension", entry, "extensions");
    for (const entry of feature.commands ?? []) push("prompt", entry, "prompts");
  }

  return { counts, resources };
}

function addCounts(totals: PluginResourceCounts, counts: PluginResourceCounts): void {
  totals.extensions += counts.extensions;
  totals.skills += counts.skills;
  totals.prompts += counts.prompts;
  totals.themes += counts.themes;
}

async function readPlugins(cwd: string): Promise<PluginsResponse> {
  const manager = new PluginManager(cwd);
  const diagnostics: PluginDiagnostic[] = [];
  const totals = emptyCounts();
  let packages: PluginPackageInfo[] = [];

  try {
    const installed = await manager.list();
    packages = installed.map((plugin) => {
      const { counts, resources } = collectResources(plugin);
      addCounts(totals, counts);
      const resourceCount = counts.extensions + counts.skills + counts.prompts + counts.themes;
      return {
        source: plugin.name,
        // omp installs plugins into one shared tree; project scoping happens
        // through `.omp/plugin-overrides.json`, not through separate installs.
        scope: "global" as PluginScope,
        filtered: plugin.enabledFeatures !== null,
        disabled: !plugin.enabled,
        installedPath: plugin.path,
        packageName: plugin.name,
        version: plugin.version,
        configuredVersion: plugin.manifest.version,
        counts,
        resources,
        status: !plugin.enabled ? "disabled" : resourceCount > 0 ? "loaded" : "installed",
      } satisfies PluginPackageInfo;
    });
  } catch (error) {
    diagnostics.push({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    for (const check of await manager.doctor()) {
      if (check.status === "ok") continue;
      diagnostics.push({
        type: check.status === "error" ? "error" : "warning",
        message: check.message ?? check.name,
      });
    }
  } catch {
    // Health checks are advisory; a doctor failure must not empty the list.
  }

  return { packages, totals, diagnostics, projectResourcesLoaded: true };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json(await readPlugins(cwd));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/plugins body: { action, source?, cwd }
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as {
      action?: PluginAction;
      source?: string;
      cwd?: string;
    };
    if (!body.cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!body.action) return NextResponse.json({ error: "action required" }, { status: 400 });
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(body.cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const manager = new PluginManager(body.cwd);
    const source = body.source?.trim();

    if (body.action === "install") {
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      await manager.install(source);
    } else if (body.action === "remove") {
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      await manager.uninstall(source);
    } else if (body.action === "update") {
      // omp has no in-place update: reinstalling the same spec re-resolves it.
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      await manager.install(source, { force: true });
    } else if (body.action === "disable" || body.action === "enable") {
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      await manager.setEnabled(source, body.action === "enable");
    } else {
      return NextResponse.json({ error: `Unsupported action: ${body.action}` }, { status: 400 });
    }

    return NextResponse.json(await readPlugins(body.cwd));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
