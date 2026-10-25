"use client";

import { Fragment } from "react";
import { useI18n } from "@/hooks/useI18n";
import { averageOutputRate, formatUsageTokens, type MessageUsageSummary } from "@/lib/message-usage";
import { formatTurnDuration } from "@/lib/turn-duration";
import { UsageIcon, type UsageIconKind } from "./UsageIcon";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Unabbreviated counts in the same scope as the clickable summary. */
export function usageDetailsText(summary: MessageUsageSummary, t: Translate, locale: string): string {
  const { usage, scope, durationMs } = summary;
  const count = (value: number) => value.toLocaleString(locale);
  const lines = [
    t(scope === "turn" ? "chat.usageTurn" : "chat.usageResponse"),
    ...(["input", "output", "cacheRead", "cacheWrite"] as const)
      .filter((key) => key === "input" || key === "output" || usage[key] > 0)
      .map((key) => `${t(`session.${key}`)}: ${count(usage[key])}`),
    `${t("session.total")}: ${count(usage.input + usage.output + usage.cacheRead + usage.cacheWrite)}`,
    `${t("session.cost")}: $${usage.cost?.total ?? 0}`,
  ];
  if (durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0) {
    lines.push(`${t("chat.usageDuration")}: ${(durationMs / 1_000).toLocaleString(locale, { maximumFractionDigits: 3 })}s`);
  }
  const rate = averageOutputRate(summary);
  if (rate !== undefined) lines.push(`${t("chat.usageAverage")}: ${rate.toFixed(1)} t/s`);
  if (!summary.complete) lines.push(t("chat.usageIncomplete"));
  return lines.join("\n");
}

export function MessageUsage({ summary, onShowDetails }: {
  summary: MessageUsageSummary;
  onShowDetails?: (message: string) => void;
}) {
  const { t, locale } = useI18n();
  const { usage, durationMs } = summary;
  const parts = (["input", "output", "cacheRead", "cacheWrite"] as UsageIconKind[])
    .filter((kind) => usage[kind] > 0)
    .map((kind) => (
      <span key={kind} title={t(`session.${kind}`)} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <UsageIcon kind={kind} />{formatUsageTokens(usage[kind])}
      </span>
    ));
  if (usage.cost?.total) parts.push(<span key="cost">${usage.cost.total.toFixed(4)}</span>);
  if (durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0) {
    parts.push(<span key="duration">{t("chat.turnDuration", { time: formatTurnDuration(durationMs) })}</span>);
  }
  const rate = averageOutputRate(summary);
  if (rate !== undefined) {
    parts.push(<span key="rate" title={t("chat.usageAverageHint")}>{rate.toFixed(1)} t/s</span>);
  }
  if (parts.length === 0) return null;
  const details = usageDetailsText(summary, t, locale);
  const Tag = onShowDetails ? "button" : "span";
  return (
    <Tag
      type={onShowDetails ? "button" : undefined}
      className="message-usage"
      title={details}
      aria-label={onShowDetails ? `${t("chat.usageDetails")}\n${details}` : undefined}
      onClick={onShowDetails ? () => onShowDetails(details) : undefined}
      style={{
        display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: "2px 5px",
        minWidth: 0, maxWidth: "100%", padding: "2px 0", border: "none", background: "none",
        font: "inherit", fontSize: 11, color: "var(--text-dim)", textAlign: "left",
        cursor: onShowDetails ? "pointer" : "default", fontVariantNumeric: "tabular-nums",
      }}
    >
      {parts.map((part, index) => <Fragment key={part.key}>{index > 0 && <span aria-hidden="true">·</span>}{part}</Fragment>)}
    </Tag>
  );
}
