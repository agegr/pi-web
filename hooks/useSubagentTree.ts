"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SubagentLifecycleState, SubagentTreeNode, SubagentTreeResponse } from "@/lib/api-types";

// ============================================================================
// Root-scoped subagent tree polling and controls.
//
// The browser polls the root API only while the tree is open, a subagent
// session is selected, or the last snapshot contains an active descendant.
// Controls never optimistically mutate lifecycle state; the server response
// decides.
// ============================================================================

export const SUBAGENT_POLL_INTERVAL_MS = 1_500;

const ACTIVE_STATES = new Set<SubagentLifecycleState>(["starting", "queued", "running", "needs_attention"]);

export function shouldPollSubagents(input: {
  treeOpen: boolean;
  childSelected: boolean;
  hasActiveDescendant: boolean;
}): boolean {
  return input.treeOpen || input.childSelected || input.hasActiveDescendant;
}

export function hasActiveDescendant(nodes: SubagentTreeNode[] | undefined): boolean {
  if (!nodes) return false;
  for (const node of nodes) {
    if (ACTIVE_STATES.has(node.state)) return true;
    if (hasActiveDescendant(node.children)) return true;
  }
  return false;
}

/** One extra transcript refresh generation when active work settles. */
export function nextTranscriptGeneration(
  previous: SubagentTreeResponse | null,
  next: SubagentTreeResponse | null,
  current: number,
): number {
  const wasActive = previous ? hasActiveDescendant(previous.nodes) : false;
  // A missing snapshot is not evidence of settlement: only a real terminal
  // tree triggers the final transcript refresh.
  const isActive = next ? hasActiveDescendant(next.nodes) : true;
  return wasActive && !isActive ? current + 1 : current;
}

interface ControlErrorBody {
  error?: string;
}

export function useSubagentTree(input: {
  rootId: string | null;
  treeOpen: boolean;
  childSelected: boolean;
}): {
  data: SubagentTreeResponse | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
  transcriptRefreshGeneration: number;
  refresh(): Promise<void>;
  control(action: "steer" | "interrupt" | "resume", childSessionId: string, message?: string): Promise<void>;
} {
  const { rootId, treeOpen, childSelected } = input;
  const [data, setData] = useState<SubagentTreeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptRefreshGeneration, setTranscriptRefreshGeneration] = useState(0);

  const generationRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const dataRef = useRef<SubagentTreeResponse | null>(null);
  dataRef.current = data;

  const refresh = useCallback(async (): Promise<void> => {
    if (!rootId) return;
    const generation = ++generationRef.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/agent/${encodeURIComponent(rootId)}/subagents`, {
        cache: "no-store",
      });
      if (generation !== generationRef.current) return; // stale response
      if (response.status === 504) {
        const body = await response.json().catch(() => ({})) as { fallback?: SubagentTreeResponse };
        const fallback = body.fallback ?? null;
        setData((previous) => {
          // Keep the last live snapshot; adopt the durable fallback only when
          // there is nothing newer to preserve.
          if (previous) return previous;
          return fallback;
        });
        setStale(true);
        setError("subagent status timeout");
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const tree = await response.json() as SubagentTreeResponse;
      if (generation !== generationRef.current) return;
      setData((previous) => {
        setTranscriptRefreshGeneration((current) => nextTranscriptGeneration(previous, tree, current));
        return tree;
      });
      setStale(false);
      setError(null);
    } catch (refreshError) {
      if (generation !== generationRef.current) return;
      setStale(true);
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [rootId]);

  const pollEligible = shouldPollSubagents({
    treeOpen,
    childSelected,
    hasActiveDescendant: hasActiveDescendant(data?.nodes),
  });

  // Immediate refresh on root change; a single interval while eligible.
  useEffect(() => {
    if (!rootId) return;
    void refresh();
    if (!pollEligible) return;
    const timer = setInterval(() => {
      void refresh();
    }, SUBAGENT_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [rootId, pollEligible, refresh]);

  // Clear stale state for a different root.
  useEffect(() => {
    setStale(false);
    setError(null);
  }, [rootId]);

  const control = useCallback(async (
    action: "steer" | "interrupt" | "resume",
    childSessionId: string,
    message?: string,
  ): Promise<void> => {
    if (!rootId) throw new Error("No subagent root session");
    const response = await fetch(`/api/agent/${encodeURIComponent(rootId)}/subagents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        childSessionId,
        action,
        ...(message !== undefined ? { message } : {}),
      }),
    });
    const body = await response.json().catch(() => ({})) as ControlErrorBody;
    if (!response.ok || body.error) {
      throw new Error(body.error ?? `HTTP ${response.status}`);
    }
    // The server response is authoritative; never mutate lifecycle locally.
    await refresh();
  }, [rootId, refresh]);

  return {
    data,
    loading,
    stale,
    error,
    transcriptRefreshGeneration,
    refresh,
    control,
  };
}
