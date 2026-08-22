import { NextResponse } from "next/server";
import {
  findBlockingOccupant,
  getRpcSession,
  getWorktreeOccupants,
  startRpcSession,
} from "@/lib/rpc-manager";
import { resolveSessionPath, readSessionHeader } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

/**
 * POST /api/sessions/[id]/attach
 *
 * Give this session ownership of its working directory and start it with
 * `session_start(reason: "resume")`, so extensions reconcile the checkout the
 * same way they do when the `pi` CLI resumes a session.
 *
 * Opening a session never does this: browsing a transcript must not touch the
 * file system. Attachment is always an explicit request.
 *
 * 409 when another session is mid-run in the same directory.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const existing = getRpcSession(id);
    if (existing?.isAttached()) {
      return NextResponse.json({ attached: true, alreadyAttached: true });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const cwd = readSessionHeader(filePath)?.cwd;
    if (!cwd) {
      return NextResponse.json(
        { error: "This session has no recorded working directory" },
        { status: 409 },
      );
    }

    const blocking = findBlockingOccupant(cwd, [id]);
    if (blocking) {
      return NextResponse.json(
        { error: "Working directory is in use", conflict: blocking, cwd },
        { status: 409 },
      );
    }

    // An unattached session may already exist because something incidental
    // needed one. Retire it: startRpcSession reuses live wrappers, and reusing
    // this one would skip session_start(reason: "resume") — the event that makes
    // extensions reconcile the checkout — leaving the claim without the work.
    if (existing?.isAlive()) {
      if (existing.isRunning()) {
        return NextResponse.json(
          { error: "This session is busy. Try again in a moment." },
          { status: 409 },
        );
      }
      await existing.shutdown();
    }

    const { session } = await startRpcSession(id, filePath, undefined, {
      attach: true,
      sessionStartEvent: { type: "session_start", reason: "resume" },
    });
    // Extensions reconcile the checkout in session_start; surface their
    // failures here rather than on the next prompt.
    await session.waitUntilReady();

    return NextResponse.json({
      attached: true,
      cwd,
      // Idle co-tenants do not block, but the UI should say they exist.
      sharedWith: getWorktreeOccupants(cwd, [id]),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/sessions/[id]/attach — release the working directory.
 * Detaching an already-detached session is not an error.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const session = getRpcSession(id);
    if (!session?.isAlive()) return NextResponse.json({ attached: false });
    if (session.isRunning()) {
      return NextResponse.json(
        { error: "Cannot detach while the session is running" },
        { status: 409 },
      );
    }

    await session.shutdown();
    return NextResponse.json({ attached: false });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
