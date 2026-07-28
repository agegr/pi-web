import { NextResponse } from "next/server";
import type { SkillInstallScope } from "@/lib/api-types";
import { checkSkillUpdates } from "@/lib/skill-updates";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      cwd?: unknown;
      package?: unknown;
      scope?: unknown;
    };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const pkg = typeof body.package === "string" ? body.package : undefined;
    const scope = body.scope === "global" || body.scope === "project"
      ? body.scope as SkillInstallScope
      : undefined;
    if ((pkg && !scope) || (!pkg && scope)) {
      return NextResponse.json({ error: "package and scope must be provided together" }, { status: 400 });
    }

    const { skills } = await loadSkillsWithInstallInfo(cwd);
    const installs = skills
      .map((skill) => skill.install)
      .filter((install): install is NonNullable<typeof install> => Boolean(install))
      .filter((install) => !pkg || (install.package === pkg && install.scope === scope));

    if (pkg && installs.length === 0) {
      return NextResponse.json({ error: "Installed skill not found" }, { status: 404 });
    }

    const updates = await checkSkillUpdates(installs, {
      githubToken: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    });
    return NextResponse.json({ updates });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
