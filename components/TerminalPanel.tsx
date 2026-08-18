"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ITheme, Terminal as XtermTerminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { toTerminalKeyData } from "@/lib/terminal-input";

interface TerminalWireEvent {
  type: "connected" | "output" | "reset" | "exit";
  data?: string;
  exitCode?: number;
  reason?: "detached";
}

/** Either an i18n key, so it re-translates on a locale switch, or a server string. */
type TerminalError = { key: string } | { text: string };

type ExitInfo = { code: number | null; reason?: "detached" };

/**
 * xterm's built-in palette assumes a black background, so on the light theme its
 * `white` and `brightWhite` land invisibly on `--bg` — which is exactly what
 * `ls --color`, npm and vite print with. Both palettes are stated in full, in
 * literal hex: xterm parses these itself and cannot resolve `var()`. The hues
 * are pi's — terracotta, sage, sunkissed, tidal blue — rather than the default
 * VGA set, so terminal output sits in the same palette as the rest of the app.
 */
const DARK_ANSI = {
  black: "#29313c", red: "#e8704f", green: "#5db87a", yellow: "#e8993a",
  blue: "#6a9fcc", magenta: "#a48fc4", cyan: "#67b6c4", white: "#d5d8db",
  brightBlack: "#757d89", brightRed: "#f08b6d", brightGreen: "#79c992", brightYellow: "#f0ad5c",
  brightBlue: "#8fbde3", brightMagenta: "#bda9d8", brightCyan: "#8bd0da", brightWhite: "#ebe7e4",
} satisfies ITheme;

const LIGHT_ANSI = {
  black: "#252f3d", red: "#844f3b", green: "#397a50", yellow: "#a35e19",
  blue: "#4b607c", magenta: "#7a5a86", cyan: "#2f6f74", white: "#5c5752",
  brightBlack: "#8b847d", brightRed: "#b86b52", brightGreen: "#4a8f61", brightYellow: "#b8752b",
  brightBlue: "#5d7695", brightMagenta: "#916f9e", brightCyan: "#3d858a", brightWhite: "#252f3d",
} satisfies ITheme;

/**
 * Keys a soft keyboard cannot produce. The sequences come from the same table the
 * agent's own TUI uses, so there is one definition of what "arrow up" means.
 */
const SOFT_KEYS: { label: string; key: string; ctrl?: boolean }[] = [
  { label: "esc", key: "Escape" },
  { label: "tab", key: "Tab" },
  { label: "^C", key: "c", ctrl: true },
  { label: "^D", key: "d", ctrl: true },
  { label: "^Z", key: "z", ctrl: true },
  { label: "←", key: "ArrowLeft" },
  { label: "↓", key: "ArrowDown" },
  { label: "↑", key: "ArrowUp" },
  { label: "→", key: "ArrowRight" },
];

const PANEL_CSS = `
.pi-term { display: flex; flex-direction: column; height: 100%; background: var(--bg); }
.pi-term-bar {
  display: flex; align-items: center; gap: 8px; flex-shrink: 0;
  height: 28px; padding: 0 6px 0 10px;
  background: var(--bg-panel); border-bottom: 1px solid var(--border);
  font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);
}
.pi-term-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.pi-term-dot[data-state="connecting"] { animation: pi-term-pulse 1.4s ease-in-out infinite; }
@keyframes pi-term-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.pi-term-cwd {
  flex: 1; min-width: 0; overflow: hidden; white-space: nowrap;
  text-overflow: ellipsis; direction: rtl; text-align: left;
}
.pi-term-text-button {
  padding: 2px 7px; border: none; border-radius: var(--control-radius);
  background: none; font-family: var(--font-mono); font-size: 11px;
}
.pi-term-screen { position: relative; flex: 1; min-height: 0; }
.pi-term-host { position: absolute; inset: 0; padding: 8px 4px 8px 10px; }
/* xterm ships an unstyled overlay scrollbar; match the rest of the app. */
.pi-term-host .xterm-viewport { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.pi-term-host .xterm-viewport::-webkit-scrollbar { width: 10px; }
.pi-term-host .xterm-viewport::-webkit-scrollbar-track { background: transparent; }
.pi-term-host .xterm-viewport::-webkit-scrollbar-thumb { background: var(--border); border-radius: 5px; }
.pi-term-host .xterm-viewport::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }
.pi-term-keys {
  display: flex; gap: 5px; flex-shrink: 0; overflow-x: auto;
  padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
  background: var(--bg-panel); border-top: 1px solid var(--border);
  scrollbar-width: none;
}
.pi-term-keys::-webkit-scrollbar { display: none; }
.pi-term-key {
  flex: 0 0 auto; min-width: 40px; height: 32px; padding: 0 10px;
  border: 1px solid var(--border); border-radius: var(--control-radius);
  background: var(--bg); color: var(--text-muted);
  font-family: var(--font-mono); font-size: 13px; line-height: 1;
  cursor: pointer; touch-action: manipulation;
}
.pi-term-key:active { background: var(--bg-selected); color: var(--text); }
.pi-term-footer {
  position: absolute; left: 10px; right: 10px; bottom: 10px;
  display: flex; align-items: center; gap: 10px;
  padding: 7px 8px 7px 11px; border-radius: var(--control-radius);
  background: var(--bg-panel); box-shadow: var(--popover-shadow);
  font-size: 12px;
}
`;

