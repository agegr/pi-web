"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useI18n } from "@/hooks/useI18n";

type ServerEvent = { type: "output"; data: string } | { type: "exit"; exitCode: number };

export function TerminalPanel({ cwd }: { cwd: string }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalIdRef = useRef<string | null>(null);
  const exitedRef = useRef(false);
  const inputBufferRef = useRef("");
  const inputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [restartKey, setRestartKey] = useState(0);
  const [status, setStatus] = useState<"connecting" | "ready" | "exited" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);

  const post = useCallback((id: string, body: Record<string, unknown>) => {
    void fetch(`/api/terminal/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let events: EventSource | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let onData: { dispose(): void } | null = null;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "var(--font-mono)",
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 8000,
      theme: {
        background: "#111318",
        foreground: "#d7dce5",
        cursor: "#60a5fa",
        selectionBackground: "#365b8a",
        black: "#1d222b", red: "#f87171", green: "#4ade80", yellow: "#facc15",
        blue: "#60a5fa", magenta: "#c084fc", cyan: "#22d3ee", white: "#e5e7eb",
        brightBlack: "#6b7280", brightRed: "#fca5a5", brightGreen: "#86efac",
        brightYellow: "#fde047", brightBlue: "#93c5fd", brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9", brightWhite: "#ffffff",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "v") return false;
      if ((event.ctrlKey || event.metaKey) && key === "c" && terminal.hasSelection()) return false;
      return true;
    });

    const flushInput = () => {
      inputTimerRef.current = null;
      const id = terminalIdRef.current;
      const data = inputBufferRef.current;
      inputBufferRef.current = "";
      if (id && data) post(id, { type: "input", data });
    };
    onData = terminal.onData((data) => {
      inputBufferRef.current += data;
      if (!inputTimerRef.current) inputTimerRef.current = setTimeout(flushInput, 8);
    });

    const fitAndResize = () => {
      if (!container.offsetWidth || !container.offsetHeight) return;
      try {
        fit.fit();
        const id = terminalIdRef.current;
        if (id) post(id, { type: "resize", cols: terminal.cols, rows: terminal.rows });
      } catch { /* hidden during layout transition */ }
    };

    const start = async () => {
      setStatus("connecting");
      exitedRef.current = false;
      setError(null);
      fit.fit();
      const response = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, cols: terminal.cols, rows: terminal.rows }),
      });
      const data = await response.json() as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (disposed) {
        void fetch(`/api/terminal/${encodeURIComponent(data.id)}`, { method: "DELETE", keepalive: true });
        return;
      }
      terminalIdRef.current = data.id;
      events = new EventSource(`/api/terminal/${encodeURIComponent(data.id)}/events`);
      events.onmessage = (message) => {
        const event = JSON.parse(message.data) as ServerEvent;
        if (event.type === "output") terminal.write(event.data);
        else {
          exitedRef.current = true;
          setStatus("exited");
        }
      };
      events.onopen = () => {
        setStatus("ready");
        terminal.focus();
      };
      events.onerror = () => {
        if (!disposed && !exitedRef.current) setStatus("error");
      };
      resizeObserver = new ResizeObserver(fitAndResize);
      resizeObserver.observe(container);
    };

    void start().catch((reason: unknown) => {
      if (disposed) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      setStatus("error");
      terminal.writeln(`\x1b[31m${message}\x1b[0m`);
    });

    return () => {
      disposed = true;
      if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
      inputTimerRef.current = null;
      inputBufferRef.current = "";
      events?.close();
      resizeObserver?.disconnect();
      onData?.dispose();
      const id = terminalIdRef.current;
      terminalIdRef.current = null;
      if (id) void fetch(`/api/terminal/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true });
      terminal.dispose();
    };
  }, [cwd, post, restartKey]);

  return (
    <section className="terminal-panel" aria-label={t("chat.shell")}>
      <header className="terminal-panel-header">
        <div className="terminal-panel-path">
          <span className={`terminal-status-dot is-${status}`} />
          <span>{cwd}</span>
        </div>
        <button type="button" onClick={() => setRestartKey((value) => value + 1)} title={t("i18n.refresh")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.34 5.66" /><polyline points="20 4 20 11 13 11" />
          </svg>
          {t("i18n.refresh")}
        </button>
      </header>
      {error && <div className="terminal-panel-error" role="alert">{error}</div>}
      <div ref={containerRef} className="terminal-xterm" />
    </section>
  );
}
