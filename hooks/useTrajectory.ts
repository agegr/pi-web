"use client";

// Browser-side trajectory data hook. Consumes the existing agent SSE only
// through the `trajectoryVersion` prop (forwarded by useAgentSession); it
// never opens its own EventSource.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  TrajectoryResponse,
  TrajectoryUnsupportedResponse,
} from "@/lib/api-types";

export interface UseTrajectoryOptions {
  sessionId: string | null;
  leafId: string | null;
  trajectoryVersion: number;
}

export function useTrajectory({ sessionId, leafId, trajectoryVersion }: UseTrajectoryOptions) {
  const [data, setData] = useState<TrajectoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullDetailsPending, setFullDetailsPending] = useState(false);
  const [expandedChildren, setExpandedChildren] = useState<ReadonlyMap<string, TrajectoryResponse>>(
    () => new Map(),
  );
  const requestSeqRef = useRef(0);

  const fetchTrajectory = useCallback(async (level: "summary" | "full") => {
    if (!sessionId) return;
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ detailLevel: level });
    if (leafId) params.set("leafId", leafId);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/trajectory?${params}`);
      if (seq !== requestSeqRef.current) return; // stale response
      if (res.status === 409) {
        const body = await res.json() as TrajectoryUnsupportedResponse;
        setData(null);
        setError(
          body.session.reason === "no_sidecar"
            ? "Trajectory is not available for sessions created before this feature."
            : "Trajectory is not available for this session.",
        );
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as TrajectoryResponse;
      if (seq !== requestSeqRef.current) return;
      setData(body);
      setSelectedId((current) =>
        current && body.records.some((record) => record.id === current) ? current : null,
      );
    } catch (e) {
      if (seq === requestSeqRef.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [sessionId, leafId]);

  // Refetch whenever the session, branch or live version changes.
  useEffect(() => {
    if (!sessionId) {
      setData(null);
      setError(null);
      return;
    }
    void fetchTrajectory("summary");
  }, [sessionId, leafId, trajectoryVersion, fetchTrajectory]);

  const requestFullDetails = useCallback(() => {
    setFullDetailsPending(true);
  }, []);

  const confirmFullDetails = useCallback(async () => {
    setFullDetailsPending(false);
    await fetchTrajectory("full");
  }, [fetchTrajectory]);

  const cancelFullDetails = useCallback(() => {
    setFullDetailsPending(false);
  }, []);

  const expandSubagent = useCallback(async (childSessionId: string) => {
    if (!childSessionId) return;
    setExpandedChildren((previous) => {
      if (previous.has(childSessionId)) return previous;
      void (async () => {
        try {
          const res = await fetch(
            `/api/sessions/${encodeURIComponent(childSessionId)}/trajectory?detailLevel=summary`,
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.json() as TrajectoryResponse;
          setExpandedChildren((current) => {
            const next = new Map(current);
            next.set(childSessionId, body);
            return next;
          });
        } catch (e) {
          setError(`Failed to load child trajectory: ${e instanceof Error ? e.message : String(e)}`);
        }
      })();
      return previous;
    });
  }, []);

  return {
    data,
    loading,
    error,
    selectedId,
    select: setSelectedId,
    fullDetailsPending,
    requestFullDetails,
    confirmFullDetails,
    cancelFullDetails,
    expandedChildren,
    expandSubagent,
  };
}
