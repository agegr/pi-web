"use client";

import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal as XTermTerminal } from "@xterm/xterm";
import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";

const TERMINAL_MIN_HEIGHT = 120;
const TERMINAL_MAX_HEIGHT_VH = 0.85;
const TERMINAL_DEFAULT_HEIGHT = 280;
const TERMINAL_HEIGHT_STORAGE_KEY = "pi-terminal-height";
const TERMINAL_TABS_STORAGE_KEY = "pi-terminal-tabs";

interface TerminalTab {
  id: string;
  cwd: string;
}

function readStoredHeight(): number | null {
  try {
    const stored = window.localStorage.getItem(TERMINAL_HEIGHT_STORAGE_KEY);
    if (stored === null) return null;
    const parsed = Number.parseInt(stored, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredHeight(height: number): void {
  try {
    window.localStorage.setItem(TERMINAL_HEIGHT_STORAGE_KEY, String(height));
  } catch {
    // Resizing remains available when storage is unavailable.
  }
}

function readStoredTabs(): { tabs: TerminalTab[]; activeTabId: string | null } {
  try {
    const raw = window.localStorage.getItem(TERMINAL_TABS_STORAGE_KEY);
    if (!raw) return { tabs: [], activeTabId: null };
    const parsed = JSON.parse(raw) as { tabs?: unknown; activeTabId?: unknown };
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.filter((entry): entry is TerminalTab =>
        Boolean(entry)
          && typeof (entry as TerminalTab).id === "string"
          && typeof (entry as TerminalTab).cwd === "string")
      : [];
    const activeTabId = typeof parsed.activeTabId === "string" && tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : (tabs[0]?.id ?? null);
    return { tabs, activeTabId };
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

/** A single live PTY wired to an xterm instance; stays mounted while its tab exists. */
function PtyTerminal({
  ptyId,
  active,
  open,
  onExit,
}: {
  ptyId: string;
  active: boolean;
  open: boolean;
  onExit: (ptyId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTermTerminal | null>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const inputQueueRef = useRef<Promise<void>>(Promise.resolve());
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colsRef = useRef(80);
  const rowsRef = useRef(24);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let observer: ResizeObserver | null = null;
    let disposeResizeListener: (() => void) | null = null;
    let themeObserver: MutationObserver | null = null;

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !containerRef.current) return;

      const rootStyle = getComputedStyle(document.documentElement);
      const fontFamily = rootStyle.getPropertyValue("--font-mono").trim() || "monospace";
      // Colors come from CSS variables that flip with the html.dark class;
      // re-read them when the class changes so theme switches apply live.
      const themeFromCss = () => {
        const style = getComputedStyle(document.documentElement);
        const bg = style.getPropertyValue("--bg").trim() || "#000000";
        const fg = style.getPropertyValue("--text").trim() || "#ffffff";
        return { background: bg, foreground: fg, cursor: fg };
      };

      const term = new Terminal({
        fontFamily,
        fontSize: 12,
        cursorBlink: true,
        scrollback: 5000,
        theme: themeFromCss(),
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      termRef.current = term;
      fitRef.current = () => fitAddon.fit();
      try { fitAddon.fit(); } catch { /* not measurable yet */ }
      colsRef.current = term.cols;
      rowsRef.current = term.rows;

      term.onData((data) => {
        inputQueueRef.current = inputQueueRef.current
          .then(() => fetch(`/api/pty/${ptyId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "input", data }),
          }).then(() => undefined))
          .catch(() => undefined);
      });

      observer = new ResizeObserver(() => {
        if (disposed) return;
        try { fitAddon.fit(); } catch { return; }
        if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = setTimeout(() => {
          void fetch(`/api/pty/${ptyId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "resize", cols: colsRef.current, rows: rowsRef.current }),
          }).catch(() => undefined);
        }, 150);
      });
      observer.observe(containerRef.current);
      const colsListener = term.onResize(({ cols, rows }) => {
        colsRef.current = cols;
        rowsRef.current = rows;
      });
      disposeResizeListener = () => colsListener.dispose();

      themeObserver = new MutationObserver(() => {
        term.options.theme = themeFromCss();
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

      source = new EventSource(`/api/pty/${ptyId}`);
      source.onmessage = (event) => {
        let payload: { type?: string; data?: string };
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        if (payload.type === "start") {
          term.reset();
        } else if (payload.type === "data") {
          term.write(payload.data ?? "");
        } else if (payload.type === "exit") {
          source?.close();
          onExitRef.current(ptyId);
        }
      };
      // CLOSED (not a retryable network error) means the session id is gone
      // — server restart or reclaim — so drop the tab instead of retrying.
      source.onerror = () => {
        if (source && source.readyState === EventSource.CLOSED) {
          source.close();
          onExitRef.current(ptyId);
        }
      };
    })();

    return () => {
      disposed = true;
      source?.close();
      observer?.disconnect();
      themeObserver?.disconnect();
      disposeResizeListener?.();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [ptyId]);

  useEffect(() => {
    if (!open || !active) return;
    // Wait a frame so the panel is displayed before focusing (focus is a
    // no-op inside display:none).
    const raf = requestAnimationFrame(() => termRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, active]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        padding: "4px 8px",
        visibility: active ? "visible" : "hidden",
      }}
    />
  );
}

export function TerminalPanel({
  cwd,
  open,
  onClose,
}: {
  cwd: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [tabs, setTabs] = useState<TerminalTab[]>(() => readStoredTabs().tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(() => readStoredTabs().activeTabId);
  const [height, setHeight] = useState(TERMINAL_DEFAULT_HEIGHT);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const tabsRef = useRef<TerminalTab[]>([]);
  tabsRef.current = tabs;
  const openedOnceRef = useRef(false);

  useEffect(() => {
    const stored = readStoredHeight();
    if (stored !== null) setHeight(stored);
  }, []);

  // Persist the tab list so a page refresh can reconnect to live sessions
  // (the server replays each session's backlog over SSE).
  useEffect(() => {
    try {
      if (tabs.length === 0) window.localStorage.removeItem(TERMINAL_TABS_STORAGE_KEY);
      else window.localStorage.setItem(TERMINAL_TABS_STORAGE_KEY, JSON.stringify({ tabs, activeTabId }));
    } catch {
      // Restore is best-effort when storage is unavailable.
    }
  }, [tabs, activeTabId]);

  // Safety net: the panel stays mounted (hiding keeps sessions alive), so
  // this cleanup only runs on real app teardown.
  useEffect(() => {
    return () => {
      for (const tab of tabsRef.current) {
        void fetch(`/api/pty/${tab.id}`, { method: "DELETE" }).catch(() => undefined);
      }
    };
  }, []);

  // Spawn the first terminal on the first open — unless restored tabs took
  // the slot (they reconnect via SSE on mount).
  useEffect(() => {
    if (!open || openedOnceRef.current) return;
    openedOnceRef.current = true;
    if (tabsRef.current.length === 0) void createTerminal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const createTerminal = useCallback(async () => {
    try {
      const response = await fetch("/api/pty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      const data = await response.json() as { id?: string; cwd?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error ?? `HTTP ${response.status}`);
      const tab: TerminalTab = { id: data.id, cwd: data.cwd ?? "" };
      setTabs((prev) => (prev.some((x) => x.id === tab.id) ? prev : [...prev, tab]));
      setActiveTabId(tab.id);
    } catch {
      // A failed spawn keeps the panel usable; the user can retry via +.
    }
  }, [cwd]);

  const closeTerminal = useCallback((id: string) => {
    void fetch(`/api/pty/${id}`, { method: "DELETE" }).catch(() => undefined);
    setTabs((prev) => {
      const next = prev.filter((tab) => tab.id !== id);
      if (next.length === 0) onClose();
      return next;
    });
    setActiveTabId((cur) => {
      if (cur !== id) return cur;
      const remaining = tabsRef.current.filter((tab) => tab.id !== id);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
  }, [onClose]);

  const handleTerminalExit = useCallback((id: string) => {
    setTabs((prev) => {
      const next = prev.filter((tab) => tab.id !== id);
      if (next.length === 0) onClose();
      return next;
    });
    setActiveTabId((cur) => {
      if (cur !== id) return cur;
      const remaining = tabsRef.current.filter((tab) => tab.id !== id);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
  }, [onClose]);

  const commitHeight = useCallback((candidate: number) => {
    const max = Math.max(TERMINAL_MIN_HEIGHT, Math.floor(window.innerHeight * TERMINAL_MAX_HEIGHT_VH));
    const next = Math.min(max, Math.max(TERMINAL_MIN_HEIGHT, Math.round(candidate)));
    setHeight(next);
    writeStoredHeight(next);
    return next;
  }, []);

  const onHandlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startY: event.clientY, startHeight: height };
  }, [height]);

  const onHandlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setHeight(commitHeight(drag.startHeight + (drag.startY - event.clientY)));
  }, [commitHeight]);

  const onHandlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Capture may already be released.
    }
    commitHeight(height);
  }, [commitHeight, height]);

  const onHandleDoubleClick = useCallback(() => {
    commitHeight(TERMINAL_DEFAULT_HEIGHT);
  }, [commitHeight]);

  return (
    <div style={{ flexShrink: 0, display: open ? "flex" : "none", flexDirection: "column", overflow: "hidden" }}>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("terminal.resize")}
        className="sidebar-explorer-split-handle"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        onDoubleClick={onHandleDoubleClick}
      />
      <div
        style={{
          height,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderTop: "1px solid var(--border)",
          background: "var(--bg)",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* Terminal tab bar — mirrors the right panel tab bar styling */}
        <div style={{
          display: "flex",
          alignItems: "stretch",
          flexShrink: 0,
          height: 36,
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "flex-end", overflowX: "auto", flex: 1, minWidth: 0 }}>
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    height: 36,
                    paddingLeft: 12,
                    paddingRight: 6,
                    borderRight: "1px solid var(--border)",
                    background: isActive ? "var(--bg)" : "var(--bg-panel)",
                    cursor: "pointer",
                    fontSize: 12,
                    color: isActive ? "var(--text)" : "var(--text-muted)",
                    whiteSpace: "nowrap",
                    maxWidth: 180,
                    minWidth: 72,
                    flexShrink: 0,
                    userSelect: "none",
                    transition: "background 0.1s, color 0.1s",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7 }} aria-hidden="true">
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1, fontWeight: isActive ? 500 : 400 }}
                    title={tab.cwd}
                  >
                    {getFileName(tab.cwd) || tab.cwd || "~"}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTerminal(tab.id); }}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 24, height: 24,
                      background: "transparent",
                      border: "none",
                      borderRadius: 4,
                      color: "var(--text-dim)",
                      cursor: "pointer",
                      padding: 0,
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-dim)"; }}
                    title={t("i18n.close")}
                    aria-label={t("i18n.close")}
                  >
                    <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                      <line x1="2" y1="2" x2="8" y2="8" />
                      <line x1="8" y1="2" x2="2" y2="8" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => void createTerminal()}
            title={t("terminal.new")}
            aria-label={t("terminal.new")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, padding: 0,
              background: "none", border: "none", borderLeft: "1px solid var(--border)",
              color: "var(--text-muted)", cursor: "pointer", flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            title={t("terminal.hide")}
            aria-label={t("terminal.hide")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, padding: 0,
              background: "none", border: "none", borderLeft: "1px solid var(--border)",
              color: "var(--text-muted)", cursor: "pointer", flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="5" y1="5" x2="19" y2="19" />
              <line x1="19" y1="5" x2="5" y2="19" />
            </svg>
          </button>
        </div>

        {/* Terminals stay mounted so background tabs keep their scrollback */}
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          {tabs.map((tab) => (
            <PtyTerminal
              key={tab.id}
              ptyId={tab.id}
              active={tab.id === activeTabId}
              open={open}
              onExit={handleTerminalExit}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
