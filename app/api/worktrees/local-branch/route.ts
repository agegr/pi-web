import { NextResponse } from "next/server";
import { createLocalBranch } from "@/lib/worktrees";

// POST /api/worktrees/local-branch  body: { cwd, branch, base? }
// Creates and switches to a local branch in the selected working tree.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; branch?: string; base?: string };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    const branch = typeof body.branch === "string" ? body.branch.trim() : "";
    const base = typeof body.base === "string" && body.base.trim() ? body.base.trim() : undefined;

    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    if (!branch) return NextResponse.json({ error: "branch is required" }, { status: 400 });

    const result = await createLocalBranch(cwd, { branch, base });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Failed to create branch" }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
