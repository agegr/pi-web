"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useTerminal } from "@/hooks/useTerminal";

const DARK_THEME = {
  background: "#0d1117",
  foreground: "#e6edf3",
  cursor: "#e6edf3",
  selectionBackground: "#264f78",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
};

const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#1f2328",
  cursor: "#1f2328",
  selectionBackground: "#b2d7f8",
  red: "#cf222e",
  green: "#116329",
  yellow: "#9a6700",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightRed: "#82071e",
  brightGreen: "#116329",
  brightYellow: "#4d2d00",
  brightBlue: "#0969da",
  brightMagenta: "#8250df",
  brightCyan: "#1b7c83",
  brightWhite: "#6e7781",
};

const HEADER_HEIGHT = 30;
const DRAG_HANDLE_HEIGHT = 5;
const MIN_PANEL_HEIGHT = 110;
const MAX_PANEL_HEIGHT = 640;

interface TerminalPanelProps {
  cwd: string;
  onClose: () => void;
  /** When set, the panel fills its parent and the internal drag-resize is
      disabled; the owning tab bar controls the height (multi-terminal mode). */
  fillHeight?: boolean;
}

export function TerminalPanel({ cwd, onClose, fillHeight = false }: TerminalPanelProps) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { session, status, error, open, write, resize, close } = useTerminal();
  const cwdRef = useRef(cwd);
  const [height, setHeight] = useState(240);

  // Create the xterm instance and shell together; tear both down on unmount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.25,
      fontFamily:
        'var(--font-mono), "Cascadia Mono", Menlo, Consolas, "Courier New", monospace',
      theme: { ...(isDark ? DARK_THEME : LIGHT_THEME) },
      scrollback: 3000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fitAddonRef.current = fit;

    let disposed = false;
    const dataSubscription = term.onData((data) => {
      void write(data);
    });

    const fitNow = () => {
      if (disposed) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      const dims = fit.proposeDimensions();
      if (dims) void resize(dims.cols, dims.rows);
    };

    const initialDims = fit.proposeDimensions();
    void open(cwdRef.current, initialDims?.cols, initialDims?.rows, {
      onData: (chunk) => {
        if (!disposed) term.write(chunk);
      },
      onExit: (exitCode) => {
        if (disposed) return;
        term.write(`\r\n\x1b[90m${t("terminal.exited", { code: exitCode })}\x1b[0m\r\n`);
      },
    });

    const observer = new ResizeObserver(fitNow);
    observer.observe(el);
    window.addEventListener("resize", fitNow);

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("resize", fitNow);
      dataSubscription.dispose();
      if (fitAddonRef.current) {
        // Disposing the addon detaches it from the terminal; the terminal
        // disposal below is enough.
        try { fitAddonRef.current.dispose(); } catch { /* already gone */ }
        fitAddonRef.current = null;
      }
      term.dispose();
      termRef.current = null;
      void close();
    };
    // Mount-time only: the shell keeps running in its original cwd even if the
    // active project changes, and reopening the panel starts a fresh session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep xterm colors in sync with the app theme.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = { ...(isDark ? DARK_THEME : LIGHT_THEME) };
  }, [isDark]);

  // Focus the terminal whenever the panel is shown.
  useEffect(() => {
    termRef.current?.focus();
  }, [status]);

  // Drag the top handle to resize the panel height.
  const handleDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const startY = e.clientY;
    const startHeight = height;
    const onPointerMove = (moveEvent: PointerEvent) => {
      setHeight(Math.min(
        MAX_PANEL_HEIGHT,
        Math.max(MIN_PANEL_HEIGHT, startHeight - (moveEvent.clientY - startY)),
      ));
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const statusLine = status === "starting"
    ? t("terminal.starting")
    : status === "error"
      ? `✕ ${error ?? t("terminal.startError")}`
      : null;

  return (
    <div
      style={{
        flexGrow: fillHeight ? 1 : 0,
        flexShrink: fillHeight ? 1 : 0,
        height: fillHeight ? "100%" : height,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: isDark ? DARK_THEME.background : "#ffffff",
        borderTop: fillHeight ? "none" : "1px solid var(--border)",
        position: "relative",
      }}
    >
      {/* Drag handle (standalone mode only — the tab bar owns resizing) */}
      {!fillHeight && (
      <div
        onPointerDown={handleDrag}
        style={{
          position: "absolute",
          top: -DRAG_HANDLE_HEIGHT,
          left: 0,
          right: 0,
          height: DRAG_HANDLE_HEIGHT,
          cursor: "ns-resize",
          touchAction: "none",
        }}
        title={t("layout.resizeHint")}
      />
      )}
      {/* Header */}
      <div
        style={{
          height: HEADER_HEIGHT,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 4px 0 12px",
          fontSize: 12,
          color: isDark ? "#8b949e" : "#57606a",
          borderBottom: "1px solid var(--border)",
          userSelect: "none",
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
        <span style={{ fontWeight: 500, color: isDark ? "#e6edf3" : "#1f2328", whiteSpace: "nowrap" }}>
          {t("terminal.title", { shell: session?.shellLabel ?? "bash" })}
        </span>
        {session && (
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              minWidth: 0,
            }}
            title={session.cwd}
          >
            {t("terminal.path", { path: session.cwd })}
          </span>
        )}
        {statusLine && (
          <span style={{ marginLeft: "auto", color: status === "error" ? "#dc2626" : "var(--text-muted)", whiteSpace: "nowrap" }}>
            {statusLine}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          title={t("terminal.close")}
          aria-label={t("terminal.close")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 26, padding: 0, marginLeft: "auto",
            background: "none", border: "none", borderRadius: 4,
            color: isDark ? "#8b949e" : "#57606a", cursor: "pointer", flexShrink: 0,
            transition: "color 0.12s, background 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = isDark ? "#e6edf3" : "#1f2328"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = isDark ? "#8b949e" : "#57606a"; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="5" y1="5" x2="19" y2="19" />
            <line x1="19" y1="5" x2="5" y2="19" />
          </svg>
        </button>
      </div>
      {/* Terminal surface */}
      <div style={{ flex: 1, overflow: "hidden", padding: "4px 0 0 8px" }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}