function terminalTheme(): ITheme {
  const dark = document.documentElement.classList.contains("dark");
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    ...(dark ? DARK_ANSI : LIGHT_ANSI),
    background: read("--bg", dark ? "#161d27" : "#ebe7e4"),
    foreground: read("--text", dark ? "#ebe7e4" : "#252f3d"),
    cursor: read("--accent", dark ? "#6a9fcc" : "#335a8c"),
    cursorAccent: read("--bg", dark ? "#161d27" : "#ebe7e4"),
    selectionBackground: read("--terminal-selection", dark ? "#2b3441" : "#dcd8d4"),
  };
}

function exitLabel(translate: (key: string, params?: Record<string, string | number>) => string, exit: ExitInfo): string {
  if (exit.reason === "detached") return translate("terminal.closedDetached");
  return exit.code === null ? translate("terminal.ended") : translate("terminal.exited", { code: exit.code });
}

export function TerminalPanel({
  sessionId,
  terminalId,
  cwd,
  active,
  onExit,
  onRestart,
}: {
  sessionId: string;
  terminalId: string;
  cwd?: string;
  active: boolean;
  onExit?: () => void;
  onRestart?: () => void;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeRef = useRef(active);
  /** Highest server sequence this panel has rendered, for resuming the stream. */
  const lastSeqRef = useRef(0);
  const exitedRef = useRef(false);
  const errorRef = useRef<TerminalError | null>(null);
  const onExitRef = useRef(onExit);
  const translateRef = useRef(t);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<"connecting" | "connected" | "exited" | "error">("connecting");
  const [error, setError] = useState<TerminalError | null>(null);
  const [exitInfo, setExitInfo] = useState<ExitInfo | null>(null);

  // Read through refs inside the effects below so that switching the UI language
  // re-renders the labels instead of tearing down the terminal and its stream.
  onExitRef.current = onExit;
  translateRef.current = t;

  const reportError = useCallback((next: TerminalError) => {
    errorRef.current = next;
    setError(next);
    setStatus("error");
  }, []);

  const clearError = useCallback(() => {
    if (!errorRef.current) return;
    errorRef.current = null;
    setError(null);
    setStatus(exitedRef.current ? "exited" : "connected");
  }, []);

  const markExited = useCallback((exitCode: number | null, reason?: "detached") => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    errorRef.current = null;
    setError(null);
    setStatus("exited");
    const exit: ExitInfo = { code: exitCode, ...(reason ? { reason } : {}) };
    setExitInfo(exit);
    const terminal = terminalRef.current;
    if (terminal) {
      // Nothing is listening any more; let the keystrokes stop rather than POST
      // them at a terminal the server has already forgotten.
      terminal.options.disableStdin = true;
      terminal.options.cursorBlink = false;
      // A block cursor on a dead shell reads as "still waiting for you".
      terminal.write("\x1b[?25l");
      terminal.writeln(`\r\n[${exitLabel(translateRef.current, exit)}]`);
    }
    onExitRef.current?.();
  }, []);

  const pressSoftKey = useCallback((entry: { key: string; ctrl?: boolean }) => {
    const data = toTerminalKeyData({
      key: entry.key,
      altKey: false,
      ctrlKey: Boolean(entry.ctrl),
      metaKey: false,
      shiftKey: false,
    });
    if (!data) return;
    // Route through xterm rather than straight at the transport, so soft keys
    // take the same batching and bookkeeping path as the physical keyboard.
    terminalRef.current?.input(data);
    terminalRef.current?.focus();
  }, []);

  const handleClear = useCallback(() => {
    terminalRef.current?.clear();
    terminalRef.current?.focus();
  }, []);

  useEffect(() => {
    activeRef.current = active;
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      try { fitRef.current?.fit(); } catch { /* panel is still opening */ }
      terminalRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  // Terminal instance, input plumbing and layout. Independent of the stream so
  // that backgrounding a tab drops the connection without losing the screen.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    let inputTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingInput = "";
    let commandQueue = Promise.resolve();
    const commandUrl = `/api/sessions/${encodeURIComponent(sessionId)}/terminal/${encodeURIComponent(terminalId)}`;

    const send = (body: object) => {
      commandQueue = commandQueue.then(async () => {
        const response = await fetch(commandUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error ?? `HTTP ${response.status}`);
        }
        if (!disposed) clearError();
      }).catch((cause) => {
        if (disposed || exitedRef.current) return;
        reportError({ text: cause instanceof Error ? cause.message : String(cause) });
      });
    };

    const flushInput = () => {
      inputTimer = null;
      let data = pendingInput;
      pendingInput = "";
      while (data) {
        let end = Math.min(data.length, 16_384);
        const last = data.charCodeAt(end - 1);
        const next = data.charCodeAt(end);
        if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
        send({ type: "input", data: data.slice(0, end) });
        data = data.slice(end);
      }
    };

    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
        ]);
        if (disposed) return;

        const terminal = new Terminal({
          allowProposedApi: false,
          convertEol: false,
          cursorBlink: true,
          cursorStyle: "block",
          cursorInactiveStyle: "outline",
          fontFamily: getComputedStyle(host).fontFamily,
          fontSize: 13,
          lineHeight: 1.25,
          letterSpacing: 0,
          // Programs pick their own 24-bit colours with no idea what they are
          // drawn on. This keeps those readable on both themes too.
          minimumContrastRatio: 4.5,
          scrollback: 5000,
          theme: terminalTheme(),
        });
        const fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(host);
        terminalRef.current = terminal;
        fitRef.current = fit;

        // Ctrl+C is SIGINT in a terminal, so copy and paste need the shifted
        // bindings every other terminal emulator uses.
        terminal.attachCustomKeyEventHandler((event) => {
          if (event.type !== "keydown" || !event.ctrlKey || !event.shiftKey) return true;
          const key = event.key.toLowerCase();
          if (key === "c" && terminal.hasSelection()) {
            void navigator.clipboard?.writeText(terminal.getSelection());
            return false;
          }
          if (key === "v") {
            void navigator.clipboard?.readText().then((text) => {
              if (text) terminal.paste(text);
            }).catch(() => { /* clipboard read declined */ });
            return false;
          }
          return true;
        });

        themeObserver = new MutationObserver(() => { terminal.options.theme = terminalTheme(); });
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

        terminal.onData((data) => {
          pendingInput += data;
          if (!inputTimer) inputTimer = setTimeout(flushInput, 8);
        });
        terminal.onResize(({ cols, rows }) => send({ type: "resize", columns: cols, rows }));

        observer = new ResizeObserver(() => {
          if (!activeRef.current) return;
          try { fit.fit(); } catch { /* zero-size transition */ }
        });
        observer.observe(host);
        if (activeRef.current) {
          fit.fit();
          terminal.focus();
        }
        setReady(true);
      } catch (cause) {
        if (disposed) return;
        reportError({ text: cause instanceof Error ? cause.message : String(cause) });
      }
    })();

    return () => {
      disposed = true;
      setReady(false);
      if (inputTimer) clearTimeout(inputTimer);
      observer?.disconnect();
      themeObserver?.disconnect();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, terminalId, clearError, reportError]);

  /**
   * Only the visible terminal holds a stream. Browsers cap concurrent HTTP/1.1
   * requests per origin at six, and an SSE response never completes, so one
   * connection per open terminal would starve the agent and file-watch streams
   * and eventually deadlock the app. The server buffers output and replays it
   * from `after`, so a backgrounded tab catches up when it comes forward.
   */
  useEffect(() => {
    if (!ready || !active || exitedRef.current) return;
    const terminal = terminalRef.current;
    if (!terminal) return;

    let closed = false;
    const source = new EventSource(
      `/api/sessions/${encodeURIComponent(sessionId)}/terminal/${encodeURIComponent(terminalId)}`
      + `/events?after=${lastSeqRef.current}`,
    );

    source.onmessage = (event) => {
      if (closed) return;
      const seq = Number(event.lastEventId);
      if (Number.isSafeInteger(seq) && seq > lastSeqRef.current) lastSeqRef.current = seq;
      let message: TerminalWireEvent;
      try {
        message = JSON.parse(event.data) as TerminalWireEvent;
      } catch {
        reportError({ key: "terminal.invalidResponse" });
        return;
      }
      if (message.type === "connected") {
        clearError();
        setStatus("connected");
      } else if (message.type === "reset") {
        // Output the panel never saw has aged out of the server buffer, so what
        // follows does not continue what is on screen. Start from a clean slate.
        terminal.reset();
      } else if (message.type === "output" && typeof message.data === "string") {
        terminal.write(message.data);
      } else if (message.type === "exit") {
        markExited(message.exitCode ?? 0, message.reason);
        source.close();
      }
    };
    source.onerror = () => {
      if (closed || exitedRef.current) return;
      // A closed readyState means the endpoint refused the request rather than
      // the network dropping: the PTY is gone, and no retry will bring it back.
      if (source.readyState === EventSource.CLOSED) markExited(null);
      else reportError({ key: "terminal.disconnected" });
    };

    return () => {
      closed = true;
      source.close();
    };
  }, [sessionId, terminalId, active, ready, clearError, markExited, reportError]);

  const errorMessage = error && ("key" in error ? t(error.key) : error.text);
  const statusLabel = status === "connected"
    ? t("terminal.connected")
    : status === "connecting"
      ? t("terminal.connecting")
      : status === "exited"
        ? (exitInfo ? exitLabel(t, exitInfo) : t("terminal.ended"))
        : errorMessage ?? t("terminal.disconnected");
  const statusColor = {
    connecting: "var(--warning)",
    connected: "var(--success)",
    exited: "var(--text-dim)",
    error: "var(--danger)",
  }[status];

  return (
    <div className="pi-term">
      <style>{PANEL_CSS}</style>
      <div className="pi-term-bar">
        <span className="pi-term-dot" data-state={status} title={statusLabel} aria-label={statusLabel} role="img" style={{ background: statusColor }} />
        {cwd && <span className="pi-term-cwd" title={cwd}><bdi>{cwd}</bdi></span>}
        <button
          type="button"
          className="ui-action pi-term-text-button"
          data-hover="accent"
          onClick={handleClear}
          disabled={!ready}
          title={t("terminal.clear")}
        >
          {t("terminal.clearShort")}
        </button>
      </div>

      <div className="pi-term-screen">
        <div
          ref={hostRef}
          className="pi-term-host"
          role="application"
          aria-label={t("terminal.ariaLabel")}
          style={{ fontFamily: "var(--font-mono)" }}
        />
        {status === "connecting" && (
          <div role="status" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--text-muted)", fontSize: 12, pointerEvents: "none" }}>
            {t("terminal.connecting")}
          </div>
        )}
        {status === "error" && errorMessage && (
          <div role="alert" className="pi-term-footer" style={{ border: "1px solid var(--danger)", color: "var(--danger)" }}>
            <span style={{ flex: 1, minWidth: 0 }}>{errorMessage}</span>
          </div>
        )}
        {status === "exited" && (
          <div role="status" className="pi-term-footer" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
            <span style={{ flex: 1, minWidth: 0 }}>{exitInfo ? exitLabel(t, exitInfo) : t("terminal.ended")}</span>
            {onRestart && (
              <button
                type="button"
                className="ui-action pi-term-text-button"
                data-state="accent"
                data-hover="accent"
                onClick={onRestart}
                style={{ border: "1px solid var(--border)", fontSize: 12, padding: "3px 10px" }}
              >
                {t("terminal.restart")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* A soft keyboard has no Esc, Tab, Ctrl or arrows, which is most of what
          a shell is driven with. */}
      {isMobile && status !== "exited" && (
        <div className="pi-term-keys" role="group" aria-label={t("terminal.softKeys")}>
          {SOFT_KEYS.map((entry) => (
            <button
              key={entry.label}
              type="button"
              className="pi-term-key"
              onClick={() => pressSoftKey(entry)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
