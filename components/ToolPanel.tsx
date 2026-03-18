"use client";

import { useEffect, useRef } from "react";

export interface ToolEntry {
  name: string;
  description: string;
  active: boolean;
}

interface Props {
  tools: ToolEntry[];
  onToggle: (name: string, active: boolean) => void;
  onClose: () => void;
}

export function ToolPanel({ tools, onToggle, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      style={{
        position: "absolute",
        bottom: "calc(100% + 8px)",
        right: 0,
        zIndex: 200,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 -4px 20px rgba(0,0,0,0.10)",
        width: 300,
        maxHeight: 360,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{
        padding: "10px 14px 8px",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Active Tools</span>
        <button
          onClick={onClose}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-dim)", padding: 2, lineHeight: 1,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="2" y1="2" x2="12" y2="12" /><line x1="12" y1="2" x2="2" y2="12" />
          </svg>
        </button>
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {tools.length === 0 && (
          <div style={{ padding: "12px 14px", color: "var(--text-dim)", fontSize: 12 }}>No tools available</div>
        )}
        {tools.map((tool) => (
          <div
            key={tool.name}
            style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "9px 14px",
              borderBottom: "1px solid var(--border)",
              cursor: "pointer",
            }}
            onClick={() => onToggle(tool.name, !tool.active)}
          >
            {/* Toggle */}
            <div
              style={{
                flexShrink: 0,
                marginTop: 1,
                width: 30, height: 16,
                borderRadius: 8,
                background: tool.active ? "var(--accent)" : "var(--border)",
                position: "relative",
                transition: "background 0.15s",
              }}
            >
              <div style={{
                position: "absolute",
                top: 2,
                left: tool.active ? 16 : 2,
                width: 12, height: 12,
                borderRadius: "50%",
                background: "#fff",
                transition: "left 0.15s",
                boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
              }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: tool.active ? "var(--text)" : "var(--text-muted)" }}>
                {tool.name}
              </div>
              <div style={{
                fontSize: 11, color: "var(--text-dim)", marginTop: 2,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }} title={tool.description}>
                {tool.description}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: "6px 14px", borderTop: "1px solid var(--border)" }}>
        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
          {tools.filter(t => t.active).length} of {tools.length} active · takes effect on next turn
        </span>
      </div>
    </div>
  );
}
