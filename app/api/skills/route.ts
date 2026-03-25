import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const dynamic = "force-dynamic";

function getAgentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR;
  if (env) {
    if (env === "~") return homedir();
    if (env.startsWith("~/")) return homedir() + env.slice(1);
    return env;
  }
  return join(homedir(), ".pi", "agent");
}

// GET /api/skills?cwd=<path>
// Uses DefaultResourceLoader (same logic as AgentSession startup) so settings.json
// skill paths, package skills, and .agents/skills directories are all included.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const { DefaultResourceLoader } = await import("@mariozechner/pi-coding-agent");
    const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
    await loader.reload();
    const { skills, diagnostics } = loader.getSkills();
    return NextResponse.json({ skills, diagnostics });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// PATCH /api/skills — toggle disable-model-invocation on a SKILL.md file
export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { filePath: string; disableModelInvocation: boolean };
    const { filePath, disableModelInvocation } = body;
    if (!filePath) return NextResponse.json({ error: "filePath required" }, { status: 400 });
    if (!existsSync(filePath)) return NextResponse.json({ error: "file not found" }, { status: 404 });

    const content = readFileSync(filePath, "utf8");
    const updated = setFrontmatterField(content, "disable-model-invocation", disableModelInvocation ? true : undefined);
    writeFileSync(filePath, updated, "utf8");
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

function setFrontmatterField(content: string, key: string, value: boolean | undefined): string {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!fmMatch) {
    if (value === undefined) return content;
    return `---\n${key}: true\n---\n${content}`;
  }

  const fmBody = fmMatch[1];
  const rest = content.slice(fmMatch[0].length);
  const lineEnd = fmMatch[0].includes("\r\n") ? "\r\n" : "\n";

  const lines = fmBody.split(/\r?\n/);
  const keyRegex = new RegExp(`^(${key})\\s*:.*$`);
  const existingIdx = lines.findIndex((l) => keyRegex.test(l));

  if (value === undefined) {
    if (existingIdx === -1) return content;
    lines.splice(existingIdx, 1);
  } else {
    const newLine = `${key}: ${value}`;
    if (existingIdx === -1) {
      lines.push(newLine);
    } else {
      lines[existingIdx] = newLine;
    }
  }

  return `---${lineEnd}${lines.join(lineEnd)}${lineEnd}---${lineEnd}${rest}`;
}
