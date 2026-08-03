"use client";

import { useEffect, useRef } from "react";
import { getAgentEventBus } from "@/lib/extensions/event-bus";

/**
 * Auto-reload todo data when the agent's `todo` tool completes in this session.
 *
 * Without this hook, todo consumers (InspectorPanel / TodoBadge / TodoPanel)
 * only re-fetch on mount and after `agentRunning` flips false —
 * which means mid-run todo updates only appear after the agent finishes. With
 * this hook, every `tool_execution_end` for the `todo` tool triggers a reload,
 * so the panel stays in sync while the agent is still working.
 *
 * Re-fetches are debounced (~80ms) so a burst of todo updates in one turn
 * collapses to a single API call.
 */
export function useTodoLiveRefresh(
  sessionId: string | null | undefined,
  reload: () => void | Promise<void>,
) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const bus = getAgentEventBus();
    const off = bus.subscribe("tool_execution_end", (event) => {
      if (event.sessionId !== sessionId) return;
      if (event.toolName !== "todo") return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void reloadRef.current();
      }, 80);
    });
    return () => {
      off();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sessionId]);
}
