"use client";

import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
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

const ERROR_KEYS: Record<string, string> = {
  no_sidecar: "trajectory.error.noSidecar",
  unavailable: "trajectory.error.unavailable",
  load_failed: "trajectory.error.loadFailed",
};

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
  const { t } = useI18n();
  const mobile = useIsMobile();
  const viewRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
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

  useLayoutEffect(() => {
    const view = viewRef.current;
    const composerEl = composerRef.current;
    if (!view) return;
    if (!composerEl) {
      view.style.setProperty("--trajectory-composer-height", "0px");
      return;
    }
    const apply = () => {
      view.style.setProperty("--trajectory-composer-height", `${composerEl.offsetHeight}px`);
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(composerEl);
    return () => observer.disconnect();
  }, [composer]);

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
    body = <div className="trajectory-state" role="alert">{t(ERROR_KEYS[error] ?? "trajectory.error.loadFailed")}</div>;
  } else if (!data) {
    body = (
      <div className="trajectory-state">
        {loading ? t("trajectory.loading") : t("trajectory.empty")}
      </div>
    );
  } else {
    const stats = data.stats;
    body = (
      <>
        <div className="trajectory-summarybar">
          <Metric label={t("trajectory.metric.requests")} value={stats.requests} />
          <Metric label={t("trajectory.metric.tools")} value={stats.tools} />
          <Metric label={t("trajectory.metric.tokens")} value={tokenFormatter.format(stats.tokens.total)} />
          <Metric label={t("trajectory.metric.active")} value={formatDuration(stats.totalActiveMs)} />
          <Metric label={t("trajectory.metric.compactions")} value={stats.compactions} />
          <Metric label={t("trajectory.metric.retries")} value={stats.retries} />
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
    <div className="trajectory-view" ref={viewRef}>
      {body}
      {composer ? <div className="trajectory-composer" ref={composerRef}>{composer}</div> : null}
    </div>
  );
}
