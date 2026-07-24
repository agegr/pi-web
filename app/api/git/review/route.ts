import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isWindowsAbsolutePath } from "@/lib/file-access";
import { activateGitReview, cancelGitReview, decideGitReview, finishGitReview, getGitReview, getGitReviewCwd, startGitReview } from "@/lib/git-review";
import { resolveAllowedDirectory } from "@/lib/path-security";
import type { GitReviewDecision } from "@/lib/git-types";

type ReviewRequest =
  | { action: "start"; cwd: string; runId: number }
  | { action: "activate"; reviewId: string }
  | { action: "finish"; reviewId: string }
  | { action: "get"; reviewId: string }
  | { action: "cancel"; reviewId: string }
  | { action: "decide"; reviewId: string; revision: number; decision: GitReviewDecision; fileId?: string; hunkId?: string; all?: boolean };

function errorResponse(error: unknown) {
  const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ReviewRequest;
    if (body.action === "start") {
      const cwd = body.cwd?.trim() ?? "";
      if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
        return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
      }
      if (!Number.isSafeInteger(body.runId) || body.runId < 1) {
        return NextResponse.json({ error: "runId must be a positive integer" }, { status: 400 });
      }
      const canonicalCwd = resolveAllowedDirectory(cwd, await getAllowedFileRoots());
      if (!canonicalCwd) return NextResponse.json({ error: "Directory is not within an allowed canonical root" }, { status: 403 });
      return NextResponse.json(await startGitReview(canonicalCwd, body.runId, true));
    }
    if (!body.reviewId) return NextResponse.json({ error: "reviewId is required" }, { status: 400 });
    // Re-authorize the canonical cwd for every operation. Review ids are
    // opaque capabilities, but they must not outlive file-root access or an
    // ancestor path being replaced by a symlink.
    const storedCwd = getGitReviewCwd(body.reviewId);
    const canonicalCwd = resolveAllowedDirectory(storedCwd, await getAllowedFileRoots());
    if (!canonicalCwd || canonicalCwd !== storedCwd) {
      return NextResponse.json({ error: "Review workspace is no longer accessible" }, { status: 403 });
    }
    if (body.action === "get") return NextResponse.json(getGitReview(body.reviewId));
    if (body.action === "activate") {
      await activateGitReview(body.reviewId);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "finish") return NextResponse.json(await finishGitReview(body.reviewId));
    if (body.action === "cancel") {
      await cancelGitReview(body.reviewId);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "decide") {
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) {
        return NextResponse.json({ error: "revision must be a non-negative integer" }, { status: 400 });
      }
      return NextResponse.json(await decideGitReview(body.reviewId, {
        decision: body.decision, revision: body.revision, fileId: body.fileId, hunkId: body.hunkId, all: body.all,
      }));
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
