import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SkillToggleResult } from "@/lib/api-types";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { setDisableModelInvocation } from "@/lib/skill-frontmatter";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";

export const dynamic = "force-dynamic";

// GET /api/skills?cwd=<path>
// Uses DefaultResourceLoader (same logic as AgentSession startup) so settings.json
// skill paths, package skills, and .agents/skills directories are all included.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json(await loadSkillsWithInstallInfo(cwd));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

async function getSkillEditRoots(): Promise<Set<string>> {
  const allowedRoots = new Set(await getAllowedFileRoots());
  allowedRoots.add(getAgentDir());
  // Globally installed skills live in ~/.agents/skills and are symlinked into
  // the agent's skills dir; isExistingFilePathAllowed resolves the symlink, so
  // the real target sits outside getAgentDir(). Allow the global skills root
  // too (the SDK always treats ~/.agents/skills as trusted).
  const globalSkillsDir = path.join(homedir(), ".agents", "skills");
  if (existsSync(globalSkillsDir)) allowedRoots.add(globalSkillsDir);
  return allowedRoots;
}

/** Edits one SKILL.md, or returns the status and message that refused it. */
function toggleSkillFile(
  filePath: string,
  disableModelInvocation: boolean,
  allowedRoots: Set<string>,
): { status: number; error: string } | null {
  // Skills are SKILL.md or *.md files. The allowed roots also hold settings,
  // auth.json and project files, whose top a frontmatter edit would break.
  if (path.extname(filePath).toLowerCase() !== ".md") return { status: 400, error: "Not a skill file" };
  if (!existsSync(filePath)) return { status: 404, error: "file not found" };
  if (!isExistingFilePathAllowed(filePath, allowedRoots)) {
    return { status: 403, error: "Access denied" };
  }
  const content = readFileSync(filePath, "utf8");
  const updated = setDisableModelInvocation(content, disableModelInvocation);
  // A skill already in the requested state keeps its file and mtime.
  if (updated !== content) writeFileSync(filePath, updated, "utf8");
  return null;
}

// PATCH /api/skills — toggle disable-model-invocation on SKILL.md files.
// Body: { filePath, disableModelInvocation } for one skill, or
// { filePaths, disableModelInvocation } for the panel's "Enable all" /
// "Disable all". A batch edits each file on its own and reports every one, so
// a skill the route refuses does not stop the rest.
export async function PATCH(req: Request) {
  try {
    const body = await req.json() as {
      filePath?: string;
      filePaths?: unknown;
      disableModelInvocation: boolean;
    };
    const { filePath, filePaths, disableModelInvocation } = body;

    if (filePaths !== undefined) {
      if (!Array.isArray(filePaths) || !filePaths.every((item) => typeof item === "string" && item)) {
        return NextResponse.json({ error: "filePaths must be a list of paths" }, { status: 400 });
      }
      if (typeof disableModelInvocation !== "boolean") {
        return NextResponse.json({ error: "disableModelInvocation must be a boolean" }, { status: 400 });
      }
      const allowedRoots = await getSkillEditRoots();
      const results: SkillToggleResult[] = [];
      for (const target of new Set(filePaths as string[])) {
        try {
          const refused = toggleSkillFile(target, disableModelInvocation, allowedRoots);
          results.push(refused ? { filePath: target, error: refused.error } : { filePath: target });
        } catch (e) {
          results.push({ filePath: target, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return NextResponse.json({ results });
    }

    if (!filePath) return NextResponse.json({ error: "filePath required" }, { status: 400 });
    const refused = toggleSkillFile(filePath, disableModelInvocation, await getSkillEditRoots());
    if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
