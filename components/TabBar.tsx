"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFileIcon } from "./FileIcons";

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  sourceSessionId?: string | null;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

interface ContextMenu {
  x: number;
  y: number;
  tabIndex: number;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const cancel = () => closeMenu();
    document.addEventListener("mousedown", handler);
    document.addEventListener("scroll", cancel, true);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("scroll", cancel, true);
    };
  }, [contextMenu, closeMenu]);

  const batchClose = useCallback((indices: number[]) => {
    const ids = indices.map((i) => tabs[i].id);
    ids.forEach((id) => onCloseTab(id));
    closeMenu();
  }, [tabs, onCloseTab, closeMenu]);

  const menuItems: { label: string; action: () => void }[] = contextMenu
    ? [
        {
          label: "关闭全部",
          action: () => batchClose(tabs.map((_, i) => i)),
        },
        {
          label: "关闭其他",
          action: () => batchClose(tabs.filter((_, i) => i !== contextMenu.tabIndex).map((_, i) => {
            let idx = 0;
            for (let j = 0; j < tabs.length; j++) {
              if (j === contextMenu.tabIndex) continue;
              if (idx === i) return j;
              idx++;
            }
            return -1;
          }).filter((i) => i >= 0)),
        },
        {
          label: "关闭左侧全部",
          action: () => batchClose(
            tabs.map((_, i) => i).filter((i) => i < contextMenu.tabIndex),
          ),
        },
        {
          label: "关闭右侧全部",
          action: () => batchClose(
            tabs.map((_, i) => i).filter((i) => i > contextMenu.tabIndex),
          ),
        },
      ]
    : [];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        background: "var(--bg-panel)",
        overflowX: "auto",
        flexShrink: 0,
        height: 36,
      }}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              onCloseTab(tab.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, tabIndex: index });
            }}
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
              minWidth: 80,
              flexShrink: 0,
              userSelect: "none",
              transition: "background 0.1s, color 0.1s",
            }}
          >
            <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "flex", alignItems: "center" }}>
              {getFileIcon(tab.label, 13)}
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
              title="Close"
              aria-label={`Close ${tab.label}`}
            >
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <line x1="2" y1="2" x2="8" y2="8" />
                <line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            </button>
          </div>
        );
      })}

      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
            padding: "4px 0",
            zIndex: 9999,
            minWidth: 140,
          }}
        >
          {menuItems.map((item) => (
            <div
              key={item.label}
              onClick={item.action}
              style={{
                padding: "6px 16px",
                fontSize: 12,
                color: "var(--text)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
