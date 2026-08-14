"use client";

import { X } from "lucide-react";
import { useState } from "react";
import type { TrajectoryRecordView } from "@/lib/api-types";
import { formatDuration } from "./TrajectoryTimeline";

export interface TrajectoryInspectorProps {
  record: TrajectoryRecordView | null;
  fullDetailsAvailable: boolean;
  fullDetailsPending: boolean;
  onRequestFullDetails: () => void;
  onConfirmFullDetails: () => void;
  onCancelFullDetails: () => void;
  onClose: () => void;
  mobile: boolean;
}

type TabId = "overview" | "input" | "output" | "timing" | "usage" | "schema";

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="trajectory-detail">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function DetailGrid({ record }: { record: TrajectoryRecordView }) {
  return (
    <div className="trajectory-detail-grid">
      <Detail label="Kind" value={record.kind} />
      <Detail label="Status" value={record.status} />
      <Detail label="Started" value={new Date(record.timestamp).toLocaleTimeString()} />
      {record.endTimestamp !== undefined
        ? <Detail label="Ended" value={new Date(record.endTimestamp).toLocaleTimeString()} />
        : null}
      <Detail label="Duration" value={record.durationMs !== undefined ? formatDuration(record.durationMs) : "—"} />
      {record.turnId ? <Detail label="Turn" value={record.turnId} /> : null}
      {record.requestId ? <Detail label="Request" value={record.requestId} /> : null}
      {record.stepId ? <Detail label="Step" value={record.stepId} /> : null}
      {record.childSessionId ? <Detail label="Child session" value={record.childSessionId} /> : null}
      <Detail label="Summary" value={record.summary} />
    </div>
  );
}

function Payload({ value }: { value: unknown }) {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return <pre className="trajectory-payload">{text}</pre>;
}

function tabPayload(record: TrajectoryRecordView, tab: TabId): unknown {
  const data = record.data ?? {};
  switch (tab) {
    case "input":
      return data.input ?? data.toolInput ?? data.context ?? null;
    case "output":
      return data.output ?? data.result ?? null;
    case "usage":
      return data.usage ?? null;
    case "schema":
      return data.schema ?? null;
    default:
      return null;
  }
}

export function TrajectoryInspector({
  record,
  fullDetailsAvailable,
  fullDetailsPending,
  onRequestFullDetails,
  onConfirmFullDetails,
  onCancelFullDetails,
  onClose,
  mobile,
}: TrajectoryInspectorProps) {
  const [tab, setTab] = useState<TabId>("overview");

  const tabs: Array<{ id: TabId; label: string; available: boolean }> = [
    { id: "overview", label: "Overview", available: true },
    { id: "input", label: "Input", available: tabPayload(record ?? ({} as TrajectoryRecordView), "input") !== null },
    { id: "output", label: "Output", available: tabPayload(record ?? ({} as TrajectoryRecordView), "output") !== null },
    { id: "timing", label: "Timing", available: true },
    { id: "usage", label: "Usage", available: tabPayload(record ?? ({} as TrajectoryRecordView), "usage") !== null },
    { id: "schema", label: "Schema", available: tabPayload(record ?? ({} as TrajectoryRecordView), "schema") !== null },
  ];
  const visibleTabs = tabs.filter((item) => item.available);
  const activeTab = visibleTabs.some((item) => item.id === tab) ? tab : "overview";

  if (!record) {
    if (mobile) return null;
    return (
      <aside className="trajectory-inspector trajectory-inspector-empty">
        Select a record to inspect
      </aside>
    );
  }

  const data = record.data ?? {};
  const showConfirmation = fullDetailsAvailable && data.input === undefined && data.output === undefined;

  const content = (
    <>
      <div className="trajectory-inspector-head">
        <small>#{record.sequence} · {record.kind} · {record.status}</small>
        <b>{record.summary}</b>
      </div>
      <div className="trajectory-inspector-tabs" role="tablist">
        {visibleTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={activeTab === item.id}
            className={activeTab === item.id ? "is-active" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="trajectory-inspector-content">
        {activeTab === "overview" ? <DetailGrid record={record} /> : null}
        {activeTab === "timing" ? (
          <div className="trajectory-detail-grid">
            <Detail label="Started" value={new Date(record.timestamp).toLocaleTimeString()} />
            {record.endTimestamp !== undefined
              ? <Detail label="Ended" value={new Date(record.endTimestamp).toLocaleTimeString()} />
              : null}
            <Detail label="Duration" value={record.durationMs !== undefined ? formatDuration(record.durationMs) : "running"} />
          </div>
        ) : null}
        {activeTab !== "overview" && activeTab !== "timing" ? <Payload value={tabPayload(record, activeTab)} /> : null}

        {showConfirmation ? (
          fullDetailsPending ? (
            <div className="trajectory-privacy-note">
              Full input and output for this record is stored locally in the session
              trajectory sidecar. It may contain file paths, tool arguments and
              command output.
              <div className="trajectory-privacy-actions">
                <button type="button" className="trajectory-btn trajectory-btn-primary" onClick={onConfirmFullDetails}>
                  Confirm and load
                </button>
                <button type="button" className="trajectory-btn" onClick={onCancelFullDetails}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="trajectory-privacy-note">
              Inputs and outputs are hidden in summary mode.
              <div className="trajectory-privacy-actions">
                <button type="button" className="trajectory-btn" onClick={onRequestFullDetails}>
                  Load full details
                </button>
              </div>
            </div>
          )
        ) : null}
      </div>
    </>
  );

  if (mobile) {
    return (
      <div className="trajectory-sheet" role="dialog" aria-label={`Record ${record.kind}`}>
        <button type="button" className="trajectory-sheet-close" aria-label="Close inspector" onClick={onClose}>
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
        {content}
      </div>
    );
  }
  return <aside className="trajectory-inspector">{content}</aside>;
}
