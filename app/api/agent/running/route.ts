import { NextResponse } from "next/server";
import { getSessionListVersion } from "@/lib/session-reader";
import {
  getAwaitingInputRpcSessionIds,
  getCompletionNotificationSuppressedRpcSessionIds,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";
import { getSessionUiStateRevision } from "@/lib/session-ui-state";
import { getSessionIdsWithUnsettledSubagentRuns } from "@/lib/subagent-runtime";

export const dynamic = "force-dynamic";

// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
// sessionUiStateRevision (null when unreadable) tells the sidebar its pins and
// archive changed elsewhere; it costs one stat while the file is unchanged.
// subagentsActiveSessionIds: sessions whose subagents can still start a run
// there, so the sidebar announces their completion only after the last one.
// serverNow: this server's clock, which stamps reads (`readAt`); a browser
// dates its unread markers on it (lib/unread-markers.ts), never on its own.
export async function GET() {
  return NextResponse.json(
    {
      sessionListVersion: getSessionListVersion(),
      runningSessionIds: getRunningRpcSessionIds(),
      awaitingInputSessionIds: getAwaitingInputRpcSessionIds(),
      completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
      subagentsActiveSessionIds: getSessionIdsWithUnsettledSubagentRuns(),
      sessionUiStateRevision: getSessionUiStateRevision(),
      serverNow: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
