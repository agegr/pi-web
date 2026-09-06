import { NextResponse } from "next/server";
import { gzip } from "node:zlib";
import {
  attachSessionProjectInfo,
  getSessionListVersion,
  listAllSessions,
  mergeSessionLists,
} from "@/lib/session-reader";
import { createServerTiming } from "@/lib/server-timing";
import {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRpcSessionInfos,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

const MIN_GZIP_BYTES = 1024;

function acceptsGzip(value: string | null): boolean {
  if (!value) return false;

  let wildcardAccepted = false;
  for (const entry of value.split(",")) {
    const [rawCoding, ...rawParameters] = entry.trim().split(";");
    const coding = rawCoding.trim().toLowerCase();
    if (coding !== "gzip" && coding !== "*") continue;

    let quality = 1;
    for (const rawParameter of rawParameters) {
      const match = /^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i.exec(rawParameter.trim());
      if (match) quality = Number(match[1]);
    }
    if (coding === "gzip") return quality > 0;
    wildcardAccepted = quality > 0;
  }
  return wildcardAccepted;
}

function gzipJson(value: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gzip(value, { level: 6 }, (error, compressed) => {
      if (error) reject(error);
      else resolve(compressed);
    });
  });
}

export async function GET(req: Request) {
  const timing = createServerTiming();
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const persistedSessionsPromise = timing.time("session-list", () => listAllSessions({
      force,
      onTiming: (stage, durationMs) => timing.record(stage, durationMs),
    }));
    // Capture before awaiting: mutations during the scan still require a later refresh.
    const sessionListVersion = getSessionListVersion();
    const [persistedSessions, runtimeSessions] = await Promise.all([
      persistedSessionsPromise,
      timing.time("runtime-project", () => attachSessionProjectInfo(getRpcSessionInfos())),
    ]);
    const sessions = timing.timeSync("merge", () => mergeSessionLists(persistedSessions, runtimeSessions));
    const serialized = timing.timeSync("serialize", () => JSON.stringify({
      sessions,
      sessionListVersion,
      runningSessionIds: getRunningRpcSessionIds(),
      completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
    }));
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "Vary": "Accept-Encoding",
    });
    if (Buffer.byteLength(serialized) < MIN_GZIP_BYTES || !acceptsGzip(req.headers.get("Accept-Encoding"))) {
      return timing.finish(new Response(serialized, { headers }));
    }

    const compressed = await timing.time("compress", () => gzipJson(serialized));
    headers.set("Content-Encoding", "gzip");
    return timing.finish(new Response(new Uint8Array(compressed), { headers }));
  } catch (error) {
    return timing.finish(NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    ));
  }
}
