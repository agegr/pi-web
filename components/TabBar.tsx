"use client";

import { useState } from "react";
import { getFileIcon } from "./FileIcons";

export interface Tab {
  id: string;
  type: "chat" | "file";
  label: string;
  filePath?: string;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

function ChatIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}



export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
        overflowX: "auto",
        flexShrink: 0,
        height: 36,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 36,
              paddingLeft: 12,
              paddingRight: tab.type === "chat" ? 12 : 6,
              borderRight: "1px solid var(--border)",
              borderTop: isActive ? "2px solid var(--accent)" : "2px solid transparent",
              background: isActive ? "var(--bg)" : "transparent",
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
              {tab.type === "chat" ? <ChatIcon /> : getFileIcon(tab.label, 13)}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
                fontWeight: isActive ? 500 : 400,
              }}
              title={tab.filePath ?? tab.label}
            >
              {tab.label}
            </span>
            {tab.type === "file" && (
              <button
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                onMouseEnter={() => setHoveredClose(tab.id)}
                onMouseLeave={() => setHoveredClose(null)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 16, height: 16,
                  background: hoveredClose === tab.id ? "var(--bg-hover)" : "transparent",
                  border: "none",
                  borderRadius: 3,
                  color: hoveredClose === tab.id ? "var(--text)" : "var(--text-dim)",
                  cursor: "pointer",
                  padding: 0,
                  flexShrink: 0,
                  transition: "background 0.1s, color 0.1s",
                }}
                title="Close"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="2" y1="2" x2="8" y2="8" />
                  <line x1="8" y1="2" x2="2" y2="8" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
