"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
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

type TabId = "overview" | "input" | "output" | "timing" | "usage";

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="trajectory-detail">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function DetailGrid({ record }: { record: TrajectoryRecordView }) {
  const { t } = useI18n();
  return (
    <div className="trajectory-detail-grid">
      <Detail label={t("trajectory.field.kind")} value={record.kind} />
      <Detail label={t("trajectory.field.status")} value={record.status} />
      <Detail label={t("trajectory.field.started")} value={new Date(record.timestamp).toLocaleTimeString()} />
      {record.endTimestamp !== undefined
        ? <Detail label={t("trajectory.field.ended")} value={new Date(record.endTimestamp).toLocaleTimeString()} />
        : null}
      <Detail label={t("trajectory.field.duration")} value={record.durationMs !== undefined ? formatDuration(record.durationMs) : "—"} />
      {record.turnId ? <Detail label={t("trajectory.field.turn")} value={record.turnId} /> : null}
      {record.requestId ? <Detail label={t("trajectory.field.request")} value={record.requestId} /> : null}
      {record.stepId ? <Detail label={t("trajectory.field.step")} value={record.stepId} /> : null}
      {record.childSessionId ? <Detail label={t("trajectory.field.childSession")} value={record.childSessionId} /> : null}
      <Detail label={t("trajectory.field.summary")} value={record.summary} />
    </div>
  );
}

function Payload({ value }: { value: unknown }) {
  return (
    <pre className="trajectory-payload">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
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
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>("overview");

  if (!record) {
    if (mobile) return null;
    return (
      <aside className="trajectory-inspector trajectory-inspector-empty">
        {t("trajectory.inspectEmpty")}
      </aside>
    );
  }

  const tabs: Array<{ id: TabId; label: string; available: boolean }> = [
    { id: "overview", label: t("trajectory.tab.overview"), available: true },
    { id: "input", label: t("trajectory.tab.input"), available: tabPayload(record, "input") !== null },
    { id: "output", label: t("trajectory.tab.output"), available: tabPayload(record, "output") !== null },
    { id: "timing", label: t("trajectory.tab.timing"), available: true },
    { id: "usage", label: t("trajectory.tab.usage"), available: tabPayload(record, "usage") !== null },
  ];
  const visibleTabs = tabs.filter((item) => item.available);
  const activeTab = visibleTabs.some((item) => item.id === tab) ? tab : "overview";

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
            <Detail label={t("trajectory.field.started")} value={new Date(record.timestamp).toLocaleTimeString()} />
            {record.endTimestamp !== undefined
              ? <Detail label={t("trajectory.field.ended")} value={new Date(record.endTimestamp).toLocaleTimeString()} />
              : null}
            <Detail label={t("trajectory.field.duration")} value={record.durationMs !== undefined ? formatDuration(record.durationMs) : t("trajectory.durationRunning")} />
          </div>
        ) : null}
        {activeTab !== "overview" && activeTab !== "timing" ? <Payload value={tabPayload(record, activeTab)} /> : null}

        {showConfirmation ? (
          fullDetailsPending ? (
            <div className="trajectory-privacy-note">
              {t("trajectory.privacyPending")}
              <div className="trajectory-privacy-actions">
                <button type="button" className="trajectory-btn trajectory-btn-primary" onClick={onConfirmFullDetails}>
                  {t("trajectory.confirmLoad")}
                </button>
                <button type="button" className="trajectory-btn" onClick={onCancelFullDetails}>
                  {t("trajectory.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="trajectory-privacy-note">
              {t("trajectory.privacySummary")}
              <div className="trajectory-privacy-actions">
                <button type="button" className="trajectory-btn" onClick={onRequestFullDetails}>
                  {t("trajectory.loadDetails")}
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
      <div className="trajectory-sheet" role="dialog" aria-label={t("trajectory.recordLabel", { kind: record.kind })}>
        <button type="button" className="trajectory-sheet-close" aria-label={t("trajectory.closeInspector")} onClick={onClose}>
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
        {content}
      </div>
    );
  }
  return <aside className="trajectory-inspector">{content}</aside>;
}
