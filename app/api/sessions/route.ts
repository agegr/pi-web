import { NextResponse } from "next/server";
import {
  applyCachedProjectInfo,
  listAllSessions,
  mergeSessionLists,
  scheduleProjectEnrichment,
} from "@/lib/session-reader";
import { getRpcSessionInfos, getRunningRpcSessionIds } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    // listAllSessions() already enriches the persisted disk scan with
    // project info. Runtime RPC sessions do not have projectRoot yet, so we
    // stamp them synchronously from the existing __piProjectCache (no git)
    // and kick off the (potentially slow) git enrichment in the background.
    // The next request will see the freshly-computed worktree groupings.
    const [persistedSessions, runtimeSessions] = await Promise.all([
      listAllSessions({ force }),
      Promise.resolve(getRpcSessionInfos()),
    ]);
    const sessions = mergeSessionLists(persistedSessions, runtimeSessions);
    const enrichedSessions = sessions.map(applyCachedProjectInfo);
    void scheduleProjectEnrichment(sessions);
    return NextResponse.json(
      { sessions: enrichedSessions, runningSessionIds: getRunningRpcSessionIds() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
