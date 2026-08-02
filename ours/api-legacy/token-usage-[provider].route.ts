// GET /api/token-usage/[provider]
//
// Returns the current token-plan / quota usage for a supported provider,
// when an API key is configured for it. Used by the top-bar usage indicator.
//
// Response shape (always 200 unless server error):
//   { ok: true, info: TokenUsageInfo }                       — happy path
//   { ok: false, reason: "unsupported" | "not_configured" }  — nothing to show
//   { ok: false, reason: "error", error: string }            — remote fetch failed
//
// We return 200 with `ok: false` for the common "nothing to show" cases so
// the client can render a single empty state instead of branching on HTTP
// codes. 5xx is reserved for unexpected local errors.

import { AuthStorage } from "@earendil-works/pi-coding-agent/core/auth-storage";
import { NextResponse } from "next/server";

import { SUPPORTED_TOKEN_USAGE_PROVIDERS, fetchTokenPlanRemains } from "@/lib/token-usage";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// ── Request dedup cache ────────────────────────────────────────────────────
// Avoid redundant API calls when the client polls rapidly (tab switch,
// page-foreground events, etc.). Each provider entry lives 2 s; concurrent
// requests for the same provider within that window share the same promise.
const dedupCache = new Map<string, { expiresAt: number; promise: Promise<Response> }>();
const DEDUP_TTL_MS = 2_000;

export async function GET(_req: Request, { params }: Params) {
  const { provider: providerId } = await params;
  const now = Date.now();

  // Reuse in-flight or recent result
  const cached = dedupCache.get(providerId);
  if (cached && cached.expiresAt > now) {
    return cached.promise.then((r) => r.clone());
  }

  const promise = handleRequest(providerId);

  dedupCache.set(providerId, { expiresAt: now + DEDUP_TTL_MS, promise });
  // Clean up stale entries lazily (max 5 providers won't grow unbounded)
  if (dedupCache.size > 8) {
    for (const [key, entry] of dedupCache) {
      if (entry.expiresAt <= now) dedupCache.delete(key);
    }
  }

  return promise;
}

async function handleRequest(providerId: string): Promise<Response> {
  const cfg = SUPPORTED_TOKEN_USAGE_PROVIDERS[providerId];
  if (!cfg) {
    return NextResponse.json({ ok: false, reason: "unsupported" }, { status: 404 });
  }

  let apiKey: string | undefined;
  try {
    const authStorage = AuthStorage.create();
    apiKey = await authStorage.getApiKey(providerId);
  } catch {
    // Storage layer may fail — treat as not configured; UI will silently hide.
    return NextResponse.json({ ok: false, reason: "not_configured" });
  }

  if (!apiKey) {
    return NextResponse.json({ ok: false, reason: "not_configured" });
  }

  try {
    // 4s cap (down from the lib default of 5s). A GET quota query that
    // hasn't answered in 4s is effectively hung — fail fast so the client's
    // 6s timeout guard rarely has to fire, and the pill shows its error
    // state quickly instead of hanging the top bar.
    const info = await fetchTokenPlanRemains({ provider: cfg, apiKey, timeoutMs: 4000 });
    if (!info) {
      // Server responded but the payload didn't carry usable fields.
      // Treat as a soft "no data" so the UI doesn't flap on transient shapes.
      return NextResponse.json({
        ok: false,
        reason: "error",
        error: "Empty or unparseable token-plan response",
      });
    }
    return NextResponse.json({
      ok: true,
      info: serializeInfo(info),
      providerDisplayName: cfg.displayName,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      reason: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Convert a TokenUsageInfo into a JSON-safe shape so `info` rides the wire
 * without Date serialization surprises.
 */
function serializeInfo(info: import("@/lib/token-usage").TokenUsageInfo) {
  // Pull per-model rows out of the MiniMax envelope so the UI can render a
  // breakdown in a future tooltip without re-fetching. Other providers'
  // `raw` payloads pass through unchanged.
  const breakdown =
    info.raw &&
    typeof info.raw === "object" &&
    Array.isArray((info.raw as { model_remains?: unknown }).model_remains)
      ? (info.raw as { model_remains: Array<Record<string, unknown>> }).model_remains.map((m) => ({
          model_name: m.model_name,
          current_interval_total_count:
            typeof m.current_interval_total_count === "number"
              ? m.current_interval_total_count
              : null,
          current_interval_usage_count:
            typeof m.current_interval_usage_count === "number"
              ? m.current_interval_usage_count
              : null,
          current_interval_remaining_percent:
            typeof m.current_interval_remaining_percent === "number"
              ? m.current_interval_remaining_percent
              : null,
          end_time: typeof m.end_time === "number" ? m.end_time : null,
          current_interval_status:
            typeof m.current_interval_status === "number" ? m.current_interval_status : null,
        }))
      : undefined;

  return {
    provider: info.provider,
    used: info.used,
    remaining: info.remaining ?? null,
    total: info.total ?? null,
    usedPercent: info.usedPercent,
    resetAt: info.resetAt ? info.resetAt.toISOString() : null,
    breakdown,
    raw: info.raw,
  };
}
