import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { readRegularFileText } from "@/lib/regular-file";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";

export const dynamic = "force-dynamic";

/** Skill instructions should stay small enough to inspect without a large API response. */
export const SKILL_CONTENT_MAX_BYTES = 1024 * 1024;

// GET /api/skills/content?cwd=<path>&filePath=<loaded skill path>
// The resource loader is the allow-list: accepting any readable Markdown path
// here would turn the Skills panel into a general filesystem reader.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  const filePath = searchParams.get("filePath");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
  if (!filePath) return NextResponse.json({ error: "filePath required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { skills } = await loadSkillsWithInstallInfo(cwd);
    const skill = skills.find((item) => item.filePath === filePath);
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const content = readRegularFileText(skill.filePath, SKILL_CONTENT_MAX_BYTES);
    if (content === undefined) {
      return NextResponse.json({ error: "Skill file not found" }, { status: 404 });
    }
    return NextResponse.json({ content });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
