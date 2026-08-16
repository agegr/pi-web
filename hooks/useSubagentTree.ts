"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SubagentLifecycleState, SubagentTreeNode, SubagentTreeResponse, SubagentControlResponse } from "@/lib/api-types";

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

/**
 * Transcript refresh generation: advances only while a descendant is active,
 * plus one final bump when active work settles so the selected child
 * transcript gets a last refresh. Terminal-to-terminal and initial-terminal
 * snapshots leave the generation unchanged.
 */
export function nextTranscriptGeneration(
  previous: SubagentTreeResponse | null,
  next: SubagentTreeResponse | null,
  current: number,
): number {
  if (!next) return current;
  const wasActive = previous ? hasActiveDescendant(previous.nodes) : false;
  const isActive = hasActiveDescendant(next.nodes);
  return isActive || (wasActive && !isActive) ? current + 1 : current;
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
    // Coalesce concurrent refreshes: one in-flight fetch serves all callers.
    if (inFlightRef.current) return inFlightRef.current;
    const generation = ++generationRef.current;
    setLoading(true);
    inFlightRef.current = (async () => {
      try {
        const response = await fetch(`/api/agent/${encodeURIComponent(rootId)}/subagents`, {
          cache: "no-store",
        });
        if (generation !== generationRef.current) return; // stale response
        if (response.status === 504) {
          const body = await response.json().catch(() => ({})) as {
            fallback?: SubagentTreeResponse;
            busy?: boolean;
          };
          const fallback = body.fallback ?? null;
          const busy = body.busy === true;
          setData((previous) => {
            // Keep the last live snapshot; adopt the durable fallback only when
            // there is nothing newer to preserve.
            if (previous) return previous;
            return fallback;
          });
          // A busy parent often misses the 3s RPC window; keep polling quietly.
          setStale(!busy);
          setError(busy ? null : "subagent status timeout");
          return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const tree = await response.json() as SubagentTreeResponse;
        if (generation !== generationRef.current) return;
        // The generation bump must stay outside the state updater (pure updaters).
        setTranscriptRefreshGeneration((current) => nextTranscriptGeneration(dataRef.current, tree, current));
        setData(tree);
        setStale(false);
        setError(null);
      } catch (refreshError) {
        if (generation !== generationRef.current) return;
        setStale(true);
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      } finally {
        if (generation === generationRef.current) setLoading(false);
      }
    })();
    const pending = inFlightRef.current;
    void pending.finally(() => {
      if (inFlightRef.current === pending) inFlightRef.current = null;
    });
    return pending;
  }, [rootId]);

  const pollEligible = shouldPollSubagents({
    treeOpen,
    childSelected,
    hasActiveDescendant: hasActiveDescendant(data?.nodes),
  });

  // Invalidate any in-flight request for a previous root and clear its visible
  // state so stale responses can never publish for the newly selected root.
  useEffect(() => {
    generationRef.current += 1;
    inFlightRef.current = null;
    dataRef.current = null;
    setData(null);
    setStale(false);
    setError(null);
  }, [rootId]);

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

  // The server's POST response carries the post-control tree; adopt it directly
  // instead of issuing a second GET. Transcript generation advances exactly as
  // a successful refresh would.
  const adoptSnapshot = useCallback((tree: SubagentTreeResponse): void => {
    setTranscriptRefreshGeneration((current) => nextTranscriptGeneration(dataRef.current, tree, current));
    setData(tree);
    setStale(false);
    setError(null);
  }, []);

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
    const controlBody = body as SubagentControlResponse;
    if (controlBody.data.tree) {
      adoptSnapshot(controlBody.data.tree);
    } else {
      await refresh();
    }
  }, [rootId, refresh, adoptSnapshot]);

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
