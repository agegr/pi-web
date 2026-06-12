import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  getAgentDir,
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const SETTINGS_FILE = "settings.json";
const ACTIVE_TOOLS_KEY = "activeTools";

function getSettingsPath(): string {
  return join(getAgentDir(), SETTINGS_FILE);
}

function readActiveTools(): string[] | null {
  const path = getSettingsPath();
  if (!existsSync(path)) return null;
  try {
    const settings = JSON.parse(readFileSync(path, "utf8"));
    const tools = settings[ACTIVE_TOOLS_KEY];
    return Array.isArray(tools) && tools.length > 0 ? tools : (Array.isArray(tools) ? [] : null);
  } catch {
    return null;
  }
}

function writeActiveTools(activeTools: string[]): void {
  const path = getSettingsPath();
  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, "utf8"));
    } catch {}
  }
  settings[ACTIVE_TOOLS_KEY] = activeTools;
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

// Enumerate all available tools (built-in + extensions) by creating a temp session
async function enumerateTools(cwd: string) {
  if (!cwd || !existsSync(cwd)) return [];

  const agentDir = getAgentDir();
  const sessionManager = SessionManager.create(cwd, undefined);
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    sessionManager,
  });

  const allTools: { name: string; description: string; active: boolean; sourceInfo?: { source?: string; scope?: string; path?: string; baseDir?: string } }[] = [];
  const toolEntries = session.getAllTools?.() ?? [];
  const savedActive = readActiveTools();
  const activeSet = savedActive
    ? new Set(savedActive)
    : new Set(session.getActiveToolNames?.() ?? []);

  for (const t of toolEntries) {
    allTools.push({
      name: t.name,
      description: t.description ?? "",
      active: activeSet.has(t.name),
      sourceInfo: t.sourceInfo,
    });
  }

  session.dispose?.();
  return allTools;
}

// GET /api/tools?cwd=xxx — returns saved config + tool list
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");

  const activeTools = readActiveTools();
  let tools: { name: string; description: string; active: boolean; sourceInfo?: { source?: string; scope?: string; path?: string; baseDir?: string } }[] = [];

  if (cwd) {
    try {
      tools = await enumerateTools(cwd);
    } catch (e) {
      console.error("Failed to enumerate tools:", e);
    }
  }

  return NextResponse.json({ config: { activeTools }, tools });
}

// POST /api/tools — saves active tools to settings.json
// body: { activeTools: string[] }
export async function POST(req: Request) {
  try {
    const body = await req.json() as { activeTools: string[] };
    const { activeTools } = body;
    if (!Array.isArray(activeTools)) {
      return NextResponse.json(
        { error: "activeTools must be an array" },
        { status: 400 }
      );
    }
    writeActiveTools(activeTools);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
