"use client";

import { useI18n } from "@/hooks/useI18n";

export function LogHistorySection({
  logs,
  history,
}: {
  logs: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
}) {
  const { t } = useI18n();
  const levelColor: Record<string, string> = {
    debug: "#64748b",
    info: "#3b82f6",
    warn: "#f59e0b",
    error: "#f43f5e",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
          {t("plan.log")}
        </div>
        {logs.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("plan.emptyLog")}</div>
        ) : (
          <div
            style={{
              maxHeight: 200,
              overflow: "auto",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            {logs.map((l, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "4px 8px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 11,
                  alignItems: "baseline",
                }}
              >
                <span style={{ color: levelColor[String(l.level)] ?? "#64748b" }}>●</span>
                <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                  {String(l.at).slice(11, 19)}
                </span>
                <span style={{ color: "var(--text)" }}>{String(l.message)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
          {t("plan.history")}
        </div>
        {history.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("plan.emptyHistory")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {history.map((h, i) => (
              <div
                key={i}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 8,
                  fontSize: 11,
                }}
              >
                <div style={{ color: "var(--text)" }}>{String(h.requirement)}</div>
                <div style={{ color: "var(--text-muted)", marginTop: 2 }}>
                  {String(h.status)} · {t("plan.round", { round: Number(h.roundCount ?? 0) })} ·{" "}
                  {t("plan.tokensSaved")} ≈{Number(h.tokensSavedEstimate || 0)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
