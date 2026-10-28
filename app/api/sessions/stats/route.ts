import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getRpcSession } from "@/lib/rpc-manager";
import { getSessionSettings, openSessionManager, resolveSessionPath } from "@/lib/session-reader";
import { computeSessionStats, type SessionUsageSummary } from "@/lib/session-stats";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import { SESSION_ID_PATTERN } from "@/lib/session-ui-state-shared";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

// The agent switcher's per-agent usage: the totals the stats popover shows,
// for the main session and each subagent at once. Reads like
// GET /api/sessions/[id] (a live wrapper's entries, else the cached file) and
// never starts an AgentSession. The switcher polls this while an agent runs,
// so a summary is reused until its session gains an entry.

const MAX_SESSION_STATS_IDS = 200;
const NO_STORE = { "Cache-Control": "no-store" };

type SessionManagerLike = ReturnType<typeof openSessionManager>;

interface CachedSummary {
  entryCount: number;
  lastEntryId: string | undefined;
  leafId: string | null;
  summary: SessionUsageSummary;
}

const summaries = new WeakMap<SessionManagerLike, CachedSummary>();

function refusal(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

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

  const stats = computeSessionStats(entries as unknown as SessionEntry[]);
  const summary: SessionUsageSummary = {
    tokens: stats.tokens,
    cost: stats.cost,
    toolCalls: stats.toolCalls,
    totalActiveMs: computeSessionTotalActiveMs(entries),
    ...getSessionSettings(entries as unknown as SessionEntry[], leafId),
  };
  summaries.set(sm, { entryCount: entries.length, lastEntryId, leafId, summary });
  return summary;
}

// POST /api/sessions/stats - body { ids: string[] } (at most MAX_SESSION_STATS_IDS).
// Answers { stats: { [id]: SessionUsageSummary } }; an id not found is left out.
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return refusal(403, "Untrusted API request");
  if (!hasJsonContentType(req)) return refusal(415, "Content-Type must be application/json");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refusal(400, "Invalid JSON body");
  }
  const ids = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as { ids?: unknown }).ids : undefined;
  if (!Array.isArray(ids) || ids.length === 0) return refusal(400, "ids must be a non-empty array");
  if (ids.length > MAX_SESSION_STATS_IDS) return refusal(400, `ids may hold at most ${MAX_SESSION_STATS_IDS} session ids`);
  if (!ids.every((id) => typeof id === "string" && SESSION_ID_PATTERN.test(id))) return refusal(400, "ids must be session ids");

  const stats: Record<string, SessionUsageSummary> = {};
  for (const id of new Set(ids as string[])) {
    try {
      const summary = await readSummary(id);
      if (summary) stats[id] = summary;
    } catch {
      // Malformed or concurrently removed session: leave it out.
    }
  }
  return NextResponse.json({ stats }, { headers: NO_STORE });
}
