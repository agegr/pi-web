"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { TrajectoryRecordView } from "@/lib/api-types";

export interface TrajectoryTimelineProps {
  records: TrajectoryRecordView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

type LaneKind = "model" | "tool" | "subagent" | "compaction";
const LANE_KINDS: LaneKind[] = ["model", "tool", "subagent", "compaction"];
const LANE_LABEL_KEYS: Record<LaneKind, string> = {
  model: "trajectory.lane.model",
  tool: "trajectory.lane.tool",
  subagent: "trajectory.lane.subagent",
  compaction: "trajectory.lane.compaction",
};

function laneOf(record: TrajectoryRecordView): LaneKind | null {
  switch (record.kind) {
    case "request_start":
    case "request_first_token":
      return "model";
    case "tool_start":
      return "tool";
    case "subagent_link":
      return "subagent";
    case "compaction_start":
      return "compaction";
    default:
      return null;
  }
}

export function TrajectoryTimeline({ records, selectedId, onSelect }: TrajectoryTimelineProps) {
  const { t } = useI18n();
  const segments = useMemo(() => {
    const usable = records
      .map((record) => ({ record, lane: laneOf(record) }))
      .filter((item): item is { record: TrajectoryRecordView; lane: LaneKind } => item.lane !== null);
    if (usable.length === 0) return null;
    const timestamps = usable.flatMap(({ record }) => [
      record.timestamp,
      record.endTimestamp ?? record.timestamp,
    ]);
    const min = Math.min(...timestamps);
    let max = Math.max(...timestamps);
    if (max - min < 1) max = min + 1;
    const byLane = new Map<LaneKind, TrajectoryRecordView[]>();
    for (const { record, lane } of usable) {
      const list = byLane.get(lane) ?? [];
      list.push(record);
      byLane.set(lane, list);
    }
    return { min, max, byLane };
  }, [records]);

  if (!segments) {
    return <div className="trajectory-timeline trajectory-timeline-empty">{t("trajectory.timeline.title")}</div>;
  }

  const { min, max, byLane } = segments;
  const span = max - min;
  const left = (timestamp: number) => `${((timestamp - min) / span) * 100}%`;
  const width = (start: number, end: number) => `${((end - start) / span) * 100}%`;

  return (
    <div className="trajectory-timeline">
      <div className="trajectory-timeline-head">
        <span>{t("trajectory.timeline.title")}</span>
        <span className="trajectory-timeline-hint">{t("trajectory.timeline.hint")}</span>
      </div>
      <div className="trajectory-timeline-lanes">
        {LANE_KINDS.map((lane) => (
          <div className={`trajectory-lane trajectory-lane-${lane}`} key={lane}>
            <span className="trajectory-lane-label">{t(LANE_LABEL_KEYS[lane])}</span>
            <div className="trajectory-lane-track">
              {(byLane.get(lane) ?? []).map((record) => {
                const selected = record.id === selectedId;
                const end = record.endTimestamp;
                if (end === undefined || end <= record.timestamp) {
                  return (
                    <button
                      key={record.id}
                      type="button"
                      className={`trajectory-span trajectory-span-running${selected ? " is-selected" : ""}`}
                      style={{ left: left(record.timestamp) }}
                      aria-label={`${record.summary} (${t("trajectory.spanRunning")})`}
                      title={`${record.summary} (${t("trajectory.spanRunning")})`}
                      onClick={() => onSelect(record.id)}
                    />
                  );
                }
                return (
                  <button
                    key={record.id}
                    type="button"
                    className={`trajectory-span${selected ? " is-selected" : ""}`}
                    style={{ left: left(record.timestamp), width: width(record.timestamp, end) }}
                    aria-label={record.summary}
                    title={`${record.summary} · ${formatDuration(end - record.timestamp)}`}
                    onClick={() => onSelect(record.id)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
