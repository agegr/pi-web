"use client";

import { ChevronRight, Search } from "lucide-react";
import { Fragment, useMemo } from "react";
import type { TrajectoryRecordView, TrajectoryResponse } from "@/lib/api-types";
import { formatDuration } from "./TrajectoryTimeline";

export interface TrajectoryLedgerProps {
  records: TrajectoryRecordView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (value: string) => void;
  kind: string;
  onKindChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
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
  if (kind === "error" || kind === "warning") return kind;
  return "other";
}

function ChildSummary({ response }: { response: TrajectoryResponse }) {
  const stats = response.stats;
  return (
    <div className="trajectory-child">
      <div className="trajectory-child-stats">
        <span>{stats.requests} requests</span>
        <span>{stats.tools} tools</span>
        <span>{stats.tokens.total.toLocaleString()} tokens</span>
        <span>{formatDuration(stats.totalActiveMs)} active</span>
      </div>
      <div className="trajectory-child-rows">
        {response.records.slice(0, 12).map((record) => (
          <div key={record.id} className="trajectory-child-row">
            <span className={`trajectory-status-dot ${STATUS_CLASS[record.status] ?? ""}`} />
            <span className="trajectory-child-kind">{kindGroup(record.kind)}</span>
            <span className="trajectory-child-text" title={record.summary}>{record.summary}</span>
            <span className="trajectory-duration">{formatDuration(record.durationMs)}</span>
          </div>
        ))}
        {response.records.length > 12 ? <div className="trajectory-child-more">+{response.records.length - 12} more records</div> : null}
      </div>
    </div>
  );
}

export function TrajectoryLedger({
  records,
  selectedId,
  onSelect,
  query,
  onQueryChange,
  kind,
  onKindChange,
  status,
  onStatusChange,
  onExpandSubagent,
  childTrajectories,
}: TrajectoryLedgerProps) {
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
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search events..."
            aria-label="Search trajectory events"
          />
        </div>
        <select value={kind} onChange={(event) => onKindChange(event.target.value)} aria-label="Filter by type">
          {KIND_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <select value={status} onChange={(event) => onStatusChange(event.target.value)} aria-label="Filter by status">
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </div>
      <div className="trajectory-table-wrap">
        <table className="trajectory-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Turn</th>
              <th>Type</th>
              <th>Event</th>
              <th>Time</th>
              <th aria-label="Status" />
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
                    <td><span className={`trajectory-pill trajectory-pill-${kindGroup(record.kind)}`}>{kindGroup(record.kind)}</span></td>
                    <td className="trajectory-summary-cell">
                      {record.kind === "subagent_link" && childId ? (
                        <button
                          type="button"
                          className={`trajectory-expand${child ? " is-expanded" : ""}`}
                          aria-label={child ? "Collapse subagent trajectory" : "Expand subagent trajectory"}
                          onClick={(event) => {
                            event.stopPropagation();
                            onExpandSubagent(record);
                          }}
                        >
                          <ChevronRight size={12} strokeWidth={2} aria-hidden="true" />
                        </button>
                      ) : null}
                      <span title={record.summary}>{record.summary}</span>
                    </td>
                    <td className="trajectory-duration">
                      {formatDuration(record.durationMs)}
                      {record.status === "running" ? "…" : ""}
                    </td>
                    <td>
                      <span className={`trajectory-status-dot ${STATUS_CLASS[record.status] ?? ""}`} aria-label={record.status} title={record.status} />
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
              <tr><td colSpan={6} className="trajectory-empty-row">No events match the current filters.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
