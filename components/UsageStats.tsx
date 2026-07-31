"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { UsageRange, UsageReport } from "@/lib/usage-store";

const RANGES: UsageRange[] = ["today", "7d", "30d", "all"];

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

function formatCost(cost: number): string {
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}

export function UsageStats({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [range, setRange] = useState<UsageRange>("7d");
  const [report, setReport] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (r: UsageRange) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage?range=${r}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReport((await res.json()) as UsageReport);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const totals = report?.totals;
  const totalTokens = totals ? totals.input + totals.output + totals.cacheRead + totals.cacheWrite : 0;
  const maxDailyCost = report ? Math.max(...report.daily.map((d) => d.cost), 0) : 0;
  const installedDate = report ? new Date(report.installedAt).toLocaleDateString() : "";

  const card = (label: string, value: string) => (
    <div key={label} style={{
      flex: 1, minWidth: 110, padding: "10px 12px",
      background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
    }}>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-mono)" }}>{value}</div>
    </div>
  );

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: isMobile ? "calc(100vw - 16px)" : 720, maxWidth: "calc(100vw - 16px)",
        maxHeight: "78vh", background: "var(--bg)", border: "1px solid var(--border)",
        borderRadius: 10, display: "flex", flexDirection: "column",
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("usage.title")}</span>
            {installedDate && (
              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("usage.since", { date: installedDate })}</span>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        {/* Range tabs */}
        <div style={{ display: "flex", gap: 6, padding: "10px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          {RANGES.map((r) => {
            const active = r === range;
            return (
              <button
                key={r}
                onClick={() => setRange(r)}
                style={{
                  padding: "4px 12px", fontSize: 12, borderRadius: 6, cursor: "pointer",
                  border: `1px solid ${active ? "rgba(37,99,235,0.35)" : "var(--border)"}`,
                  background: active ? "var(--bg-selected)" : "none",
                  color: active ? "var(--accent)" : "var(--text-muted)",
                  fontWeight: active ? 600 : 400,
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                }}
              >
                {t(`usage.range.${r}`)}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
          {loading && !report ? (
            <div style={{ padding: "30px 0", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>{t("usage.loading")}</div>
          ) : error ? (
            <div style={{ padding: "30px 0", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>{t("usage.error")}</div>
          ) : !report || report.models.length === 0 ? (
            <div style={{ padding: "30px 0", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
              {t("usage.empty", { date: installedDate })}
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                {card(t("usage.totalCost"), formatCost(totals!.cost))}
                {card(t("usage.totalTokens"), formatTokens(totalTokens))}
                {card(t("usage.messages"), String(totals!.messages))}
                {card(t("usage.sessions"), String(totals!.sessions))}
              </div>

              {/* Daily cost bars */}
              {report.daily.length > 1 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                    {t("usage.daily")}
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 56, padding: "6px 8px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8 }}>
                    {report.daily.map((d) => (
                      <div
                        key={d.day}
                        title={`${d.day} · ${formatCost(d.cost)} · ${formatTokens(d.tokens)} tok`}
                        style={{
                          flex: 1, minWidth: 3, borderRadius: 2,
                          height: `${maxDailyCost > 0 ? Math.max((d.cost / maxDailyCost) * 100, 4) : 4}%`,
                          background: d.cost > 0 ? "var(--accent)" : "var(--border)",
                          opacity: d.cost > 0 ? 0.85 : 0.5,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Per-model table */}
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                <div style={{
                  display: "grid", gridTemplateColumns: "minmax(140px, 1.6fr) repeat(4, minmax(56px, 0.8fr)) minmax(72px, 0.9fr) minmax(90px, 1fr)",
                  padding: "8px 12px", gap: 8, background: "var(--bg-panel)",
                  fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em",
                }}>
                  <span>{t("usage.model")}</span>
                  <span style={{ textAlign: "right" }}>{t("session.input")}</span>
                  <span style={{ textAlign: "right" }}>{t("session.output")}</span>
                  <span style={{ textAlign: "right" }}>{t("session.cacheRead")}</span>
                  <span style={{ textAlign: "right" }}>{t("session.cacheWrite")}</span>
                  <span style={{ textAlign: "right" }}>{t("session.cost")}</span>
                  <span>{t("usage.share")}</span>
                </div>
                {report.models.map((m) => {
                  const share = totals!.cost > 0 ? m.cost / totals!.cost : 0;
                  return (
                    <div
                      key={`${m.provider}/${m.model}`}
                      style={{
                        display: "grid", gridTemplateColumns: "minmax(140px, 1.6fr) repeat(4, minmax(56px, 0.8fr)) minmax(72px, 0.9fr) minmax(90px, 1fr)",
                        padding: "8px 12px", gap: 8, alignItems: "center",
                        borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text)",
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${m.provider}/${m.model}`}>
                        <span style={{ color: "var(--text-dim)" }}>{m.provider}/</span>{m.model}
                      </span>
                      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{formatTokens(m.input)}</span>
                      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{formatTokens(m.output)}</span>
                      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{formatTokens(m.cacheRead)}</span>
                      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{formatTokens(m.cacheWrite)}</span>
                      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{formatCost(m.cost)}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
                          <span style={{ display: "block", height: "100%", width: `${Math.max(share * 100, 2)}%`, background: "var(--accent)", borderRadius: 2 }} />
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", width: 38, textAlign: "right" }}>
                          {(share * 100).toFixed(0)}%
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-dim)" }}>{t("usage.disclaimer")}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
