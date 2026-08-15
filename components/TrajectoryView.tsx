"use client";

import { useMemo, type ReactNode } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useTrajectory } from "@/hooks/useTrajectory";
import type { TrajectoryRecordView } from "@/lib/api-types";
import { TrajectoryInspector } from "./TrajectoryInspector";
import { TrajectoryLedger } from "./TrajectoryLedger";
import { TrajectoryTimeline, formatDuration } from "./TrajectoryTimeline";

export interface TrajectoryViewProps {
  sessionId: string;
  leafId: string | null;
  trajectoryVersion: number;
  /** Existing composer element owned by ChatWindow; rendered at the bottom. */
  composer?: ReactNode;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="trajectory-metric">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

const tokenFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function TrajectoryView({ sessionId, leafId, trajectoryVersion, composer }: TrajectoryViewProps) {
  const mobile = useIsMobile();
  const trajectory = useTrajectory({ sessionId, leafId, trajectoryVersion });
  const {
    data,
    loading,
    error,
    selectedId,
    select,
    fullDetailsPending,
    requestFullDetails,
    confirmFullDetails,
    cancelFullDetails,
    expandedChildren,
    expandSubagent,
  } = trajectory;

  const selectedRecord = useMemo(
    () => data?.records.find((record) => record.id === selectedId) ?? null,
    [data, selectedId],
  );

  const handleExpandSubagent = (record: TrajectoryRecordView) => {
    if (!record.childSessionId) return;
    void expandSubagent(record.childSessionId);
  };

  let body: ReactNode;
  if (error) {
    body = <div className="trajectory-state" role="alert">{error}</div>;
  } else if (!data) {
    body = (
      <div className="trajectory-state">
        {loading ? "Loading trajectory…" : "No trajectory data yet. Ask Pi something to start recording."}
      </div>
    );
  } else {
    const stats = data.stats;
    body = (
      <>
        <div className="trajectory-summarybar">
          <Metric label="Requests" value={stats.requests} />
          <Metric label="Tools" value={stats.tools} />
          <Metric label="Tokens" value={tokenFormatter.format(stats.tokens.total)} />
          <Metric label="Active" value={formatDuration(stats.totalActiveMs)} />
          <Metric label="Compactions" value={stats.compactions} />
          <Metric label="Retries" value={stats.retries} />
        </div>
        <TrajectoryTimeline records={data.records} selectedId={selectedId} onSelect={select} />
        <div className="trajectory-body">
          <TrajectoryLedger
            records={data.records}
            selectedId={selectedId}
            onSelect={select}
            onExpandSubagent={handleExpandSubagent}
            childTrajectories={expandedChildren}
          />
          {!mobile ? (
            <TrajectoryInspector
              mobile={false}
              record={selectedRecord}
              fullDetailsAvailable={data.detailLevel === "summary"}
              fullDetailsPending={fullDetailsPending}
              onRequestFullDetails={requestFullDetails}
              onConfirmFullDetails={() => void confirmFullDetails()}
              onCancelFullDetails={cancelFullDetails}
              onClose={() => select(null)}
            />
          ) : null}
        </div>
        {mobile && selectedRecord ? (
          <TrajectoryInspector
            mobile
            record={selectedRecord}
            fullDetailsAvailable={data.detailLevel === "summary"}
            fullDetailsPending={fullDetailsPending}
            onRequestFullDetails={requestFullDetails}
            onConfirmFullDetails={() => void confirmFullDetails()}
            onCancelFullDetails={cancelFullDetails}
            onClose={() => select(null)}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className="trajectory-view">
      {body}
      {composer ? <div className="trajectory-composer">{composer}</div> : null}
    </div>
  );
}
