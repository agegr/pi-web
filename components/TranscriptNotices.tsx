"use client";

import { memo } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  formatCacheWarmCost,
  formatNoticeCost,
  formatNoticeTokens,
  type CacheMissSummary,
  type TranscriptNotice,
} from "@/lib/transcript-notices";
import type { Locale } from "@/lib/i18n/types";

// pi's TUI draws these lines in its warning color, cache warming dim (#1265).
export const TRANSCRIPT_NOTICE_WARNING_COLOR = "#d97706";

type Translate = (key: string, params?: Record<string, string | number>) => string;

function costSuffix(t: Translate, cost: number, locale: Locale | string | undefined): string {
  const formatted = formatNoticeCost(cost, locale);
  return formatted ? t("transcriptNotice.costSuffix", { cost: formatted }) : "";
}

export function transcriptNoticeText(t: Translate, notice: TranscriptNotice, locale: Locale | string | undefined): string {
  switch (notice.kind) {
    case "cache_miss": {
      const params = { tokens: formatNoticeTokens(notice.missedTokens), cost: costSuffix(t, notice.missedCost, locale) };
      if (notice.modelChanged) return t("transcriptNotice.cacheMissModelSwitch", params);
      if (notice.idleMinutes !== undefined) return t("transcriptNotice.cacheMissIdle", { ...params, minutes: notice.idleMinutes });
      return t("transcriptNotice.cacheMiss", params);
    }
    case "cache_warm":
      return t("transcriptNotice.cacheWarmed", {
        note: notice.note ? t("transcriptNotice.cacheWarmedNote", { note: notice.note }) : "",
        cost: formatCacheWarmCost(notice.cost, locale),
      });
    case "summary_cost":
      return t(notice.source === "compaction" ? "transcriptNotice.compactionCost" : "transcriptNotice.branchSummaryCost", {
        tokens: formatNoticeTokens(notice.tokens),
        cost: costSuffix(t, notice.cost, locale),
      });
    case "thinking_dropped":
      return t(notice.count === 1 ? "transcriptNotice.thinkingDroppedOne" : "transcriptNotice.thinkingDropped", { count: notice.count });
  }
}

/** The folded Process details header's part for the cache misses inside it. */
export function cacheMissSummaryText(t: Translate, summary: CacheMissSummary, locale: Locale | string | undefined): string {
  const params = {
    count: summary.count,
    tokens: formatNoticeTokens(summary.missedTokens),
    cost: costSuffix(t, summary.missedCost, locale),
  };
  return t(summary.count === 1 ? "transcriptNotice.foldCacheMiss" : "transcriptNotice.foldCacheMisses", params);
}

/** One line per notice, under the message they follow. A compaction's cost is drawn in its card. */
export const TranscriptNoticeLines = memo(function TranscriptNoticeLines({ notices }: { notices: readonly TranscriptNotice[] }) {
  const { locale, t } = useI18n();
  const shown = notices.filter((notice) => !(notice.kind === "summary_cost" && notice.source === "compaction"));
  if (shown.length === 0) return null;
  return (
    <div className="transcript-notices" style={{ display: "flex", flexDirection: "column", gap: 2, margin: "-6px 0 12px" }}>
      {shown.map((notice, index) => {
        const warning = notice.kind !== "cache_warm";
        return (
          <div
            key={index}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 6,
              fontSize: 12,
              lineHeight: 1.5,
              color: warning ? TRANSCRIPT_NOTICE_WARNING_COLOR : "var(--text-dim)",
              overflowWrap: "anywhere",
            }}
          >
            {warning && (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 3 }}>
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            )}
            <span>{transcriptNoticeText(t, notice, locale)}</span>
          </div>
        );
      })}
    </div>
  );
});
