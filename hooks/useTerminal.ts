"use client";

import { useCallback, useRef, useState } from "react";

export interface TerminalSessionInfo {
  id: string;
  pid: number;
  cwd: string;
  shellLabel: string;
  createdAt: number;
  isRunning: boolean;
}

export type TerminalStatus = "idle" | "starting" | "running" | "closed" | "error";

export interface TerminalCallbacks {
  onData(chunk: string): void;
  onExit(exitCode: number): void;
}

const RESIZE_DEBOUNCE_MS = 60;

/**
 * Lifecycle for one in-page terminal: creates the shell server-side, streams
 * its output over SSE, forwards keystrokes and resize events, and tears the
 * process down on close. A generation counter invalidates in-flight requests
 * when the terminal is closed or replaced (e.g. React StrictMode remounts).
 */
export function useTerminal() {
  const [session, setSession] = useState<TerminalSessionInfo | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Refs track latched state so the stable useCallback below never goes stale.
  const sessionRef = useRef<TerminalSessionInfo | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const generationRef = useRef(0);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef<TerminalCallbacks>({ onData: () => {}, onExit: () => {} });

  const discardEventSource = useCallback(() => {
    const es = eventSourceRef.current;
    eventSourceRef.current = null;
    if (es) es.close();
  }, []);

  const updateSession = useCallback((next: TerminalSessionInfo | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const connectStream = useCallback((info: TerminalSessionInfo) => {
    discardEventSource();
    const generation = generationRef.current;
    const es = new EventSource(`/api/terminal/${encodeURIComponent(info.id)}/events`);
    eventSourceRef.current = es;

    es.onopen = () => {
      if (generationRef.current !== generation) return;
      setStatus("running");
      setError(null);
    };

    es.onmessage = (event: MessageEvent<string>) => {
      if (generationRef.current !== generation) return;
      let frame: { type?: string; [key: string]: unknown };
      try {
        frame = JSON.parse(event.data) as { type?: string; [key: string]: unknown };
      } catch {
        return;
      }
      if (frame.type === "data" && typeof frame.data === "string") {
        callbacksRef.current.onData(frame.data);
      } else if (frame.type === "exit") {
        // The process ended: tell the UI and stop reconnecting.
        const exitCode = typeof frame.exitCode === "number" ? frame.exitCode : -1;
        setStatus("closed");
        callbacksRef.current.onExit(exitCode);
        discardEventSource();
      }
    };

    es.onerror = () => {
      if (generationRef.current !== generation) return;
      // EventSource retries transient failures automatically. A CLOSED state
      // means the server rejected the connection (e.g. the session was
      // deleted elsewhere), so reconnecting would only spin forever.
      if (es.readyState === EventSource.CLOSED) {
        setStatus("closed");
        discardEventSource();
      }
    };
  }, [discardEventSource]);

  const open = useCallback((
    cwd: string,
    cols: number | undefined,
    rows: number | undefined,
    callbacks: TerminalCallbacks,
  ) => {
    callbacksRef.current = callbacks;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    discardEventSource();
    updateSession(null);
    setStatus("starting");
    setError(null);

    const body: { cwd: string; cols?: number; rows?: number } = { cwd };
    if (typeof cols === "number" && Number.isFinite(cols)) body.cols = Math.floor(cols);
    if (typeof rows === "number" && Number.isFinite(rows)) body.rows = Math.floor(rows);

    void fetch("/api/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          session?: TerminalSessionInfo;
          error?: string;
        };
        if (generationRef.current !== generation) return;
        if (!response.ok || !data.session) {
          setError(typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
          setStatus("error");
          return;
        }
        updateSession(data.session);
        connectStream(data.session);
      })
      .catch((err: unknown) => {
        if (generationRef.current !== generation) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, [connectStream, discardEventSource, updateSession]);

  const write = useCallback((data: string) => {
    const info = sessionRef.current;
    if (!info) return;
    void fetch(`/api/terminal/${encodeURIComponent(info.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "input", data }),
    }).catch(() => {
      // Transient failure — the shell keeps running; the next keystroke retries.
    });
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    const info = sessionRef.current;
    if (!info) return;
    if (resizeTimerRef.current !== null) clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = setTimeout(() => {
      resizeTimerRef.current = null;
      void fetch(`/api/terminal/${encodeURIComponent(info.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "resize", cols, rows }),
      }).catch(() => {
        // The pty may have exited between debounce and send — safe to ignore.
      });
    }, RESIZE_DEBOUNCE_MS);
  }, []);

  const close = useCallback(() => {
    generationRef.current += 1; // cancel in-flight open/stream work
    discardEventSource();
    const info = sessionRef.current;
    updateSession(null);
    setStatus("closed");
    setError(null);
    if (info) {
      void fetch(`/api/terminal/${encodeURIComponent(info.id)}`, {
        method: "DELETE",
      }).catch(() => {
        // Already gone — nothing to kill.
      });
    }
  }, [discardEventSource, updateSession]);

  return { session, status, error, open, write, resize, close };
}