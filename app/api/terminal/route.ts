import { NextResponse } from "next/server";
import { resolve } from "path";
import { statSync } from "fs";
import { isApiRequestAllowed } from "@/lib/request-security";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import {
  createTerminalSession,
  listTerminalSessions,
  DEFAULT_TERMINAL_COLUMNS,
  DEFAULT_TERMINAL_ROWS,
} from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";

function clampDimension(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

// GET /api/terminal - list running terminal sessions
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  return NextResponse.json({
    sessions: listTerminalSessions().map((session) => session.toPublicInfo()),
  });
}

// POST /api/terminal - create a shell process in an allowed workspace
// body: { cwd: string, cols?: number, rows?: number }
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const body = (await req.json().catch(() => null)) as
      | { cwd?: unknown; cols?: unknown; rows?: unknown }
      | null;
    const cwd = typeof body?.cwd === "string" ? body.cwd.trim() : "";
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }

    const normalizedCwd = resolve(cwd);
    const roots = await getAllowedFileRoots();
    if (!isFilePathAllowed(normalizedCwd, roots)) {
      return NextResponse.json(
        { error: "cwd is not an allowed workspace" },
        { status: 403 },
      );
    }
    try {
      if (!statSync(normalizedCwd).isDirectory()) {
        return NextResponse.json({ error: "cwd is not a directory" }, { status: 400 });
      }
    } catch {
      return NextResponse.json(
        { error: `Directory does not exist: ${normalizedCwd}` },
        { status: 400 },
      );
    }

    const cols = clampDimension(body?.cols, DEFAULT_TERMINAL_COLUMNS, 1, 500);
    const rows = clampDimension(body?.rows, DEFAULT_TERMINAL_ROWS, 1, 200);
    const session = createTerminalSession(normalizedCwd, cols, rows);

    return NextResponse.json(
      { success: true, session: session.toPublicInfo() },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}