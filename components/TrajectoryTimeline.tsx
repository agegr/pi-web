"use client";

import { useMemo } from "react";
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
const LANE_LABELS: Record<LaneKind, string> = {
  model: "Model",
  tool: "Tools",
  subagent: "Subagents",
  compaction: "Compaction",
};

function laneOf(record: TrajectoryRecordView): LaneKind | null {
  switch (record.kind) {
    case "request_start":
    case "request_first_token":
    case "request_end":
      return "model";
    case "tool_start":
    case "tool_end":
      return "tool";
    case "subagent_link":
      return "subagent";
    case "compaction_start":
    case "compaction_end":
      return "compaction";
    default:
      return null;
  }
}

export function TrajectoryTimeline({ records, selectedId, onSelect }: TrajectoryTimelineProps) {
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
    return <div className="trajectory-timeline trajectory-timeline-empty">Timing overview</div>;
  }

  const { min, max, byLane } = segments;
  const span = max - min;
  const left = (timestamp: number) => `${((timestamp - min) / span) * 100}%`;
  const width = (start: number, end: number) => `${((end - start) / span) * 100}%`;

  return (
    <div className="trajectory-timeline">
      <div className="trajectory-timeline-head">
        <span>Timing overview</span>
        <span className="trajectory-timeline-hint">Click a span to inspect</span>
      </div>
      <div className="trajectory-timeline-lanes">
        {LANE_KINDS.map((lane) => (
          <div className={`trajectory-lane trajectory-lane-${lane}`} key={lane}>
            <span className="trajectory-lane-label">{LANE_LABELS[lane]}</span>
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
                      aria-label={`${record.summary} (running)`}
                      title={`${record.summary} (running)`}
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
