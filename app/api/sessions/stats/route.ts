import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { getSessionSettings, openSessionManager, resolveSessionPath } from "@/lib/session-reader";
import { computeSessionStats, MAX_SESSION_STATS_IDS, type SessionUsageSummary } from "@/lib/session-stats";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import { sideOwnEntries } from "@/lib/side-session";
import { NO_STORE, readSessionIdsRequest } from "@/lib/session-ids-request";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

// The agent switcher's per-agent usage: the totals the stats popover shows,
// for the main session and each subagent at once. Reads like
// GET /api/sessions/[id] (a live wrapper's entries, else the cached file) and
// never starts an AgentSession. The switcher polls this while an agent runs,
// so a summary is reused until its session gains an entry.

type SessionManagerLike = ReturnType<typeof openSessionManager>;

interface CachedSummary {
  entryCount: number;
  lastEntryId: string | undefined;
  leafId: string | null;
  summary: SessionUsageSummary;
}

const summaries = new WeakMap<SessionManagerLike, CachedSummary>();

async function readSummary(id: string): Promise<SessionUsageSummary | null> {
  const rpc = getRpcSession(id);
  let sm: SessionManagerLike;
  if (rpc?.isAlive()) {
    sm = rpc.inner.sessionManager as SessionManagerLike;
  } else {
    const path = await resolveSessionPath(id);
    if (!path) return null;
    sm = openSessionManager(path);
  }
  const entries = sm.getEntries();
  const lastEntryId = (entries[entries.length - 1] as { id?: string } | undefined)?.id;
  const leafId = sm.getLeafId();
  const cached = summaries.get(sm);
  if (cached && cached.entryCount === entries.length && cached.lastEntryId === lastEntryId && cached.leafId === leafId) return cached.summary;

  const ownEntries = sideOwnEntries(entries);
  const stats = computeSessionStats(ownEntries as unknown as SessionEntry[]);
  const summary: SessionUsageSummary = {
    tokens: stats.tokens,
    cost: stats.cost,
    toolCalls: stats.toolCalls,
    totalActiveMs: computeSessionTotalActiveMs(ownEntries as typeof entries),
    ...getSessionSettings(entries as unknown as SessionEntry[], leafId),
  };
  summaries.set(sm, { entryCount: entries.length, lastEntryId, leafId, summary });
  return summary;
}

// POST /api/sessions/stats - body { ids: string[] } (at most MAX_SESSION_STATS_IDS).
// Answers { stats: { [id]: SessionUsageSummary } }; an id not found is left out.
export async function POST(req: Request) {
  const ids = await readSessionIdsRequest(req, MAX_SESSION_STATS_IDS);
  if (ids instanceof Response) return ids;

  const stats: Record<string, SessionUsageSummary> = {};
  for (const id of new Set(ids)) {
    try {
      const summary = await readSummary(id);
      if (summary) stats[id] = summary;
    } catch {
      // Malformed or concurrently removed session: leave it out.
    }
  }
  return NextResponse.json({ stats }, { headers: NO_STORE });
}
