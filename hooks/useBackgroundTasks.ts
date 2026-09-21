"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BgTaskLogsResult, BgTaskSnapshot, BackgroundTasksClientEvent } from "@/lib/types";

/**
 * Terminal-notification dedupe: one browser notification per task id, even
 * when several panes/clients replay the same terminal event. Module-level so
 * the mark survives panel unmounts within the page lifetime.
 */
const notifiedTerminalTaskIds = new Set<string>();

/** Returns true exactly once per task id (the caller should notify on true). */
export function markTerminalNotified(taskId: string): boolean {
  if (notifiedTerminalTaskIds.has(taskId)) return false;
  notifiedTerminalTaskIds.add(taskId);
  return true;
}

export type BackgroundTasksFetchState =
  | { kind: "loading" }
  | { kind: "ready"; tasks: BgTaskSnapshot[] }
  | { kind: "unavailable"; error: string };

/**
 * Panel-facing client state for one session's background tasks. Lists via the
 * API, refetches when the session's own SSE stream reports a change, and
 * exposes bounded log tails plus kill. Sessions without a live wrapper (new
 * sessions, chat-only) surface "unavailable" instead of erroring.
 */
export function useBackgroundTasks(sessionId: string | null, fetchEnabled: boolean) {
  const [state, setState] = useState<BackgroundTasksFetchState>({ kind: "loading" });
  const [logs, setLogs] = useState<Record<string, BgTaskLogsResult>>({});
  const fetchSeq = useRef(0);

  const refresh = useCallback(() => {
    // No live-session HTTP while the panel is closed: the browser logs every
    // non-2xx fetch as a console error, and a package-absent session would
    // spam them. Live updates still arrive over SSE (applyEvent) either way.
    if (!sessionId || !fetchEnabled) return;
    const seq = ++fetchSeq.current;
    setState((prev) => prev.kind === "ready" ? prev : { kind: "loading" });
    fetch(`/api/agent/${encodeURIComponent(sessionId)}/bg-tasks`)
      .then(async (response) => {
        const body = await response.json() as { tasks?: BgTaskSnapshot[]; error?: string };
        if (seq !== fetchSeq.current) return;
        if (!response.ok) {
          setState({ kind: "unavailable", error: body.error ?? `HTTP ${response.status}` });
          return;
        }
        setState({ kind: "ready", tasks: (body.tasks ?? []).filter((task) => typeof task?.id === "string") });
      })
      .catch((error: unknown) => {
        if (seq !== fetchSeq.current) return;
        setState({ kind: "unavailable", error: error instanceof Error ? error.message : String(error) });
      });
  }, [sessionId, fetchEnabled]);

  useEffect(() => {
    if (!sessionId) {
      setState({ kind: "unavailable", error: "no active session" });
      return;
    }
    const seqAtMount = fetchSeq.current;
    refresh();
    return () => { fetchSeq.current = seqAtMount + 1; };
  }, [sessionId, refresh]);

  /** Apply a live event from this session's SSE stream. */
  const applyEvent = useCallback((event: BackgroundTasksClientEvent) => {
    if (event.type === "background_tasks_update") {
      setState({ kind: "ready", tasks: event.tasks });
    } else if (event.type === "background_task_terminal") {
      // The list refresh follows via the update event / manual refresh; the
      // terminal snapshot alone is enough for the notification path.
      refresh();
    }
  }, [refresh]);

  const fetchLogs = useCallback(async (taskId: string, maxBytes?: number) => {
    if (!sessionId) return;
    const params = new URLSearchParams({ ...(maxBytes !== undefined ? { maxBytes: String(maxBytes) } : {}) });
    const response = await fetch(
      `/api/agent/${encodeURIComponent(sessionId)}/bg-tasks/${encodeURIComponent(taskId)}/logs?${params}`,
    );
    const body = await response.json() as (BgTaskLogsResult & { error?: string });
    if (!response.ok) {
      setLogs((prev) => ({ ...prev, [taskId]: { text: body.error ?? `HTTP ${response.status}`, bytesRead: 0, truncated: false, tail: true } }));
      return;
    }
    setLogs((prev) => ({ ...prev, [taskId]: body }));
  }, [sessionId]);

  const killTask = useCallback(async (taskId: string) => {
    if (!sessionId) return;
    const response = await fetch(
      `/api/agent/${encodeURIComponent(sessionId)}/bg-tasks/${encodeURIComponent(taskId)}/kill`,
      { method: "POST" },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? `HTTP ${response.status}`);
    }
    refresh();
  }, [sessionId, refresh]);

  const runningCount = state.kind === "ready" ? state.tasks.filter((task) => task.status === "running").length : 0;

  return { state, logs, runningCount, refresh, applyEvent, fetchLogs, killTask };
}
