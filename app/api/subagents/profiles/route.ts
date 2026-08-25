import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import {
  deleteSubagentProfile,
  listSubagentProfileSources,
  saveSubagentProfile,
  type SubagentProfile,
  type SubagentWritableScope,
} from "@/lib/subagents";

export const dynamic = "force-dynamic";

async function validateCwd(cwd: unknown): Promise<string> {
  if (typeof cwd !== "string" || !cwd || !existsSync(cwd)) throw new Error("Valid cwd required");
  if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) throw new Error("Access denied");
  return cwd;
}

function validateScope(scope: unknown): SubagentWritableScope {
  if (scope !== "global" && scope !== "project") throw new Error("scope must be global or project");
  return scope;
}

export async function GET(req: Request) {
  try {
    const cwd = await validateCwd(new URL(req.url).searchParams.get("cwd"));
    return NextResponse.json({ profiles: listSubagentProfileSources(cwd) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as {
      cwd?: unknown;
      scope?: unknown;
      profile?: Omit<SubagentProfile, "scope" | "filePath">;
    };
    const cwd = await validateCwd(body.cwd);
    const scope = validateScope(body.scope);
    if (!body.profile || typeof body.profile.name !== "string") {
      return NextResponse.json({ error: "profile required" }, { status: 400 });
    }
    return NextResponse.json({ profile: saveSubagentProfile(cwd, scope, body.profile) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; scope?: unknown; name?: unknown; enabled?: unknown };
    const cwd = await validateCwd(body.cwd);
    const scope = validateScope(body.scope);
    if (typeof body.name !== "string") return NextResponse.json({ error: "name required" }, { status: 400 });
    if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled required" }, { status: 400 });
    const name = body.name;
    const source = listSubagentProfileSources(cwd).find((profile) =>
      profile.scope === scope && profile.name.toLowerCase() === name.toLowerCase()
    );
    if (!source) return NextResponse.json({ error: "Agent profile not found" }, { status: 404 });
    const profile: Omit<SubagentProfile, "scope" | "filePath"> = {
      name: source.name,
      displayName: source.displayName,
      description: source.description,
      systemPrompt: source.systemPrompt,
      tools: source.tools,
      loadSkills: source.loadSkills,
      loadExtensions: source.loadExtensions,
      model: source.model,
      thinking: source.thinking,
      maxTurns: source.maxTurns,
      inheritContext: source.inheritContext,
      runInBackground: source.runInBackground,
      enabled: source.enabled,
    };
    return NextResponse.json({ profile: saveSubagentProfile(cwd, scope, { ...profile, enabled: body.enabled }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; scope?: unknown; name?: unknown };
    const cwd = await validateCwd(body.cwd);
    const scope = validateScope(body.scope);
    if (typeof body.name !== "string") return NextResponse.json({ error: "name required" }, { status: 400 });
    deleteSubagentProfile(cwd, scope, body.name);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 });
  }
}
