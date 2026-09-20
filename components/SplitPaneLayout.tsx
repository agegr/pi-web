"use client";

import { useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import { PaneHeader } from "./PaneHeader";
import {
  isPlainClick,
  densityWidth,
  type PaneTab,
  type PaneDensity,
} from "@/lib/pane-state";

export interface SplitPaneLayoutHandle {
  scrollPaneIntoView: (sessionId: string) => void;
}

interface SplitPaneLayoutProps {
  tabs: PaneTab[];
  focusedId: string | null;
  density: PaneDensity;
  runningSessionIds: ReadonlySet<string>;
  onFocusPane: (sessionId: string) => void;
  onClosePane: (sessionId: string) => void;
  renderPane: (sessionId: string, focused: boolean) => React.ReactNode;
}

const STRIP_HEIGHT = 36;

export const SplitPaneLayout = forwardRef<SplitPaneLayoutHandle, SplitPaneLayoutProps>(
function SplitPaneLayoutInner(
  {
    tabs,
    focusedId,
    density,
    runningSessionIds,
    onFocusPane,
    onClosePane,
    renderPane,
  },
  ref,
) {
  const paneContainerRef = useRef<HTMLDivElement>(null);
  const paneRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const width = densityWidth(density);

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
      </div>
    ),
    [tabs, focusedId, runningSessionIds, onFocusPane, onClosePane, scrollPaneIntoView],
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
              width,
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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      {tabStrip}
      {paneArea}
    </div>
  );
}
);
