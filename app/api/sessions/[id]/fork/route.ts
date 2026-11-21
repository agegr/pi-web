import { NextResponse } from "next/server";
import { isAbsolute } from "path";
import { allowFileRoot } from "@/lib/file-access";
import { getRpcSession } from "@/lib/rpc-manager";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { sideChatNameFromText } from "@/lib/session-family";
import { createSideSession, forkSessionBranch, forkSessionIntoCwd, readForkSourceTitle, SessionForkError } from "@/lib/session-fork";
import {
  cacheSessionPath,
  invalidateSessionListCache,
  invalidateSessionPathCache,
  readLatestSessionEntryId,
  readSessionInfo,
  resolveSessionPath,
} from "@/lib/session-reader";
import type { SessionInfo } from "@/lib/types";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// The sidebar's Fork: copies the session's current branch into a new session
// file named after the source plus a short random suffix (lib/session-fork.ts).
// File-level work, like rename and delete: it never starts, prompts or shuts
// down an AgentSession, so a running source keeps its run and an idle one
// stays closed.

const NO_STORE = { "Cache-Control": "no-store" };

interface SessionForkResponse {
  sessionId: string;
  /** The new session's catalogue row, as GET /api/sessions will list it. */
  session: SessionInfo;
}

function refusal(status: number, code: string, error: string) {
  return NextResponse.json({ error, code }, { status, headers: NO_STORE });
}

// POST /api/sessions/[id]/fork - body {}, { side: true, name? } for a side
// chat (`/side`, ADR 0007), or { cwd } for pi's Fork of a session whose folder
// is gone (pi 1.5.2): the whole file copied into a new session of `cwd`.
// Answers with the new session.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(req)) return refusal(403, "request-denied", "Untrusted API request");
  if (!hasJsonContentType(req)) return refusal(415, "request-denied", "Content-Type must be application/json");
  const { id } = await params;

  try {
    const body = await req.json().catch(() => null) as { side?: unknown; name?: unknown; cwd?: unknown } | null;
    const side = body?.side === true;
    const hasTargetCwd = body !== null && typeof body === "object" && Object.hasOwn(body, "cwd");
    const targetCwd = typeof body?.cwd === "string" ? body.cwd.trim() : undefined;
    if (hasTargetCwd && (side || !targetCwd || !isAbsolute(targetCwd))) {
      return refusal(400, "cwd-invalid", "cwd must be an absolute path");
    }
    const sideName = typeof body?.name === "string" ? sideChatNameFromText(body.name) ?? undefined : undefined;
    const opened = getRpcSession(id);
    const sourcePath = (opened?.isAlive() ? opened.sessionFile : "") || await resolveSessionPath(id);
    if (!sourcePath) {
      invalidateSessionListCache();
      return refusal(404, "not_found", "Session not found");
    }
    if (targetCwd !== undefined) return await forkIntoCwd(id, sourcePath, targetCwd);
    // The title the sidebar shows for the source, which the copy's name
    // starts with (null: the source has none, the copy stays unnamed). Read
    // first: the copy below allows no await.
    const sourceTitle = side ? null : await readForkSourceTitle(sourcePath);

    // No await from here until the copy exists: pi appends finished entries
    // synchronously in this process, so the leaf read here and the file read
    // by forkSessionBranch() see the same entries. The leaf is the one
    // GET /api/sessions/[id] shows: the open wrapper's, else the file's.
    const wrapper = getRpcSession(id);
    let liveLeafId = wrapper?.isAlive() ? wrapper.inner.sessionManager.getLeafId() : undefined;
    if (wrapper && liveLeafId !== undefined && !wrapper.isRunning()) {
      // Another pi process appended to the file of an idle wrapper: a page
      // load (GET ?force=1) would drop the wrapper and show the file instead.
      const diskLatest = readLatestSessionEntryId(wrapper.sessionFile);
      if (diskLatest && !wrapper.inner.sessionManager.getEntry(diskLatest)) liveLeafId = undefined;
    }
    const fork = side ? createSideSession(sourcePath, liveLeafId, sideName) : forkSessionBranch(sourcePath, liveLeafId, sourceTitle);
    cacheSessionPath(fork.sessionId, fork.path);
    invalidateSessionListCache();

    // Read after the name was written: the row carries it.
    const info = await readSessionInfo(fork.path);
    if (!info) throw new Error("The forked session could not be read");
    // Only the copy was scanned, so its origin is added here.
    const session: SessionInfo = {
      ...info,
      parentSessionId: id,
      relation: side ? { kind: "side", parentSessionId: id } : { kind: "fork", originSessionId: id },
    };
    return NextResponse.json({ sessionId: fork.sessionId, session } satisfies SessionForkResponse, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SessionForkError) {
      if (error.code === "not_found") {
        // Deleted behind the cached path (the pi CLI, another window): the
        // list drops it on the next load.
        invalidateSessionPathCache(id);
        invalidateSessionListCache();
        return refusal(404, error.code, error.message);
      }
      if (error.code === "cwd-invalid") return refusal(400, error.code, error.message);
      return refusal(409, error.code, error.message);
    }
    return refusal(500, "failed", errorMessage(error));
  }
}

/**
 * pi's Fork into another folder (`forkSessionIntoCwd()`): the copy keeps the
 * source's name and history, so it needs no name of its own.
 */
async function forkIntoCwd(id: string, sourcePath: string, cwd: string) {
  const fork = forkSessionIntoCwd(sourcePath, cwd);
  cacheSessionPath(fork.sessionId, fork.path);
  invalidateSessionListCache();
  // The copy's folder is a project the file routes may serve, as a new
  // session's is (POST /api/agent/new).
  allowFileRoot(cwd);
  const info = await readSessionInfo(fork.path);
  if (!info) throw new Error("The forked session could not be read");
  const session: SessionInfo = { ...info, parentSessionId: id, relation: { kind: "fork", originSessionId: id } };
  return NextResponse.json({ sessionId: fork.sessionId, session } satisfies SessionForkResponse, { headers: NO_STORE });
}
