import {
  addProjectPreference,
  normalizeProjectPreferences,
  readProjectPreferences,
  reorderProjectPreferences,
  replaceProjectPreferences,
  updateProjectPreference,
} from "@/lib/project-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { projects: readProjectPreferences() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { projects?: unknown };
    const projects = await replaceProjectPreferences(body.projects);
    return Response.json({ projects });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as {
      path?: unknown;
      update?: unknown;
      project?: unknown;
      order?: unknown;
    };
    if (body.project !== undefined) {
      const project = normalizeProjectPreferences([body.project])[0];
      return Response.json({ projects: await addProjectPreference(project) });
    }
    if (body.order !== undefined) {
      if (!Array.isArray(body.order) || !body.order.every((path) => typeof path === "string")) {
        return Response.json({ error: "order must be an array of project paths" }, { status: 400 });
      }
      return Response.json({ projects: await reorderProjectPreferences(body.order) });
    }
    if (typeof body.path !== "string" || !body.update || typeof body.update !== "object" || Array.isArray(body.update)) {
      return Response.json({ error: "path and update are required" }, { status: 400 });
    }
    const candidate = body.update as Record<string, unknown>;
    const update = {
      ...(candidate.name === null ? { name: undefined } : typeof candidate.name === "string" ? { name: candidate.name } : {}),
      ...(typeof candidate.pinned === "boolean" ? { pinned: candidate.pinned } : {}),
      ...(typeof candidate.archived === "boolean" ? { archived: candidate.archived } : {}),
      ...(typeof candidate.removed === "boolean" ? { removed: candidate.removed } : {}),
    };
    return Response.json({ projects: await updateProjectPreference(body.path, update) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message === "Project not found" ? 404 : 400 });
  }
}
