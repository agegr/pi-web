import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  attachSessionProjectInfo,
  getSessionListVersion,
  listAllSessions,
  listSessionSummaries,
  mergeSessionLists,
} from "@/lib/session-reader";
import {
  getAwaitingInputRpcSessionIds,
  getCompletionNotificationSuppressedRpcSessionIds,
  getRpcSessionInfos,
  getRunningRpcSessionIds,
  withSubagentDisplayStatus,
} from "@/lib/rpc-manager";
import { startServerPerf } from "@/lib/perf";

export const dynamic = "force-dynamic";

function buildSessionsEtag(
  summary: boolean,
  sessionListVersion: number,
  runningSessionIds: string[],
  awaitingInputSessionIds: string[],
  suppressedSessionIds: string[],
): string {
  const payload = JSON.stringify([
    summary ? "summary" : "full",
    sessionListVersion,
    [...runningSessionIds].sort(),
    [...awaitingInputSessionIds].sort(),
    [...suppressedSessionIds].sort(),
  ]);
  const hash = createHash("sha1").update(payload).digest("base64url");
  return `"${hash}"`;
}

function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (!header) return false;
  const trimmed = header.trim();
  if (trimmed === "*") return true;
  const normalize = (tag: string) => tag.trim().replace(/^W\//, "");
  const target = normalize(etag);
  return trimmed.split(",").some((part) => normalize(part) === target);
}

export async function GET(req: Request) {
  const perf = startServerPerf("GET /api/sessions");
  try {
    const searchParams = new URL(req.url).searchParams;
    const force = searchParams.get("force") === "1";
    // `summary=1` serves header/stat metadata so the sidebar can paint without
    // waiting for every session transcript to be parsed.
    const summary = searchParams.get("summary") === "1";
    perf?.span("start");
    // Capture before awaiting: mutations during the scan still require a later refresh.
    const sessionListVersion = getSessionListVersion();
    const runningSessionIds = getRunningRpcSessionIds();
    const awaitingInputSessionIds = getAwaitingInputRpcSessionIds();
    const completionNotificationSuppressedSessionIds =
      getCompletionNotificationSuppressedRpcSessionIds();
    const etag = buildSessionsEtag(
      summary,
      sessionListVersion,
      runningSessionIds,
      awaitingInputSessionIds,
      completionNotificationSuppressedSessionIds,
    );
    if (!force && matchesIfNoneMatch(req.headers.get("if-none-match"), etag)) {
      const notModified = new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": "no-store",
        },
      });
      return perf?.attach(notModified) ?? notModified;
    }
    const persistedSessionsPromise = summary
      ? listSessionSummaries()
      : listAllSessions({ force });
    const [persistedSessions, runtimeSessions] = await Promise.all([
      persistedSessionsPromise,
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    perf?.span("scan+projects");
    const sessions = withSubagentDisplayStatus(mergeSessionLists(persistedSessions, runtimeSessions));
    const response = NextResponse.json(
      {
        sessions,
        sessionListVersion,
        runningSessionIds,
        awaitingInputSessionIds,
        completionNotificationSuppressedSessionIds,
      },
      { headers: { ETag: etag, "Cache-Control": "no-store" } },
    );
    return perf?.attach(response) ?? response;
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
