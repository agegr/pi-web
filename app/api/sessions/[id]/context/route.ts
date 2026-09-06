import { NextResponse } from "next/server";
import { resolveSessionPath, buildSessionContext } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { createServerTiming } from "@/lib/server-timing";
import {
  getParsedSessionSnapshot,
  getSessionContextFromSnapshot,
} from "@/lib/session-detail-cache";
import {
  computeSessionContextStats,
  computeSessionInputHistory,
  paginateSessionContext,
  parseSessionContextPageRequest,
  SessionContextPageRequestError,
} from "@/lib/session-context-page";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const timing = createServerTiming();
  const { id } = await params;
  const url = new URL(req.url);
  // An explicit empty leaf selects the empty branch; absence uses the active leaf.
  const requestedLeafId = url.searchParams.has("leafId") ? url.searchParams.get("leafId") || null : undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");

  try {
    const pageRequest = parseSessionContextPageRequest(url.searchParams);
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc
      ? null
      : await timing.time("resolve", () => resolveSessionPath(id));
    if (!liveRpc && !filePath) {
      return timing.finish(NextResponse.json({ error: "Session not found" }, { status: 404 }));
    }

    const diskSnapshot = liveRpc
      ? null
      : await timing.time("parse", () => getParsedSessionSnapshot(filePath!));
    const manager = liveRpc?.inner.sessionManager;
    const entries = manager?.getEntries() ?? diskSnapshot!.entries;
    const leafId = requestedLeafId !== undefined ? requestedLeafId : (manager ? manager.getLeafId() : diskSnapshot!.leafId);
    const contextOptions = { deferThinking, deferToolResultImages, sessionId: id };
    const fullContext = timing.timeSync("context", () => diskSnapshot
      ? getSessionContextFromSnapshot(
          diskSnapshot,
          leafId,
          contextOptions,
          () => buildSessionContext(entries as never, leafId, contextOptions),
        )
      : buildSessionContext(entries as never, leafId, contextOptions));
    const contextStats = computeSessionContextStats(fullContext);
    const inputHistory = computeSessionInputHistory(fullContext);
    const { context, page } = pageRequest
      ? paginateSessionContext(fullContext, pageRequest)
      : {
          context: fullContext,
          page: {
            startIndex: 0,
            endIndex: fullContext.messages.length,
            totalMessages: fullContext.messages.length,
            hasEarlier: false,
          },
        };

    const response = timing.timeSync("serialize", () => NextResponse.json({
      context,
      page,
      contextStats,
      inputHistory,
    }));
    return timing.finish(response);
  } catch (error) {
    const status = error instanceof SessionContextPageRequestError ? 400 : 500;
    return timing.finish(NextResponse.json({ error: String(error) }, { status }));
  }
}
