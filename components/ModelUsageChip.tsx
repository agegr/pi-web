"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { isProviderUsageId, type ProviderUsageId } from "@/lib/provider-usage-ids";

type UsageBucket = {
  id: string;
  label: string;
  remaining?: number;
  used?: number;
  limit?: number;
  unit: "percent" | "currency" | "count";
  currency?: string;
  resetsAt?: number;
  period?: string;
};

type UsageReport = {
  providerName: string;
  capturedAt: number;
  buckets: UsageBucket[];
  notes?: string[];
};

type UsageResponse = {
  providerId: string;
  status: "ready" | "auth-unavailable" | "query-failed";
  report?: UsageReport;
  message?: string;
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Shared with ProviderUsageSummary so both read one cached snapshot per provider. */
const STORAGE_PREFIX = "pi-web:provider-usage:";
/**
 * Allowance windows move on the scale of a turn, not a second, so a slow poll is
 * enough to keep the chip honest. Turn boundaries, provider switches, and tab
 * focus each force an immediate refresh on top of this.
 */
const POLL_INTERVAL_MS = 60_000;

const SHORT_LABELS: Partial<Record<ProviderUsageId, string>> = {
  "opencode-go": "Go",
  "openai-codex": "Codex",
  deepseek: "DS",
  openrouter: "OR",
  moonshotai: "Moonshot",
  "moonshotai-cn": "Moonshot",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax",
  "vercel-ai-gateway": "Vercel",
};

function cacheKey(providerId: string): string {
  return `${STORAGE_PREFIX}${providerId}`;
}

function readCache(providerId: string): UsageReport | undefined {
  try {
    const raw = localStorage.getItem(cacheKey(providerId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as UsageResponse;
    if (parsed?.status === "ready" && parsed.report && Array.isArray(parsed.report.buckets)) {
      return parsed.report;
    }
  } catch {}
  return undefined;
}

function writeCache(providerId: string, payload: UsageResponse): void {
  try {
    localStorage.setItem(cacheKey(providerId), JSON.stringify(payload));
  } catch {}
}

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatCurrency(bucket: UsageBucket): string {
  return bucket.currency === "CNY" ? `CNY ${formatAmount(bucket.remaining ?? bucket.limit ?? 0)}` : `$${formatAmount(bucket.remaining ?? bucket.limit ?? 0)}`;
}

/** Keeps the chip as narrow as possible: "{prefix} 2/17/35%" when every window is a percentage. */
export function formatUsageChip(providerId: string, report: UsageReport): string {
  const prefix = SHORT_LABELS[providerId as ProviderUsageId] ?? report.providerName.split(/\s+/)[0] ?? providerId;
  const allPercent = report.buckets.length > 0
    && report.buckets.every((bucket) => bucket.unit === "percent" && bucket.used !== undefined);
  if (allPercent) {
    return `${prefix} ${report.buckets.map((bucket) => Math.round(bucket.used as number)).join("/")}%`;
  }
  const parts = report.buckets.map((bucket) => {
    if (bucket.unit === "percent" && bucket.used !== undefined) return `${bucket.label} ${Math.round(bucket.used)}%`;
    if (bucket.unit === "currency") return `${bucket.label} ${formatCurrency(bucket)}`;
    if (bucket.remaining !== undefined && bucket.limit !== undefined) {
      return `${bucket.label} ${formatAmount(bucket.remaining)}/${formatAmount(bucket.limit)}`;
    }
    return `${bucket.label} ${bucket.period ?? "-"}`;
  });
  return `${prefix} ${parts.join(" · ")}`;
}

/** Locale-aware absolute reset time, matching the Models panel's usage summary. */
function formatResetTime(resetsAt: number): string {
  return new Date(resetsAt * 1_000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildUsageTooltip(providerId: string, report: UsageReport, t: Translate): string {
  const label = SHORT_LABELS[providerId as ProviderUsageId] ?? report.providerName;
  const lines = [t("providerUsage.chipTitle", { provider: report.providerName })];
  for (const bucket of report.buckets) {
    const parts: string[] = [];
    if (bucket.unit === "percent" && bucket.used !== undefined) {
      parts.push(t("providerUsage.bucketUsed", { percent: Math.round(bucket.used) }));
    } else if (bucket.unit === "currency") {
      parts.push(formatCurrency(bucket));
    } else if (bucket.remaining !== undefined && bucket.limit !== undefined) {
      parts.push(`${formatAmount(bucket.remaining)} / ${formatAmount(bucket.limit)}`);
    } else if (bucket.period) {
      parts.push(bucket.period);
    }
    if (bucket.resetsAt !== undefined) {
      parts.push(t("providerUsage.bucketResets", { time: formatResetTime(bucket.resetsAt) }));
    }
    lines.push(`  ${bucket.label}: ${parts.join(", ")}`);
  }
  // Provider-reported window states (e.g. rate-limited) are server text, not UI copy.
  for (const note of report.notes ?? []) lines.push(`  ${label}: ${note}`);
  return lines.join("\n");
}

/**
 * Compact provider allowance next to the model selector.
 *
 * The extension status shelf under the composer only exists once a session is
 * running, so it is empty in a brand-new composer. This reads Pi Web's own
 * `/api/provider-usage/query` instead, which resolves credentials through the
 * model runtime and therefore works with no session at all.
 */
export function ModelUsageChip({
  provider,
  refreshKey,
}: {
  provider?: string | null;
  refreshKey?: string | number;
}) {
  const { t } = useI18n();
  const providerId = typeof provider === "string" && isProviderUsageId(provider) ? provider : undefined;
  const [report, setReport] = useState<UsageReport | undefined>(undefined);
  const requestingRef = useRef(false);

  useEffect(() => {
    // Paint the last known snapshot immediately, then refresh in the background.
    setReport(providerId ? readCache(providerId) : undefined);
  }, [providerId]);

  const query = useCallback(async () => {
    if (!providerId || requestingRef.current) return;
    requestingRef.current = true;
    try {
      const response = await fetch("/api/provider-usage/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId }),
      });
      if (!response.ok) return;
      const result = await response.json() as UsageResponse;
      if (result.status === "ready" && result.report) {
        setReport(result.report);
        writeCache(providerId, result);
      }
    } catch {
      // A quota chip stays silent; the Models panel owns usage error reporting.
    } finally {
      requestingRef.current = false;
    }
  }, [providerId]);

  useEffect(() => {
    if (!providerId) return;
    void query();
  }, [providerId, query]);

  // A settled turn is usually when the allowance moved.
  useEffect(() => {
    if (!providerId || refreshKey === undefined) return;
    void query();
  }, [providerId, refreshKey, query]);

  useEffect(() => {
    if (!providerId) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void query();
    }, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void query();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [providerId, query]);

  if (!providerId || !report || report.buckets.length === 0) return null;

  return (
    <div className="model-usage-chip" title={buildUsageTooltip(providerId, report, t)}>
      {formatUsageChip(providerId, report)}
    </div>
  );
}
