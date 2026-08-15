"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onRefreshRequest } from "./refreshBus";

export interface PolledResource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Fetch a Robin endpoint and re-fetch on an interval.
 *
 * Polling is how agent-side writes reach the dashboard: the pi extension
 * mutates the JSON store directly, with no channel back to the browser. An SSE
 * feed driven by `tool_execution_end` would be tighter, but for a personal
 * dashboard the poll is not worth replacing yet.
 *
 * Polling pauses while the tab is hidden, matching how the session sidebar
 * polls /api/agent/running.
 */
export function usePolledResource<T>(url: string, intervalMs = 5000): PolledResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(url);
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
      if (!mounted.current) return;
      setData(body as T);
      setError(null);
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer === undefined) timer = setInterval(() => void refresh(), intervalMs);
    };
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        start();
      } else {
        stop();
      }
    };

    void refresh();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    const unsubscribe = onRefreshRequest(() => void refresh());
    return () => {
      stop();
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh, intervalMs]);

  return { data, error, loading, refresh };
}

/** POST/PATCH/DELETE helper that surfaces the API's error message. */
export async function mutate(url: string, method: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const parsed = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(parsed?.error ?? `Request failed (${response.status})`);
  }
}
