import { NextResponse } from "next/server";
import { listBranches } from "@/lib/worktrees";

// GET /api/worktrees/branches?cwd=<path>
// Lists local branches for choosing a base when creating a new worktree.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const cwd = url.searchParams.get("cwd")?.trim();
  if (!cwd) {
    return NextResponse.json({ error: "cwd is required" }, { status: 400 });
  }
  try {
    const result = await listBranches(cwd);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
