"use client";

import { ChevronRight, Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { TrajectoryRecordView, TrajectoryResponse } from "@/lib/api-types";
import { formatDuration } from "./TrajectoryTimeline";

export interface TrajectoryLedgerProps {
  records: TrajectoryRecordView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onExpandSubagent: (record: TrajectoryRecordView) => void;
  childTrajectories: ReadonlyMap<string, TrajectoryResponse>;
}

const KIND_OPTIONS = ["all", "request", "tool", "retry", "compaction", "subagent", "turn", "error"];
const STATUS_OPTIONS = ["all", "running", "complete", "aborted", "error"];

const STATUS_CLASS: Record<string, string> = {
  running: "is-running",
  complete: "is-complete",
  aborted: "is-aborted",
  error: "is-error",
};

export function kindGroup(kind: string): string {
  if (kind.startsWith("request")) return "request";
  if (kind.startsWith("tool")) return "tool";
  if (kind.startsWith("retry")) return "retry";
  if (kind.startsWith("compaction")) return "compaction";
  if (kind.startsWith("subagent")) return "subagent";
  if (kind.startsWith("turn")) return "turn";
  if (kind === "error") return kind;
  return "other";
}

function ChildSummary({ response }: { response: TrajectoryResponse }) {
  const { t } = useI18n();
  const stats = response.stats;
  return (
    <div className="trajectory-child">
      <div className="trajectory-child-stats">
        <span>{t("trajectory.childRequests", { count: stats.requests })}</span>
        <span>{t("trajectory.childTools", { count: stats.tools })}</span>
        <span>{t("trajectory.childTokens", { count: stats.tokens.total.toLocaleString() })}</span>
        <span>{t("trajectory.childActive", { duration: formatDuration(stats.totalActiveMs) })}</span>
      </div>
      <div className="trajectory-child-rows">
        {response.records.slice(0, 12).map((record) => (
          <div key={record.id} className="trajectory-child-row">
            <span className={`trajectory-status-dot ${STATUS_CLASS[record.status] ?? ""}`} />
            <span className="trajectory-child-kind">{t(`trajectory.kind.${kindGroup(record.kind)}`)}</span>
            <span className="trajectory-child-text" title={record.summary}>{record.summary}</span>
            <span className="trajectory-duration">{formatDuration(record.durationMs)}</span>
          </div>
        ))}
        {response.records.length > 12 ? <div className="trajectory-child-more">{t("trajectory.childMore", { count: response.records.length - 12 })}</div> : null}
      </div>
    </div>
  );
}

export function TrajectoryLedger({
  records,
  selectedId,
  onSelect,
  onExpandSubagent,
  childTrajectories,
}: TrajectoryLedgerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((record) => {
      if (kind !== "all" && kindGroup(record.kind) !== kind) return false;
      if (status !== "all" && record.status !== status) return false;
      if (needle && !`${record.summary} ${record.id} ${record.kind}`.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [records, query, kind, status]);

  return (
    <div className="trajectory-ledger">
      <div className="trajectory-toolbar">
        <div className="trajectory-search">
          <Search size={12} strokeWidth={2} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("trajectory.searchPlaceholder")}
            aria-label={t("trajectory.searchLabel")}
          />
        </div>
        <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label={t("trajectory.filterType")}>
          {KIND_OPTIONS.map((option) => (
            <option key={option} value={option}>{t(`trajectory.kind.${option}`)}</option>
          ))}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label={t("trajectory.filterStatus")}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>{t(`trajectory.status.${option}`)}</option>
          ))}
        </select>
      </div>
      <div className="trajectory-table-wrap">
        <table className="trajectory-table">
          <colgroup>
            <col className="trajectory-col-seq" />
            <col className="trajectory-col-turn" />
            <col className="trajectory-col-type" />
            <col className="trajectory-col-event" />
            <col className="trajectory-col-time" />
            <col className="trajectory-col-status" />
          </colgroup>
          <thead>
            <tr>
              <th>{t("trajectory.col.seq")}</th>
              <th>{t("trajectory.col.turn")}</th>
              <th>{t("trajectory.col.type")}</th>
              <th>{t("trajectory.col.event")}</th>
              <th>{t("trajectory.col.time")}</th>
              <th aria-label={t("trajectory.col.status")} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((record) => {
              const childId = record.childSessionId ?? "";
              const child = childId ? childTrajectories.get(childId) : undefined;
              return (
                <Fragment key={record.id}>
                  <tr
                    className={record.id === selectedId ? "is-selected" : ""}
                    onClick={() => onSelect(record.id)}
                  >
                    <td className="trajectory-seq">{record.sequence}</td>
                    <td className="trajectory-turn">{record.turnId ?? "—"}</td>
                    <td><span className={`trajectory-pill trajectory-pill-${kindGroup(record.kind)}`}>{t(`trajectory.kind.${kindGroup(record.kind)}`)}</span></td>
                    <td>
                      <div className="trajectory-summary-cell">
                        {record.kind === "subagent_link" && childId ? (
                          <button
                            type="button"
                            className={`trajectory-expand${child ? " is-expanded" : ""}`}
                            aria-label={child ? t("trajectory.collapse") : t("trajectory.expand")}
                            onClick={(event) => {
                              event.stopPropagation();
                              onExpandSubagent(record);
                            }}
                          >
                            <ChevronRight size={12} strokeWidth={2} aria-hidden="true" />
                          </button>
                        ) : null}
                        <span title={record.summary}>{record.summary}</span>
                      </div>
                    </td>
                    <td className="trajectory-duration">
                      {formatDuration(record.durationMs)}
                      {record.status === "running" ? "…" : ""}
                    </td>
                    <td>
                      <span className={`trajectory-status-dot ${STATUS_CLASS[record.status] ?? ""}`} aria-label={t(`trajectory.status.${record.status}`)} title={t(`trajectory.status.${record.status}`)} />
                    </td>
                  </tr>
                  {child ? (
                    <tr className="trajectory-child-wrapper-row">
                      <td colSpan={6} className="trajectory-child-cell"><ChildSummary response={child} /></td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="trajectory-empty-row">{t("trajectory.noMatches")}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
