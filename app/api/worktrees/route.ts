import { NextResponse } from "next/server";
import { createWorktree, listWorktrees } from "@/lib/worktrees";
import { recordWorktree } from "@/lib/worktree-sessions";

// GET /api/worktrees?cwd=<path>
// Lists git worktrees for the repository containing `cwd`. Read-only.
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

// POST /api/worktrees  body: { cwd, branch, base? }
// Creates a new worktree (with a new branch) under <repo>/.pi/worktrees/<slug>.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; branch?: string; base?: string };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    const branch = typeof body.branch === "string" ? body.branch.trim() : "";
    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    if (!branch) return NextResponse.json({ error: "branch is required" }, { status: 400 });

    const result = await createWorktree(cwd, { branch, base: body.base });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Failed to create worktree" }, { status: 400 });
    }
    if (result.worktreePath && result.branch && result.mainRepo) {
      recordWorktree({
        branch: result.branch,
        worktreePath: result.worktreePath,
        mainRepo: result.mainRepo,
        createdAt: new Date().toISOString(),
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
