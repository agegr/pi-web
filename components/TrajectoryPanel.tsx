"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TrajectoryRow, TrajectoryTurn } from "@/lib/trajectory";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  sessionId: string;
  /** Hide the panel when there is no session to inspect. */
  onClose: () => void;
  translate: Translate;
}

interface TrajectoryResponse {
  span: { start: number; end: number };
  coverage: { assistantRows: number; timedRows: number };
  branch: { rows: number; turns: number };
  rows: TrajectoryRow[];
  turns: Array<TrajectoryTurn & { partial: boolean }>;
  hasMore: boolean;
  oldestRowId: string | null;
  error?: string;
}

const PAGE_SIZE = 200;

/** Decode-speed palette, matching the live t/s badge in MessageView. */
function decodeColor(tokensPerSecond: number): string {
  if (tokensPerSecond >= 50) return "#53b3cb";
  if (tokensPerSecond >= 30) return "#9bc53d";
  if (tokensPerSecond >= 15) return "#f9c22e";
  return "#e01a4f";
}

const KIND_COLOR: Record<TrajectoryRow["kind"], string> = {
  user: "var(--text-dim)",
  assistant: "#53b3cb",
  tool: "#5b8def",
  compaction: "#b48ead",
  branch_summary: "#b48ead",
  custom_message: "#9bc53d",
  other: "var(--text-dim)",
};

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return seconds >= 1 ? `${seconds}s` : `${ms}ms`;
}

