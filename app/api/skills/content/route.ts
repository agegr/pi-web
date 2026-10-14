import { NextResponse } from "next/server";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { isExistingPathWithinRoots } from "@/lib/path-security";
import { readRegularFileText } from "@/lib/regular-file";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";

export const dynamic = "force-dynamic";

/** Skill instructions should stay small enough to inspect without a large API response. */
const SKILL_CONTENT_MAX_BYTES = 1024 * 1024;
const MARKDOWN_FILE = /\.(md|markdown)$/i;

// GET /api/skills/content?cwd=<path>&filePath=<loaded skill path>[&document=<path in the skill folder>]
// The resource loader is the allow-list: accepting any readable Markdown path
// here would turn the Skills panel into a general filesystem reader. `document`
// is another Markdown file under that skill's folder, where pi resolves the
// skill's relative links; its refusals name no filesystem path.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  const filePath = searchParams.get("filePath");
  const document = searchParams.get("document");
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

    let target = skill.filePath;
    if (document !== null) {
      const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });
      // The client sends a normalized path. A `..` after a link names one file
      // to path.join() and realpath, another to the filesystem (#748).
      if (path.isAbsolute(document) || /[\\:\0]/.test(document) || document.split("/").includes("..")) {
        return refuse(400, "Document path must stay inside the skill folder");
      }
      if (!MARKDOWN_FILE.test(document)) return refuse(415, "Only Markdown documents can be opened");
      target = path.join(skill.baseDir, document);
      if (!existsSync(target)) return refuse(404, "Skill document not found");
      if (!isExistingPathWithinRoots(target, new Set([skill.baseDir]))) return refuse(403, "Document is outside the skill folder");
      if (!MARKDOWN_FILE.test(realpathSync(target))) return refuse(415, "Only Markdown documents can be opened");
      const stats = statSync(target);
      if (!stats.isFile()) return refuse(400, "Skill document is not a regular file");
      if (stats.size > SKILL_CONTENT_MAX_BYTES) return refuse(413, "Skill document is larger than 1 MiB");
    }

    const content = readRegularFileText(target, SKILL_CONTENT_MAX_BYTES);
    if (content === undefined) {
      return NextResponse.json({ error: "Skill file not found" }, { status: 404 });
    }
    return NextResponse.json({ content });
  } catch (error) {
    // Node's errors name the path; a document's answer stays without one.
    if (document !== null) return NextResponse.json({ error: "Skill document could not be read" }, { status: 500 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
