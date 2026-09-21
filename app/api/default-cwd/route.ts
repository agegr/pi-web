import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { allowFileRoot } from "@/lib/file-access";

// Shared by GET and POST so both report/select exactly the same directory.
function defaultCwdPath(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return join(homedir(), `pi-cwd-${date}`);
}

// GET /api/default-cwd
// Reports today's default directory (~/pi-cwd-<YYYYMMDD>) WITHOUT creating
// it, so the sidebar can apply shortcut-visibility rules (pi#18: hide the
// "use default directory" button when pinned projects diverge from it)
// without side effects. Selection still goes through POST, which creates
// the directory and allow-lists it for the file browser.
export async function GET() {
  return NextResponse.json({ cwd: defaultCwdPath() });
}

// POST /api/default-cwd
// Creates ~/pi-cwd-<YYYYMMDD> if it doesn't exist and returns the path.
export async function POST() {
  try {
    const dir = defaultCwdPath();
    mkdirSync(dir, { recursive: true });
    allowFileRoot(dir);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