function formatClock(ms: number, start: number): string {
  const totalSeconds = Math.floor((ms - start) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `+${minutes}m${String(seconds).padStart(2, "0")}s` : `+${seconds}s`;
}

function kindLabelKey(kind: TrajectoryRow["kind"]): string {
  switch (kind) {
    case "user": return "trajectory.user";
    case "assistant": return "trajectory.assistant";
    case "tool": return "trajectory.tool";
    case "compaction": return "trajectory.compaction";
    case "branch_summary": return "trajectory.branchSummary";
    case "custom_message": return "trajectory.customMessage";
    default: return "trajectory.other";
  }
}

export function TrajectoryPanel({ sessionId, onClose, translate }: Props) {
  const [data, setData] = useState<TrajectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setSelectedRowId(null);

    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/trajectory?tail=${PAGE_SIZE}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as TrajectoryResponse;
        if (!response.ok || payload.error) throw new Error(payload.error ?? `HTTP ${response.status}`);
        return payload;
      })
      .then((payload) => {
        setData(payload);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });

    return () => controller.abort();
  }, [sessionId]);

  const oldestRowId = data?.oldestRowId ?? null;

  const loadEarlier = useCallback(() => {
    if (!oldestRowId || loadingEarlier) return;
    setLoadingEarlier(true);
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/trajectory?tail=${PAGE_SIZE}&before=${encodeURIComponent(oldestRowId)}`)
      .then(async (response) => {
        const payload = await response.json() as TrajectoryResponse;
        if (!response.ok || payload.error) throw new Error(payload.error ?? `HTTP ${response.status}`);
        return payload;
      })
      .then((payload) => {
        setData((current) => current ? {
          ...current,
          rows: [...payload.rows, ...current.rows],
          turns: mergeTurns(payload.turns, current.turns),
          hasMore: payload.hasMore,
          oldestRowId: payload.oldestRowId,
        } : payload);
        setLoadingEarlier(false);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoadingEarlier(false);
      });
  }, [oldestRowId, loadingEarlier, sessionId]);

  const overview = useMemo(() => buildOverviewSegments(data), [data]);

  if (loading) {
    return (
      <div className="trajectory-panel">
        <div className="trajectory-message">{translate("trajectory.loading")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="trajectory-panel">
        <div className="trajectory-message trajectory-error">
          {translate("trajectory.error")}: {error}
        </div>
        <button type="button" className="trajectory-more" onClick={onClose}>
          {translate("trajectory.close")}
        </button>
      </div>
    );
  }

  if (!data || data.rows.length === 0) {
    return (
      <div className="trajectory-panel">
        <div className="trajectory-message">{translate("trajectory.empty")}</div>
      </div>
    );
  }

  const missingTiming = data.coverage.assistantRows - data.coverage.timedRows;

  return (
    <div className="trajectory-panel">
      <div className="trajectory-header">
        <span className="trajectory-title">{translate("trajectory.title")}</span>
        <span className="trajectory-meta">
          {translate("trajectory.branchSummaryCounts", {
            turns: data.branch.turns,
            rows: data.branch.rows,
          })}
        </span>
        <span className="trajectory-meta">
          {translate("trajectory.timingCoverage", {
            timed: data.coverage.timedRows,
            total: data.coverage.assistantRows,
          })}
        </span>
        {missingTiming > 0 && (
          <span className="trajectory-hint">{translate("trajectory.timingMissing")}</span>
        )}
      </div>

      {overview.totalMs > 0 && (
        <div className="trajectory-overview">
          <div className="trajectory-overview-head">
            <span>{translate("trajectory.overview")}</span>
            <span className="trajectory-legend">
              <i style={{ background: "var(--text-dim)" }} />
              {translate("trajectory.legendWait")}
              <i style={{ background: "#53b3cb" }} />
              {translate("trajectory.legendDecode")}
              <i style={{ background: "#5b8def" }} />
              {translate("trajectory.legendTool")}
            </span>
          </div>
          <div className="trajectory-track">
            {overview.segments.map((segment) => (
              <span
                key={segment.key}
                className="trajectory-segment"
                style={{
                  left: `${segment.left}%`,
                  width: `${segment.width}%`,
                  background: segment.color,
                  opacity: segment.faint ? 0.45 : 1,
                }}
                title={`${segment.label} · ${formatDuration(segment.durationMs)}`}
              />
            ))}
          </div>
        </div>
      )}

      <div className="trajectory-turns">
        {data.hasMore && (
          <button
            type="button"
            className="trajectory-more"
            onClick={loadEarlier}
            disabled={loadingEarlier}
          >
            {loadingEarlier ? translate("trajectory.loadingEarlier") : translate("trajectory.loadEarlier")}
          </button>
        )}
        {data.turns.map((turn) => (
          <section key={`turn:${turn.index}`} className="trajectory-turn">
            <header className="trajectory-turn-head">
              <span className="trajectory-turn-index">
                {translate("trajectory.turn", { index: turn.index + 1 })}
              </span>
              {turn.label && <span className="trajectory-turn-label">{turn.label}</span>}
              <span className="trajectory-turn-stats">
                {translate("trajectory.model")} {formatDuration(turn.modelMs)}
                {" · "}
                {translate("trajectory.tool")} {formatDuration(turn.toolMs)}
              </span>
              {turn.partial && (
                <span className="trajectory-turn-partial">{translate("trajectory.partialTurn")}</span>
              )}
            </header>
            {turn.rows.map((row) => (
              <TrajectoryRowView
                key={row.id}
                row={row}
                start={data.span.start}
                expanded={selectedRowId === row.id}
                onToggle={() => setSelectedRowId((current) => current === row.id ? null : row.id)}
                translate={translate}
              />
            ))}
          </section>
        ))}
      </div>

      <style>{`
        .trajectory-panel {
          display: flex;
          flex-direction: column;
          max-height: min(760px, calc(100dvh - 120px));
          background: var(--bg-panel);
          border-bottom: 1px solid var(--border);
        }
        .trajectory-header {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 10px;
          padding: 10px 16px 8px;
          border-bottom: 1px solid var(--border);
          font-size: 11px;
        }
        .trajectory-title { font-weight: 700; color: var(--text); }
        .trajectory-meta { color: var(--text-muted); font-family: var(--font-mono); }
        .trajectory-hint { color: var(--text-dim); }
        .trajectory-overview {
          position: sticky;
          top: 0;
          z-index: 1;
          padding: 8px 16px 10px;
          background: var(--bg-panel);
          border-bottom: 1px solid var(--border);
        }
        .trajectory-overview-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          font-size: 11px;
          color: var(--text-dim);
          margin-bottom: 6px;
        }
        .trajectory-legend {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 10px;
          color: var(--text-dim);
        }
        .trajectory-legend i {
          display: inline-block;
          width: 10px;
          height: 6px;
          border-radius: 1px;
          margin-left: 8px;
        }
        .trajectory-legend i:first-child { margin-left: 0; }
        .trajectory-track {
          position: relative;
          height: 22px;
          border-radius: 3px;
          background: var(--bg-hover);
          overflow: hidden;
        }
        .trajectory-segment {
          position: absolute;
          top: 3px;
          bottom: 3px;
          min-width: 2px;
          border-radius: 2px;
        }
        .trajectory-turns {
          min-height: 0;
          flex: 1;
          overflow: auto;
          padding: 4px 16px 16px;
        }
        .trajectory-turn { margin-top: 12px; }
        .trajectory-turn-head {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 8px;
          padding: 4px 0 6px;
          border-bottom: 1px solid var(--border);
          font-size: 11px;
          position: sticky;
          top: 0;
          background: var(--bg-panel);
        }
        .trajectory-turn-index { font-weight: 700; color: var(--text); }
        .trajectory-turn-label { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46ch; }
        .trajectory-turn-stats { margin-left: auto; font-family: var(--font-mono); color: var(--text-dim); }
        .trajectory-turn-partial { color: var(--text-dim); font-style: italic; }
        .trajectory-row {
          display: grid;
          grid-template-columns: 14px minmax(70px, 96px) minmax(0, 1fr) auto auto;
          align-items: baseline;
          gap: 10px;
          width: 100%;
          padding: 4px 6px;
          background: none;
          border: none;
          border-bottom: 1px solid var(--border);
          text-align: left;
          font-size: 11.5px;
          font-family: var(--font-mono);
          color: var(--text-muted);
          cursor: pointer;
        }
        .trajectory-row:hover { background: var(--bg-hover); }
        .trajectory-row[aria-expanded="true"] { background: var(--bg-selected); }
        .trajectory-dot { width: 8px; height: 8px; border-radius: 50%; align-self: center; }
        .trajectory-kind { color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .trajectory-text { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .trajectory-text.is-error { color: #e01a4f; }
        .trajectory-duration { color: var(--text-dim); white-space: nowrap; }
        .trajectory-tokens { color: var(--text-dim); white-space: nowrap; }
        .trajectory-detail {
          padding: 8px 12px 12px 30px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-hover);
          font-size: 11.5px;
          font-family: var(--font-mono);
          color: var(--text-muted);
        }
        .trajectory-detail-grid {
          display: grid;
          grid-template-columns: max-content minmax(0, 1fr);
          column-gap: 12px;
          row-gap: 4px;
          margin-bottom: 8px;
        }
        .trajectory-detail-label { color: var(--text-dim); }
        .trajectory-detail-block {
          margin-top: 6px;
          padding: 8px 10px;
          border-radius: 4px;
          background: var(--bg-panel);
          border: 1px solid var(--border);
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          max-height: 260px;
          overflow: auto;
        }
        .trajectory-message { padding: 16px; font-size: 12px; color: var(--text-muted); font-style: italic; }
        .trajectory-error { color: #e01a4f; font-style: normal; }
        .trajectory-more {
          display: block;
          margin: 8px auto;
          padding: 4px 12px;
          border-radius: 4px;
          border: 1px solid var(--border);
          background: var(--bg-panel);
          color: var(--text-muted);
          font-size: 11px;
          cursor: pointer;
        }
        .trajectory-more:disabled { opacity: 0.5; cursor: default; }
        @media (max-width: 640px) {
          /* Keep every visible cell on one line: the token column is dropped, so
             the grid must still declare a column for the duration. */
          .trajectory-row { grid-template-columns: 12px auto minmax(0, 1fr) auto; }
          .trajectory-tokens { display: none; }
          .trajectory-turn-label { max-width: 18ch; }
          .trajectory-turn-stats { margin-left: 0; width: 100%; }
        }
      `}</style>
    </div>
  );
}

function TrajectoryRowView({ row, start, expanded, onToggle, translate }: {
  row: TrajectoryRow;
  start: number;
  expanded: boolean;
  onToggle: () => void;
  translate: Translate;
}) {
  const tokensPerSecond = row.timing && row.timing.decodeMs > 0
    ? row.timing.outputTokens / (row.timing.decodeMs / 1000)
    : null;

  const primary = row.toolName ?? row.text ?? "";
  const secondary = row.toolCallCount && row.toolCallCount > 0
    ? translate("trajectory.toolCalls", { count: row.toolCallCount })
    : "";

  return (
    <>
      <button
        type="button"
        className="trajectory-row"
        aria-expanded={expanded}
        onClick={onToggle}
        title={formatClock(row.startedAt, start)}
      >
        <span className="trajectory-dot" style={{ background: KIND_COLOR[row.kind] }} />
        <span className="trajectory-kind">{translate(kindLabelKey(row.kind))}</span>
        <span className={`trajectory-text${row.isError ? " is-error" : ""}`}>
          {primary || secondary || "—"}
        </span>
        <span className="trajectory-duration">{formatDuration(row.durationMs)}</span>
        <span className="trajectory-tokens">
          {row.tokens ? `${row.tokens.total.toLocaleString()} tok` : ""}
        </span>
      </button>
      {expanded && (
        <div className="trajectory-detail">
          <div className="trajectory-detail-grid">
            <span className="trajectory-detail-label">{translate("trajectory.startedAt")}</span>
            <span>{formatClock(row.startedAt, start)}</span>
            <span className="trajectory-detail-label">{translate("trajectory.duration")}</span>
            <span>{formatDuration(row.durationMs)}</span>
            {row.model && (
              <>
                <span className="trajectory-detail-label">{translate("trajectory.modelName")}</span>
                <span>{row.provider ? `${row.provider}/` : ""}{row.model}</span>
              </>
            )}
            {row.stopReason && (
              <>
                <span className="trajectory-detail-label">{translate("trajectory.stopReason")}</span>
                <span>{row.stopReason}</span>
              </>
            )}
            {row.tokens && (
              <>
                <span className="trajectory-detail-label">{translate("trajectory.tokens")}</span>
                <span>
                  {translate("trajectory.tokenBreakdown", {
                    input: row.tokens.input,
                    output: row.tokens.output,
                    cacheRead: row.tokens.cacheRead,
                  })}
                </span>
              </>
            )}
            {typeof row.cost === "number" && row.cost > 0 && (
              <>
                <span className="trajectory-detail-label">{translate("trajectory.cost")}</span>
                <span>${row.cost.toFixed(4)}</span>
              </>
            )}
            {row.timing && (
              <>
                <span className="trajectory-detail-label">{translate("trajectory.ttft")}</span>
                <span>{row.timing.ttftMs !== null ? `${(row.timing.ttftMs / 1000).toFixed(2)}s` : "—"}</span>
                <span className="trajectory-detail-label">{translate("trajectory.decode")}</span>
                <span>
                  {(row.timing.decodeMs / 1000).toFixed(2)}s
                  {tokensPerSecond !== null && (
                    <> · <span style={{ color: decodeColor(tokensPerSecond) }}>{tokensPerSecond.toFixed(1)} tok/s</span></>
                  )}
                </span>
              </>
            )}
            {row.toolCallId && (
              <>
                <span className="trajectory-detail-label">{translate("trajectory.toolCallId")}</span>
                <span>{row.toolCallId}</span>
              </>
            )}
          </div>
          {row.args && (
            <>
              <div className="trajectory-detail-label">{translate("trajectory.args")}</div>
              <div className="trajectory-detail-block">{row.args}</div>
            </>
          )}
          {row.text && (
            <>
              <div className="trajectory-detail-label">
                {row.kind === "tool" ? translate("trajectory.result") : translate("trajectory.content")}
              </div>
              <div className="trajectory-detail-block">{row.text}</div>
            </>
          )}
        </div>
      )}
    </>
  );
}

interface OverviewSegment {
  key: string;
  left: number;
  width: number;
  color: string;
  faint?: boolean;
  label: string;
  durationMs: number;
}

/**
 * Project rows onto one horizontal axis.
 *
 * An assistant row with live timing splits into wait / decode / remainder so the
 * bar shows where the request time actually went; without timing it stays a
 * single segment, because guessing the split is exactly what the session log
 * cannot support.
 */
function buildOverviewSegments(data: TrajectoryResponse | null): {
  segments: OverviewSegment[];
  totalMs: number;
} {
  if (!data) return { segments: [], totalMs: 0 };
  const totalMs = data.span.end - data.span.start;
  if (totalMs <= 0) return { segments: [], totalMs: 0 };

  const segments: OverviewSegment[] = [];
  const toPercent = (ms: number) => (ms / totalMs) * 100;

  for (const row of data.rows) {
    const left = toPercent(row.startedAt - data.span.start);
    if (row.durationMs <= 0) {
      // Zero-duration rows are turn boundaries; mark them instead of stretching them.
      segments.push({
        key: `${row.id}:tick`,
        left,
        width: 0.2,
        color: KIND_COLOR[row.kind],
        faint: true,
        label: row.kind,
        durationMs: 0,
      });
      continue;
    }

    const width = toPercent(row.durationMs);
    const timing = row.timing;
    if (timing && timing.ttftMs !== null) {
      const ttft = Math.min(timing.ttftMs, row.durationMs);
      const decode = Math.min(timing.decodeMs, Math.max(0, row.durationMs - ttft));
      const remainder = Math.max(0, row.durationMs - ttft - decode);
      const speed = timing.decodeMs > 0 ? timing.outputTokens / (timing.decodeMs / 1000) : 0;

      segments.push({
        key: `${row.id}:ttft`,
        left,
        width: toPercent(ttft),
        color: "var(--text-dim)",
        label: "TTFT",
        durationMs: ttft,
      });
      if (decode > 0) {
        segments.push({
          key: `${row.id}:decode`,
          left: left + toPercent(ttft),
          width: toPercent(decode),
          color: decodeColor(speed),
          label: "decode",
          durationMs: decode,
        });
      }
      if (remainder > 0) {
        segments.push({
          key: `${row.id}:rest`,
          left: left + toPercent(ttft + decode),
          width: toPercent(remainder),
          color: "#53b3cb",
          faint: true,
          label: "overhead",
          durationMs: remainder,
        });
      }
      continue;
    }

    segments.push({
      key: row.id,
      left,
      width,
      color: KIND_COLOR[row.kind],
      label: row.kind,
      durationMs: row.durationMs,
    });
  }

  return { segments, totalMs };
}

/** Keep turn headers grouped when an earlier page is prepended. */
function mergeTurns(
  earlier: Array<TrajectoryTurn & { partial: boolean }>,
  later: Array<TrajectoryTurn & { partial: boolean }>,
): Array<TrajectoryTurn & { partial: boolean }> {
  const merged = new Map<number, TrajectoryTurn & { partial: boolean }>();
  for (const turn of earlier) merged.set(turn.index, { ...turn, rows: [...turn.rows] });
  for (const turn of later) {
    const existing = merged.get(turn.index);
    if (!existing) {
      merged.set(turn.index, { ...turn, rows: [...turn.rows] });
      continue;
    }
    merged.set(turn.index, {
      ...existing,
      rows: [...existing.rows, ...turn.rows],
      partial: existing.partial || turn.partial,
    });
  }
  return [...merged.values()].sort((a, b) => a.index - b.index);
}
