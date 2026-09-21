"use client";

import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { PaneHeader } from "./PaneHeader";
import { useI18n } from "@/hooks/useI18n";
import {
  isPlainClick,
  paneWidth,
  MIN_PANE_WIDTH,
  type PaneTab,
} from "@/lib/pane-state";

export interface SplitPaneLayoutHandle {
  scrollPaneIntoView: (sessionId: string) => void;
}

interface SplitPaneLayoutProps {
  tabs: PaneTab[];
  focusedId: string | null;
  runningSessionIds: ReadonlySet<string>;
  onFocusPane: (sessionId: string) => void;
  onClosePane: (sessionId: string) => void;
  /** Opens (or focuses) the new-session tab; raised by the strip's "+". */
  onOpenNewSessionTab: () => void;
  renderPane: (sessionId: string, focused: boolean) => React.ReactNode;
}

const STRIP_HEIGHT = 36;

export const SplitPaneLayout = forwardRef<SplitPaneLayoutHandle, SplitPaneLayoutProps>(
function SplitPaneLayoutInner(
  {
    tabs,
    focusedId,
    runningSessionIds,
    onFocusPane,
    onClosePane,
    onOpenNewSessionTab,
    renderPane,
  },
  ref,
) {
  const { t } = useI18n();
  const newSessionLabel = t("tabs.newSession");
  const paneContainerRef = useRef<HTMLDivElement>(null);
  const paneRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Width-adaptive sizing (pi#20): the layout self-measures its pane area via
  // a ResizeObserver on the scroll container, so widths recompute in real
  // time on window resize, sidebar toggle, or any layout change. A single
  // pane takes the full row; with multiple panes each gets an equal split of
  // the measured area while they all fit, and beyond floor(area / MIN_PANE_WIDTH)
  // every pane is exactly MIN_PANE_WIDTH and the pane area scrolls
  // horizontally. (pi#4 integration fix retained: a lone narrow pane cramped
  // the chat and put fixed-width overlays' click targets over the minimap.)
  const [paneAreaWidth, setPaneAreaWidth] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );

  useEffect(() => {
    const container = paneContainerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setPaneAreaWidth(container.clientWidth);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const width = paneWidth(tabs.length, paneAreaWidth, MIN_PANE_WIDTH);

  const scrollPaneIntoView = useCallback((sessionId: string) => {
    const container = paneContainerRef.current;
    const pane = paneRefs.current.get(sessionId);
    if (!container || !pane) return;
    const left = pane.offsetLeft;
    container.scrollTo({ left, behavior: "smooth" });
  }, []);

  useImperativeHandle(ref, () => ({ scrollPaneIntoView }), [scrollPaneIntoView]);

  // Blocker 2 fix: check the selection at pointerUP (a fresh drag starts with
  // an empty selection at pointerdown, so checking there misses the drag).
  const handlePanePointerUp = useCallback(
    (sessionId: string) => {
      const hadSelection = Boolean(window.getSelection()?.toString());
      if (isPlainClick(hadSelection)) {
        onFocusPane(sessionId);
      }
    },
    [onFocusPane],
  );

  const tabStrip = useMemo(
    () => (
      <div
        role="tablist"
          data-split-tablist="true"
        style={{
          display: "flex",
          alignItems: "stretch",
          height: STRIP_HEIGHT,
          flexShrink: 0,
          overflowX: "auto",
          overflowY: "hidden",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          scrollbarWidth: "thin",
        }}
      >
        {tabs.map((tab) => (
          <PaneHeader
            key={tab.sessionId}
            label={tab.label}
            running={runningSessionIds.has(tab.sessionId)}
            hasBadge={tab.hasBadge}
            focused={tab.sessionId === focusedId}
            onClick={() => {
              scrollPaneIntoView(tab.sessionId);
              onFocusPane(tab.sessionId);
            }}
            onClose={() => onClosePane(tab.sessionId)}
          />
        ))}
        {/* Persistent "+" at the end of the strip (pi#21): opens the
            new-session tab, or focuses it when one is already open. A real
            button so it stays keyboard reachable. */}
        <button
          type="button"
          onClick={onOpenNewSessionTab}
          title={newSessionLabel}
          aria-label={newSessionLabel}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: "100%",
            padding: 0,
            flexShrink: 0,
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 13,
            lineHeight: 1,
            transition: "color 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <line x1="6" y1="2" x2="6" y2="10" />
            <line x1="2" y1="6" x2="10" y2="6" />
          </svg>
        </button>
      </div>
    ),
    [tabs, focusedId, runningSessionIds, onFocusPane, onClosePane, onOpenNewSessionTab, scrollPaneIntoView, newSessionLabel],
  );

  const paneArea = useMemo(
    () => (
      <div
        ref={paneContainerRef}
        style={{
          flex: "1 1 0",
          display: "flex",
          flexDirection: "row",
          overflowX: "auto",
          overflowY: "hidden",
          minHeight: 0,
        }}
      >
        {tabs.map((tab) => (
          <div
            key={tab.sessionId}
            ref={(el) => {
              if (el) paneRefs.current.set(tab.sessionId, el);
              else paneRefs.current.delete(tab.sessionId);
            }}
            onPointerUp={() => handlePanePointerUp(tab.sessionId)}
            style={{
              width: `${width}px`,
              flex: "none",
              minWidth: 0,
              height: "100%",
              overflow: "hidden",
              borderRight: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {renderPane(tab.sessionId, tab.sessionId === focusedId)}
          </div>
        ))}
      </div>
    ),
    [tabs, focusedId, width, renderPane, handlePanePointerUp],
  );

  return (
    <div style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      {tabStrip}
      {paneArea}
    </div>
  );
}
);
