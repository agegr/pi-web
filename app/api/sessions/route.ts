import {
  attachSessionProjectInfo,
  listAllSessions,
  mergeSessionLists,
} from "@/lib/session-reader";
import { getRpcSessionInfos, getRunningRpcSessionIds } from "@/lib/rpc-manager";
import { attachSessionRelations } from "@/lib/session-relations";
import type { SessionInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

const SESSION_LIST_FIRST_MESSAGE_CHARS = 512;

export function compactSessionForList(session: SessionInfo): SessionInfo {
  if (session.firstMessage.length <= SESSION_LIST_FIRST_MESSAGE_CHARS) return session;
  return { ...session, firstMessage: session.firstMessage.slice(0, SESSION_LIST_FIRST_MESSAGE_CHARS) };
}

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const [persistedSessions, runtimeSessions] = await Promise.all([
      listAllSessions({ force }),
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    const sessions = attachSessionRelations(mergeSessionLists(persistedSessions, runtimeSessions)).map(compactSessionForList);
    return Response.json(
      { sessions, runningSessionIds: getRunningRpcSessionIds() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
