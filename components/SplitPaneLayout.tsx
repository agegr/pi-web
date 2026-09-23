"use client";

import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { PaneHeader } from "./PaneHeader";
import { useI18n } from "@/hooks/useI18n";
import { useChatAppearance } from "@/hooks/useChatAppearance";
import {
  isPlainClick,
  paneWidth,
  paneHeaderLabel,
  visiblePaneCapacity,
  minPaneWidthFor,
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
  renderPane: (sessionId: string, focused: boolean) => React.ReactNode;
}

// Embedded pane headers (pi#25): the old shared tab strip is gone. Each pane
// column renders its own PaneHeader as its first row, and the pane area
// itself owns the tablist semantics (role="tablist" on the pane area, the
// headers are its role="tab" descendants, each controlling the tabpanel that
// is its sibling content wrapper). New sessions are opened exclusively from
// the sidebar — there is no strip "+" anymore.
export const SplitPaneLayout = forwardRef<SplitPaneLayoutHandle, SplitPaneLayoutProps>(
function SplitPaneLayoutInner(
  {
    tabs,
    focusedId,
    runningSessionIds,
    onFocusPane,
    onClosePane,
    renderPane,
  },
  ref,
) {
  const { t } = useI18n();
  const paneContainerRef = useRef<HTMLDivElement>(null);
  const paneRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);

  // Width-adaptive sizing (pi#20): the layout self-measures its pane area via
  // a ResizeObserver on the scroll container, so widths recompute in real
  // time on window resize, sidebar toggle, or any layout change. A single
  // pane takes the full row; with multiple panes each gets an equal split of
  // the measured area while they all fit, and beyond floor(area / minPaneWidth)
  // every pane is exactly minPaneWidth and the pane area scrolls
  // horizontally. (pi#4 integration fix retained: a lone narrow pane cramped
  // the chat and put fixed-width overlays' click targets over the minimap.)
  // pi#43: the minimum is derived from the chat content width setting
  // (reading width + pane padding), and useChatAppearance is
  // useSyncExternalStore-based, so moving the settings slider re-lays out
  // open panes in the same render pass.
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

  // pi#43: the pane minimum follows the live chat content width setting, so
  // every pane is at least as wide as the user's configured reading width.
  const { width: chatContentWidth } = useChatAppearance();
  const minPaneWidth = minPaneWidthFor(chatContentWidth);
  const width = paneWidth(tabs.length, paneAreaWidth, minPaneWidth);
  // Overflow switcher (pi#25): shown only when the open count exceeds the
  // area's capacity — the same floor(areaWidth / minPaneWidth) computation
  // paneWidth() sizes panes by.
  const paneCapacity = visiblePaneCapacity(paneAreaWidth, minPaneWidth);
  const overflowed = tabs.length > paneCapacity;

  // Close the overflow dropdown whenever it stops being needed.
  useEffect(() => {
    if (!overflowed) setOverflowOpen(false);
  }, [overflowed]);

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

  const activateOverflowEntry = useCallback(
    (sessionId: string) => {
      setOverflowOpen(false);
      scrollPaneIntoView(sessionId);
      onFocusPane(sessionId);
      overflowTriggerRef.current?.focus();
    },
    [scrollPaneIntoView, onFocusPane],
  );

  // Focus the first menu item when the dropdown opens via keyboard or click,
  // so arrow-key navigation starts inside the menu.
  useEffect(() => {
    if (!overflowOpen) return;
    const first = overflowMenuRef.current?.querySelector<HTMLElement>("[role='menuitem']");
    first?.focus();
  }, [overflowOpen]);

  const handleOverflowMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOverflowOpen(false);
        overflowTriggerRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = Array.from(
        overflowMenuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [],
      );
      if (items.length === 0) return;
      const current = items.findIndex((item) => item === document.activeElement);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = items[(current + delta + items.length) % items.length];
      next?.focus();
    },
    [],
  );

  return (
    <div style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", position: "relative" }}>
      <div
        ref={paneContainerRef}
        role="tablist"
        data-split-pane-area="true"
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
            <PaneHeader
              id={`pane-tab-${tab.sessionId}`}
              label={paneHeaderLabel(tab)}
              running={runningSessionIds.has(tab.sessionId)}
              hasBadge={tab.hasBadge}
              focused={tab.sessionId === focusedId}
              onClick={() => {
                scrollPaneIntoView(tab.sessionId);
                onFocusPane(tab.sessionId);
              }}
              onClose={() => onClosePane(tab.sessionId)}
            />
            {/* The pane's tabpanel: the embedded header's controlled region.
                A flex column so the pane content (ChatWindow) keeps its
                full-height layout below the header row. */}
            <div
              role="tabpanel"
              id={`pane-panel-${tab.sessionId}`}
              aria-labelledby={`pane-tab-${tab.sessionId}`}
              style={{
                flex: "1 1 0",
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              {renderPane(tab.sessionId, tab.sessionId === focusedId)}
            </div>
          </div>
        ))}
      </div>
      {overflowed && (
        <>
          {/* Click-outside backdrop: closes the dropdown without stealing
              pane focus. */}
          {overflowOpen && (
            <div
              data-pane-overflow-backdrop
              onClick={() => setOverflowOpen(false)}
              style={{ position: "absolute", inset: 0, zIndex: 55 }}
            />
          )}
          <div
            data-pane-overflow
            style={{ position: "absolute", top: 4, left: 4, zIndex: 60 }}
          >
            <button
              ref={overflowTriggerRef}
              type="button"
              data-pane-overflow-trigger
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              title={t("tabs.openPanes")}
              aria-label={t("tabs.openPanes")}
              onClick={() => setOverflowOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setOverflowOpen(true);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                height: 22,
                padding: "0 7px",
                borderRadius: 6,
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "inherit",
                lineHeight: 1,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <rect x="1.5" y="2.5" width="9" height="7" rx="1" />
                <line x1="1.5" y1="5" x2="10.5" y2="5" />
              </svg>
              {tabs.length}
            </button>
            {overflowOpen && (
              <div
                ref={overflowMenuRef}
                role="menu"
                data-pane-overflow-menu
                onKeyDown={handleOverflowMenuKeyDown}
                style={{
                  position: "absolute",
                  top: 26,
                  left: 0,
                  minWidth: 180,
                  maxHeight: 260,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
                  padding: 4,
                  zIndex: 60,
                }}
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.sessionId}
                    type="button"
                    role="menuitem"
                    data-pane-overflow-item={tab.sessionId}
                    onClick={() => activateOverflowEntry(tab.sessionId)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 8px",
                      border: "none",
                      borderRadius: 4,
                      background: "transparent",
                      color: tab.sessionId === focusedId ? "var(--text)" : "var(--text-muted)",
                      cursor: "pointer",
                      fontSize: 11,
                      fontFamily: "inherit",
                      textAlign: "left",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {runningSessionIds.has(tab.sessionId) && (
                      <span
                        style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      style={{
                        minWidth: 0,
                        flex: "1 1 auto",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {paneHeaderLabel(tab)}
                    </span>
                    {tab.hasBadge && (
                      <span
                        style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", flexShrink: 0 }}
                        aria-label="completed"
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
);
