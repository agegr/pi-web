import { NextResponse } from "next/server";
import { listWorktrees } from "@/lib/worktrees";

// GET /api/worktrees?cwd=<path>
// Lists git worktrees for the repository containing `cwd`. Read-only: does not
// grant file access to any path (selecting a worktree goes through
// /api/cwd/validate, which is where allowlisting happens).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const cwd = url.searchParams.get("cwd")?.trim();
  if (!cwd) {
    return NextResponse.json({ error: "cwd is required" }, { status: 400 });
  }

  try {
    const result = await listWorktrees(cwd);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
