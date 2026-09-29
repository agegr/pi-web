import { NextResponse } from "next/server";
import { deleteBranch } from "@/lib/worktree";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";

/** Same gate as /api/files and /api/worktrees: only session cwds / project
 *  roots / explicitly allowed dirs may be mutated through this endpoint. */
async function checkCwdAllowed(cwd: string): Promise<NextResponse | null> {
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots) || !isExistingFilePathAllowed(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return null;
}

// DELETE /api/branches  body: { cwd, branch, force? }  →  { success: true }
export async function DELETE(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; branch?: string; force?: boolean };
    if (!body.cwd || typeof body.cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!body.branch || typeof body.branch !== "string") {
      return NextResponse.json({ error: "branch is required" }, { status: 400 });
    }
    const denied = await checkCwdAllowed(body.cwd);
    if (denied) return denied;

    await deleteBranch(body.cwd, body.branch, body.force === true);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // git refuses to delete a branch with unmerged commits without force;
    // surface that so the UI can offer a force-delete confirmation.
    const unmerged = /not fully merged/i.test(message);
    return NextResponse.json({ error: message, unmerged }, { status: unmerged ? 409 : 400 });
  }
}
