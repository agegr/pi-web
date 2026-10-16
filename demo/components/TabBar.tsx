"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getFileIcon } from "./FileIcons";
import { useI18n } from "@/hooks/useI18n";
import type { FileViewerDisplayMode, FileViewerState } from "@/lib/file-viewer-state";

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  kind?: "terminal";
  closing?: boolean;
  sourceSessionId?: string | null;
  initialDisplayMode?: FileViewerDisplayMode;
  /** PDF page requested by the link that opened this tab (`#page=N`). */
  page?: number;
  viewerState?: FileViewerState;
  viewerRevision?: number;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  const { t } = useI18n();
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ startX: number; startScroll: number; ratio: number } | null>(null);

  // Direct DOM writes: a scroll frame must not re-render the tabs.
  const updateThumb = useCallback(() => {
    const list = listRef.current;
    const overlay = overlayRef.current;
    const thumb = thumbRef.current;
    if (!list || !overlay || !thumb) return;
    const { clientWidth, scrollWidth, scrollLeft } = list;
    const overflowing = scrollWidth - clientWidth > 1;
    if (overflowing) overlay.setAttribute("data-overflow", "true");
    else overlay.removeAttribute("data-overflow");
    if (!overflowing) return;
    const trackWidth = overlay.clientWidth;
    const thumbWidth = Math.min(trackWidth, Math.max(24, (clientWidth / scrollWidth) * trackWidth));
    const maxScroll = scrollWidth - clientWidth;
    const offset = (Math.min(Math.max(scrollLeft, 0), maxScroll) / maxScroll) * (trackWidth - thumbWidth);
    thumb.style.width = `${thumbWidth}px`;
    thumb.style.transform = `translateX(${offset}px)`;
  }, []);

  useLayoutEffect(() => {
    updateThumb();
  }, [tabs, updateThumb]);

  useEffect(() => {
    const list = listRef.current;
    const wrap = wrapRef.current;
    if (!list || !wrap) return;
    const onScroll = () => {
      updateThumb();
      wrap.setAttribute("data-active", "true");
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(() => {
        fadeTimer.current = null;
        if (!drag.current) wrap.removeAttribute("data-active");
      }, 1000);
    };
    // Non-passive so a vertical wheel can be turned into a horizontal scroll.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || list.scrollWidth - list.clientWidth <= 1) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientWidth : 1;
      list.scrollLeft += event.deltaY * unit;
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    list.addEventListener("wheel", onWheel, { passive: false });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateThumb);
    observer?.observe(list);
    return () => {
      list.removeEventListener("scroll", onScroll);
      list.removeEventListener("wheel", onWheel);
      observer?.disconnect();
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, [updateThumb]);

  // Bring the active tab into view by moving this strip only; scrollIntoView
  // could also scroll the page or the panels around it.
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.children[tabs.findIndex((item) => item.id === activeTabId)] as HTMLElement | undefined;
    if (!list || !tab) return;
    const listRect = list.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const left = tabRect.left - listRect.left + list.scrollLeft;
    const right = left + tabRect.width;
    if (left < list.scrollLeft) list.scrollLeft = left;
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
  }, [activeTabId, tabs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    wrapRef.current?.removeAttribute("data-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!fadeTimer.current) wrapRef.current?.removeAttribute("data-active");
  };

  return (
    <div ref={wrapRef} className="tabbar-wrap" style={{ position: "relative", flexShrink: 0, height: 36 }}>
      <div
        ref={listRef}
        role="tablist"
        className="tabbar-scroll"
        style={{
          // The native scrollbar is hidden (the overlay above the tabs stands in
          // for it), so the tabs keep their 36px whether or not they overflow.
          display: "flex",
          alignItems: "stretch",
          background: "var(--bg-panel)",
          overflowX: "auto",
          overflowY: "hidden",
          height: 36,
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-label={tab.kind === "terminal" ? t("terminal.tabLabel", { name: tab.label }) : tab.label}
              aria-selected={isActive}
              tabIndex={isActive || (!activeTabId && tabs[0].id === tab.id) ? 0 : -1}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectTab(tab.id);
                } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  const index = tabs.findIndex((item) => item.id === tab.id);
                  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                  onSelectTab(tabs[next].id);
                  (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
                }
              }}
              onClick={() => onSelectTab(tab.id)}
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault();
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                e.stopPropagation();
                if (!tab.closing) onCloseTab(tab.id);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                paddingLeft: 12,
                paddingRight: 6,
                borderRight: "1px solid var(--border)",
                background: isActive ? "var(--bg)" : "var(--bg-panel)",
                cursor: "pointer",
                fontSize: 12,
                color: isActive ? "var(--text)" : "var(--text-muted)",
                whiteSpace: "nowrap",
                maxWidth: 180,
                minWidth: 80,
                flexShrink: 0,
                userSelect: "none",
                transition: "background 0.1s, color 0.1s",
              }}
            >
              <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "flex", alignItems: "center" }}>
                {tab.kind === "terminal" ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                ) : getFileIcon(tab.label, 13)}
              </span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  flex: 1,
                  fontWeight: isActive ? 500 : 400,
                }}
                title={tab.filePath}
              >
                {tab.label}
              </span>
              <button
                disabled={tab.closing}
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                onMouseEnter={() => setHoveredClose(tab.id)}
                onMouseLeave={() => setHoveredClose(null)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 24, height: 24,
                  background: hoveredClose === tab.id ? "var(--bg-hover)" : "transparent",
                  border: "none",
                  borderRadius: 4,
                  color: hoveredClose === tab.id ? "var(--text)" : "var(--text-dim)",
                  cursor: "pointer",
                  padding: 0,
                  flexShrink: 0,
                  transition: "background 0.1s, color 0.1s",
                }}
                 title={t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")}
                 aria-label={`${t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")} ${tab.label}`}
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
      <div ref={overlayRef} className="tabbar-overlay" aria-hidden="true">
        <div className="tabbar-track">
          <div
            ref={thumbRef}
            className="tabbar-thumb"
            onPointerDown={(event) => {
              const list = listRef.current;
              const overlay = overlayRef.current;
              if (!list || !overlay || event.button !== 0) return;
              const room = overlay.clientWidth - event.currentTarget.offsetWidth;
              if (room <= 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { startX: event.clientX, startScroll: list.scrollLeft, ratio: (list.scrollWidth - list.clientWidth) / room };
              wrapRef.current?.setAttribute("data-dragging", "true");
              wrapRef.current?.setAttribute("data-active", "true");
            }}
            onPointerMove={(event) => {
              const state = drag.current;
              const list = listRef.current;
              if (!state || !list) return;
              list.scrollLeft = state.startScroll + (event.clientX - state.startX) * state.ratio;
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </div>
      </div>
    </div>
  );
}
