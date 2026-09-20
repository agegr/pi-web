import { NextResponse } from "next/server";
import { getSessionListVersion, resolveSessionIdByPath } from "@/lib/session-reader";
import { getRecentSessionWrites, type SessionWriteEvent } from "@/lib/session-watcher";
import {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

/**
 * Resolves the ring's session ids lazily: an empty ring (the common case) does
 * no work, keeping this poll lightweight.
 */
async function getRecentSessionWritePayload(): Promise<
  Array<{ sessionId: string | undefined; path: SessionWriteEvent["path"]; generation: number }>
> {
  const writes = getRecentSessionWrites();
  if (writes.length === 0) return [];
  return Promise.all(writes.map(async (write) => ({
    sessionId: await resolveSessionIdByPath(write.path),
    path: write.path,
    generation: write.generation,
  })));
}

// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
export async function GET() {
  return NextResponse.json(
    {
      sessionListVersion: getSessionListVersion(),
      runningSessionIds: getRunningRpcSessionIds(),
      completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
      recentSessionWrites: await getRecentSessionWritePayload(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
