import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { getRunningRpcSessionIds, getLiveSessionInfos } from "@/lib/rpc-manager";
import { getWorktreeMeta } from "@/lib/worktree-sessions";
import type { SessionInfo } from "@/lib/types";

export async function GET() {
  try {
    const diskSessions = await listAllSessions();

    // Merge in live in-memory sessions that pi has not flushed to disk yet
    // (pi only writes the .jsonl file once the first assistant message arrives).
    // Disk records are authoritative, so they win on id collisions.
    const byId = new Map<string, SessionInfo>();
    for (const s of diskSessions) byId.set(s.id, s);

    // Map absolute parent-session file paths -> session ids for live sessions.
    const idByPath = new Map<string, string>();
    for (const s of diskSessions) if (s.path) idByPath.set(s.path, s.id);

    for (const live of getLiveSessionInfos()) {
      if (byId.has(live.id)) continue; // disk copy is the source of truth
      if (live.path) idByPath.set(live.path, live.id);
      byId.set(live.id, {
        path: live.path,
        id: live.id,
        cwd: live.cwd,
        name: live.name,
        created: live.created,
        modified: live.modified,
        messageCount: live.messageCount,
        firstMessage: live.firstMessage,
        parentSessionId: live.parentSessionPath ? idByPath.get(live.parentSessionPath) : undefined,
      });
    }

    const sessions = [...byId.values()].sort(
      (a, b) => b.modified.localeCompare(a.modified),
    );

    return NextResponse.json({ sessions, runningSessionIds: getRunningRpcSessionIds(), worktrees: getWorktreeMeta() });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
