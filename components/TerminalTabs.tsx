"use client";

import { useState } from "react";
import { TerminalPanel } from "./TerminalPanel";
import { useI18n } from "@/hooks/useI18n";

export interface TerminalTabItem {
  key: string;
  cwd: string;
}

interface TerminalTabsProps {
  tabs: TerminalTabItem[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onOpenNew: () => void;
  onClose: (key: string) => void;
}

const TAB_BAR_HEIGHT = 32;
const DRAG_HANDLE_HEIGHT = 5;
const MIN_PANEL_HEIGHT = 140;
const MAX_PANEL_HEIGHT = 640;

/**
 * Bottom terminal dock. Owns a single shared panel height (drag handle on
 * top) and renders one TerminalPanel per tab. Inactive tabs stay mounted but
 * hidden so their shell processes keep running while you work in another tab.
 */
export function TerminalTabs({
  tabs,
  activeKey,
  onSelect,
  onOpenNew,
  onClose,
}: TerminalTabsProps) {
  const { t } = useI18n();
  const [height, setHeight] = useState(260);

  const handleDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const startY = e.clientY;
    const startHeight = height;
    const onMove = (moveEvent: PointerEvent) => {
      setHeight(Math.min(
        MAX_PANEL_HEIGHT,
        Math.max(MIN_PANEL_HEIGHT, startHeight - (moveEvent.clientY - startY)),
      ));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      style={{
        flexShrink: 0,
        height,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        background: "var(--bg-panel)",
        borderTop: "1px solid var(--border)",
      }}
    >
      {/* Drag handle — shared across tabs */}
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

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          flexShrink: 0,
          height: TAB_BAR_HEIGHT,
          borderBottom: "1px solid var(--border)",
          overflowX: "auto",
          scrollbarWidth: "thin",
        }}
        role="tablist"
        aria-label={t("terminal.toggle")}
      >
        {tabs.map((tab, index) => {
          const isActive = tab.key === activeKey;
          return (
            <div
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(tab.key)}
              title={tab.cwd}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 4px 0 10px",
                borderRight: "1px solid var(--border)",
                background: isActive ? "var(--bg)" : "transparent",
                cursor: "pointer",
                userSelect: "none",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 12, color: isActive ? "var(--text)" : "var(--text-muted)" }}>
                {t("terminal.tab", { n: index + 1 })}
              </span>
              <button
                type="button"
                aria-label={t("terminal.close")}
                title={t("terminal.close")}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.key);
                }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 18, height: 18, padding: 0,
                  background: "none", border: "none", borderRadius: 3,
                  color: isActive ? "var(--text-muted)" : "var(--text-dim)",
                  cursor: "pointer", flexShrink: 0,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <line x1="5" y1="5" x2="19" y2="19" />
                  <line x1="19" y1="5" x2="5" y2="19" />
                </svg>
              </button>
            </div>
          );
        })}
        <button
          type="button"
          aria-label={t("terminal.new")}
          title={t("terminal.new")}
          onClick={onOpenNew}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 32, flexShrink: 0, padding: 0,
            background: "none", border: "none", borderRight: "1px solid var(--border)",
            color: "var(--text-muted)", cursor: "pointer", fontSize: 16, lineHeight: 1,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Terminal surfaces — inactive tabs stay mounted so sessions survive */}
      {tabs.map((tab) => (
        <div
          key={tab.key}
          role="tabpanel"
          hidden={tab.key !== activeKey}
          style={{
            flex: 1,
            minHeight: 0,
            display: tab.key === activeKey ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          <TerminalPanel
            cwd={tab.cwd}
            onClose={() => onClose(tab.key)}
            fillHeight
          />
        </div>
      ))}
    </div>
  );
}