import { stat } from "fs/promises";
import { resolve } from "path";
import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";
import { resolveVisibleModels } from "@/lib/model-scope";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { projectTrustReloadOptions } from "@/lib/project-trust";

export const dynamic = "force-dynamic";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const PROVIDER_PART = "[A-Za-z0-9_.-]+";

type ParsedEntry =
  | { kind: "exact" | "level"; provider: string; modelId: string; level?: string; raw: string }
  | { kind: "provider-glob"; provider: string; raw: string };

function parseEntry(raw: string): ParsedEntry | null {
  let m = raw.match(new RegExp(`^(${PROVIDER_PART})/\\*$`));
  if (m) return { kind: "provider-glob", provider: m[1], raw };
  m = raw.match(new RegExp(`^(${PROVIDER_PART})/([^:*]+)(?::([a-z]+))?$`));
  if (m) {
    const level = m[3];
    if (level && !THINKING_LEVELS.has(level)) return null;
    return { kind: level ? "level" : "exact", provider: m[1], modelId: m[2], ...(level ? { level } : {}), raw };
  }
  return null;
}

/** Drop every entry attributable to `providerId`, keep everything else verbatim. */
function rewriteSegment(current: string[], providerId: string, warnings: string[]): string[] {
  const kept: string[] = [];
  for (const entry of current) {
    const parsed = parseEntry(entry);
    if (!parsed) {
      kept.push(entry);
      warnings.push(`kept unparsable pattern: ${entry}`);
      continue;
    }
    if (parsed.provider !== providerId) kept.push(entry);
  }
  return kept;
}

/**
 * Structured allowlist management. `enabledModels` is one global array shared
 * by every provider, so a naive "write the selected models" would hide every
 * other provider. Instead each action rewrites only the target provider's
 * segment and preserves the rest verbatim; a flip from the allow-all default
 * seeds `provider/*` for every other configured provider.
 */
export async function PUT(req: Request) {
  let cwd: string;
  let action: string;
  let providerId: string;
  let models: string[] | null;
  try {
    const body = await req.json() as {
      cwd?: unknown; action?: unknown; providerId?: unknown; models?: unknown;
    };
    cwd = resolve(typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : process.cwd());
    action = typeof body.action === "string" ? body.action : "";
    providerId = typeof body.providerId === "string" ? body.providerId.trim() : "";
    models = Array.isArray(body.models)
      ? body.models.filter((m): m is string => typeof m === "string" && /^([^:*]+)$/.test(m.trim()) && m.trim() !== "")
        .map((m) => m.trim())
      : null;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!["trim", "reset-provider", "clear"].includes(action)) {
    return Response.json({ error: `Unknown action: ${action || "(empty)"}` }, { status: 400 });
  }
  if (action !== "clear" && !providerId) {
    return Response.json({ error: "providerId is required for this action" }, { status: 400 });
  }
  if (action === "trim" && models === null) {
    return Response.json({ error: "models must be a string array for trim" }, { status: 400 });
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
    const runtime = services.modelRuntime;
    const settings = services.settingsManager;
    const current = settings.getEnabledModels();
    const wasEmpty = !Array.isArray(current) || current.length === 0;
    const warnings: string[] = [];

    let next: string[];
    if (action === "clear") {
      next = [];
    } else if (action === "reset-provider") {
      if (wasEmpty) {
        return Response.json({ ok: true, enabledModels: current ?? [], noop: true, warnings });
      }
      next = rewriteSegment(current as string[], providerId, warnings);
      if (!next.includes(`${providerId}/*`)) next.push(`${providerId}/*`);
    } else {
      // trim
      const selected = models as string[];
      if (wasEmpty) {
        // Flip from allow-all: keep every other configured provider fully visible.
        const available = await runtime.getAvailable();
        const others = [...new Set(available.map((m) => m.provider))].filter((p) => p !== providerId);
        next = others.map((p) => `${p}/*`);
        if (others.length > 0) warnings.push(`kept ${others.length} other provider(s) fully visible via provider/*`);
      } else {
        next = rewriteSegment(current as string[], providerId, warnings);
      }
      // Preserve thinking-level pins whose model survives the trim.
      if (!wasEmpty && Array.isArray(current)) {
        for (const entry of current as string[]) {
          const parsed = parseEntry(entry);
          if (parsed?.kind === "level" && parsed.provider === providerId && parsed.modelId && selected.includes(parsed.modelId)) {
            next.push(entry);
          }
        }
      }
      for (const id of selected) next.push(`${providerId}/${id}`);
    }

    next = [...new Set(next)];

    // Resolve before writing: a typo'd/empty result would silently fall back to
    // "everything visible" in the resolver, undoing the trim.
    const scope = await resolveVisibleModels(runtime, next);
    if (scope.visible.length === 0) {
      return Response.json(
        { error: "Resolved to 0 models; refusing to write (resolver would fall back to showing everything)", warnings: scope.warnings },
        { status: 400 },
      );
    }
    settings.setEnabledModels(next);
    invalidateModelsCache();

    const preview: Record<string, number> = {};
    for (const m of scope.visible) preview[m.provider] = (preview[m.provider] ?? 0) + 1;
    return Response.json({
      ok: true,
      enabledModels: next,
      preview,
      warnings: [...warnings, ...scope.warnings],
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update enabledModels" },
      { status: 500 },
    );
  }
}

/**
 * Append a single exact `provider/modelId` entry to the global allowlist.
 * Append-only: removing entries goes through the structured PUT actions.
 */
export async function POST(req: Request) {
  let cwd: string;
  let add: string;
  try {
    const body = await req.json() as { cwd?: unknown; add?: unknown };
    cwd = resolve(typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : process.cwd());
    add = typeof body.add === "string" ? body.add.trim() : "";
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!add || !add.includes("/")) {
    return Response.json({ error: `add must be a fully-qualified provider/modelId, got: ${add || "(empty)"}` }, { status: 400 });
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
    const settings = services.settingsManager;
    const current = settings.getEnabledModels() ?? [];
    if (current.includes(add)) {
      return Response.json({ ok: true, enabledModels: current });
    }
    const next = [...current, add];
    settings.setEnabledModels(next);
    invalidateModelsCache();
    return Response.json({ ok: true, enabledModels: next });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update enabledModels" },
      { status: 500 },
    );
  }
}
