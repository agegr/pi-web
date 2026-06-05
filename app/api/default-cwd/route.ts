import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// POST /api/default-cwd
// Creates ~/dev/pi-cwd if it doesn't exist and returns the path.
export async function POST() {
  try {
    const dir = join(homedir(), "dev", "pi-cwd");
    mkdirSync(dir, { recursive: true });
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
