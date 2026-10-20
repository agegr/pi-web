"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { controlProjectDevClient, notifyProjectDevChanged } from "@/lib/project-dev-client";
import { projectDevBusy, type ProjectDevAction, type ProjectDevEvent, type ProjectDevInfo } from "@/lib/project-dev-types";

interface StateEvent { cwd: string; event: ProjectDevEvent | { type: "error"; error: string } }

function isDocumentVisible(): boolean {
  return document.visibilityState === "visible";
}

export function useProjectDev(cwds: string[]) {
  const signature = JSON.stringify([...new Set(cwds)].sort());
  const roots = useMemo(() => JSON.parse(signature) as string[], [signature]);
  const [projects, setProjects] = useState<Record<string, ProjectDevInfo>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const restartRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (roots.length === 0) {
      setProjects({});
      return;
    }
    let disposed = false;
    let controller: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;

    const schedule = (delay: number) => {
      if (disposed || document.visibilityState === "hidden" || reconnectTimer) return;
      reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(); }, delay);
    };
    const apply = (message: StateEvent) => {
      if (message.event.type === "error") {
        setProjects((previous) => {
          if (!(message.cwd in previous)) return previous;
          const next = { ...previous };
          delete next[message.cwd];
          return next;
        });
        return;
      }
      const event = message.event;
      setProjects((previous) => {
        if (event.type === "log") return previous;
        const nextInfo = event.info;
        return previous[message.cwd] === nextInfo ? previous : { ...previous, [message.cwd]: nextInfo };
      });
    };
    const connect = async () => {
      if (disposed || document.visibilityState === "hidden" || controller) return;
      const current = new AbortController();
      controller = current;
      try {
        const response = await fetch("/api/project-dev/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwds: roots }),
          signal: current.signal,
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || `HTTP ${response.status}`);
        }
        if (!response.body) throw new Error("Project service event stream is unavailable");
        retryDelay = 1000;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!current.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
            if (data) {
              try { apply(JSON.parse(data) as StateEvent); } catch { /* ignore malformed event frames */ }
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch {
        // The next stream starts with fresh snapshots, so transient failures
        // do not require a separate status poll.
      } finally {
        if (controller === current) controller = null;
        if (!disposed && isDocumentVisible()) {
          const delay = current.signal.aborted ? 0 : retryDelay;
          schedule(delay);
          retryDelay = Math.min(retryDelay * 2, 30_000);
        }
      }
    };
    const start = (force = false) => {
      if (disposed || document.visibilityState === "hidden") return;
      if (force) {
        controller?.abort();
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      }
      if (!controller && !reconnectTimer) void connect();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        controller?.abort();
      } else start(true);
    };
    const onFocus = () => start(true);
    restartRef.current = () => start(true);
    void connect();
    window.addEventListener("focus", onFocus);
    window.addEventListener("pi-web:project-dev-changed", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      controller?.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pi-web:project-dev-changed", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [roots]);

  const control = useCallback(async (cwd: string, action: ProjectDevAction, process?: string) => {
    if (pendingRef.current.has(cwd)) return;
    pendingRef.current.add(cwd);
    setPending(new Set(pendingRef.current));
    try {
      const info = await controlProjectDevClient(cwd, action, process);
      setProjects((previous) => ({ ...previous, [cwd]: info }));
      return info;
    } finally {
      pendingRef.current.delete(cwd);
      setPending(new Set(pendingRef.current));
      notifyProjectDevChanged();
    }
  }, []);
  const busy = useCallback((cwd: string) => pending.has(cwd) || projectDevBusy(projects[cwd]?.status), [pending, projects]);
  const refresh = useCallback(() => restartRef.current(), []);
  return { projects, control, busy, pending, refresh };
}
