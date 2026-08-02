"use client";

// TerminalPanel —— 终端实时流看板（M5 / Q14）
// 订阅统一状态面的 terminals 切片，渲染选中运行的 PTY/进程实时输出（stripAnsi 去控制序列）。
import { useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { stripAnsi } from "@/lib/ansi";
import type { TerminalStream } from "@/lib/unified-engine/unified-engine-types";

function formatTime(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("zh-CN", { hour12: false });
}

export function TerminalPanel({
  terminals,
  runId,
}: {
  terminals: TerminalStream[];
  runId: string | null;
}) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const term = runId
    ? (terminals.find((tt) => tt.runId === runId && !tt.closed) ??
      terminals.find((tt) => tt.runId === runId))
    : null;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [term?.lines.length, term?.updatedAt]);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 0,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text)",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span>{t("engine.terminal")}</span>
        {term && (
          <span
            style={{
              fontSize: 11,
              padding: "2px 7px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              color: term.isPty ? "#22C55E" : "var(--text-dim)",
            }}
          >
            {term.isPty ? "PTY" : "PIPE"}
          </span>
        )}
      </div>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 140,
          maxHeight: 240,
          overflowY: "auto",
          background: "#0b0e14",
          borderRadius: 8,
          padding: "8px 10px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          lineHeight: 1.45,
          color: "#c9d1d9",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {!term || term.lines.length === 0 ? (
          <div style={{ color: "#6b7280" }}>{t("engine.terminalEmpty")}</div>
        ) : (
          term.lines.map((line, i) => <div key={i}>{stripAnsi(line) || " "}</div>)
        )}
      </div>
      {term && (
        <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
          {term.title} · {formatTime(term.updatedAt)}
          {term.closed ? ` · ${t("engine.terminalClosed")}` : ""}
        </div>
      )}
    </div>
  );
}
