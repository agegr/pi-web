import { NextResponse } from "next/server";
import { isAbsolute } from "path";
import { readAvatarConfig } from "@/lib/avatar-config.server";
import {
  getAllowedFileRoots,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";

export const dynamic = "force-dynamic";

// GET /api/avatars?cwd=<absolute-project-path>
// Reads only <cwd>/.pi/avatars.json and always returns a complete role record.
export async function GET(req: Request) {
  try {
    const cwd = new URL(req.url).searchParams.get("cwd")?.trim() ?? "";
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

    return NextResponse.json(readAvatarConfig(cwd));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
