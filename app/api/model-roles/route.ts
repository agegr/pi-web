import { NextResponse } from "next/server";
import { resolve } from "path";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { getOmpRuntime, getSettingsForCwd } from "@/lib/omp-runtime";
import { listModelRoles, writeModelRole, type ModelRoleScope } from "@/lib/model-roles";
import { resolveVisibleModels } from "@/lib/model-scope";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

async function requireAllowedCwd(rawCwd: string | null): Promise<{ cwd: string } | { error: NextResponse }> {
  if (!rawCwd) return { error: NextResponse.json({ error: "cwd required" }, { status: 400 }) };
  const cwd = resolve(rawCwd);
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return { error: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
  }
  return { cwd };
}

// GET /api/model-roles?cwd=<path> — every role omp knows, with its assignment.
export async function GET(req: Request) {
  const result = await requireAllowedCwd(new URL(req.url).searchParams.get("cwd"));
  if ("error" in result) return result.error;

  try {
    const { modelRegistry } = await getOmpRuntime();
    const settings = await getSettingsForCwd(result.cwd);
    const { visible } = await resolveVisibleModels(modelRegistry, settings.get("enabledModels"), settings);
    return NextResponse.json({ roles: listModelRoles(settings, [...visible]) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

/**
 * PUT /api/model-roles  body: { cwd, role, selector, scope }
 *
 * `selector` is omp's own model-role syntax — `provider/modelId` with an
 * optional `:thinkingLevel` suffix — so a value written here reads back
 * identically in `omp`'s `/model` selector. `selector: null` clears the role at
 * that layer and lets the next layer down take over.
 */
export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as {
      cwd?: string;
      role?: string;
      selector?: string | null;
      scope?: ModelRoleScope;
    };
    const result = await requireAllowedCwd(body.cwd ?? null);
    if ("error" in result) return result.error;

    const role = body.role?.trim();
    if (!role) return NextResponse.json({ error: "role required" }, { status: 400 });
    const scope: ModelRoleScope = body.scope === "project" ? "project" : "global";
    const selector = typeof body.selector === "string" ? body.selector.trim() : undefined;

    const { modelRegistry } = await getOmpRuntime();
    const settings = await getSettingsForCwd(result.cwd);
    writeModelRole(settings, role, selector || undefined, scope);
    await settings.flush();
    invalidateModelsCache();

    const { visible } = await resolveVisibleModels(modelRegistry, settings.get("enabledModels"), settings);
    return NextResponse.json({ roles: listModelRoles(settings, [...visible]) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
