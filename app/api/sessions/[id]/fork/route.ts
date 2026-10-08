import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { forkSessionBranch, readForkSourceTitle, SessionForkError } from "@/lib/session-fork";
import {
  cacheSessionPath,
  invalidateSessionListCache,
  invalidateSessionPathCache,
  readLatestSessionEntryId,
  readSessionInfo,
  resolveSessionPath,
} from "@/lib/session-reader";
import type { SessionInfo } from "@/lib/types";

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

// POST /api/sessions/[id]/fork - body {}; answers with the new session.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(req)) return refusal(403, "request-denied", "Untrusted API request");
  if (!hasJsonContentType(req)) return refusal(415, "request-denied", "Content-Type must be application/json");
  const { id } = await params;

  try {
    const opened = getRpcSession(id);
    const sourcePath = (opened?.isAlive() ? opened.sessionFile : "") || await resolveSessionPath(id);
    if (!sourcePath) {
      invalidateSessionListCache();
      return refusal(404, "not_found", "Session not found");
    }
    // The title the sidebar shows for the source, which the copy's name
    // starts with (null: the source has none, the copy stays unnamed). Read
    // first: the copy below allows no await.
    const sourceTitle = await readForkSourceTitle(sourcePath);

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
    const fork = forkSessionBranch(sourcePath, liveLeafId, sourceTitle);
    cacheSessionPath(fork.sessionId, fork.path);
    invalidateSessionListCache();

    // Read after the name was written: the row carries it.
    const info = await readSessionInfo(fork.path);
    if (!info) throw new Error("The forked session could not be read");
    // Only the copy was scanned, so its origin is added here.
    const session: SessionInfo = { ...info, parentSessionId: id, relation: { kind: "fork", originSessionId: id } };
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
      return refusal(409, error.code, error.message);
    }
    return refusal(500, "failed", error instanceof Error ? error.message : String(error));
  }
}
