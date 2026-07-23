import { NextResponse } from "next/server";
import { isAbsolute } from "path";
import { readAvatarConfig, writeAvatarConfig } from "@/lib/avatar-config.server";
import {
  getAllowedFileRoots,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";
import { validateAvatarConfigPayload } from "@/lib/avatar-config";

export const dynamic = "force-dynamic";

async function authorizeCwd(cwd: string): Promise<NextResponse | null> {
  if (!cwd) {
    return NextResponse.json({ error: "cwd is required" }, { status: 400 });
  }
  if (!isAbsolute(cwd) && !isWindowsAbsolutePath(cwd)) {
    return NextResponse.json(
      { error: "cwd must be an absolute path" },
      { status: 400 },
    );
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return null;
}

// GET /api/avatars?cwd=<absolute-project-path>
// Reads only <cwd>/.pi/avatars.json and always returns a complete role record.
export async function GET(req: Request) {
  try {
    const cwd = new URL(req.url).searchParams.get("cwd")?.trim() ?? "";
    const denied = await authorizeCwd(cwd);
    if (denied) return denied;

    return NextResponse.json(readAvatarConfig(cwd));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PUT /api/avatars  body: { cwd, user, assistant, tool }
// Writes a complete three-role avatar record to <cwd>/.pi/avatars.json. The
// server validates each role value is a PNG/JPEG/WebP data URL; missing or
// null roles clear that slot. Existing role values for roles not present in
// the body are preserved by being merged with the on-disk record so callers
// can edit one role without resending the others.
export async function PUT(req: Request) {
  try {
    const raw = await req.json().catch(() => null) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return NextResponse.json(
        { error: "request body must be a JSON object" },
        { status: 400 },
      );
    }
    const body = raw as { cwd?: unknown; user?: unknown; assistant?: unknown; tool?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    const denied = await authorizeCwd(cwd);
    if (denied) return denied;

    // Merge with the existing record so a caller editing one role doesn't
    // have to re-send the other two. Validation runs on the merged result.
    const existing = readAvatarConfig(cwd);
    const merged = {
      user: "user" in body ? body.user : existing.user,
      assistant: "assistant" in body ? body.assistant : existing.assistant,
      tool: "tool" in body ? body.tool : existing.tool,
    };

    let validated;
    try {
      validated = validateAvatarConfigPayload(merged);
    } catch (validationError) {
      const message = validationError instanceof Error ? validationError.message : String(validationError);
      return NextResponse.json({ error: message }, { status: 400 });
    }

    writeAvatarConfig(cwd, validated);
    return NextResponse.json(validated);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
