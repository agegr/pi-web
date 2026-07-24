import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const MAX_RECENT = 10;

function getRecentPath(): string {
  const agentDir = getAgentDir();
  return join(agentDir, "recent-cwds.json");
}

function readRecent(): string[] {
  const file = getRecentPath();
  if (!existsSync(file)) return [];
  try {
    const raw = readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(paths: string[]): void {
  const file = getRecentPath();
  const dir = getAgentDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(paths.slice(0, MAX_RECENT), null, 2) + "\n", "utf-8");
}

function normalizeCwd(cwd: string): string {
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  if (cwd.startsWith("file://")) return decodeURIComponent(cwd.slice(7));
  return cwd;
}

// GET /api/cwd/recent — return recent paths
export async function GET() {
  return NextResponse.json({ recent: readRecent() });
}

// POST /api/cwd/recent — add a path to the recent list
// Body: { cwd: string }
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown };
    const cwd = typeof body.cwd === "string" ? normalizeCwd(body.cwd.trim()) : "";
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }

    let list = readRecent();
    // Remove duplicate, add to front
    list = [cwd, ...list.filter((p) => p !== cwd)];
    writeRecent(list);

    return NextResponse.json({ recent: list.slice(0, MAX_RECENT) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
