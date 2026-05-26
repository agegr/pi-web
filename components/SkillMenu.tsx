"use client";

import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";

export interface SkillItem {
  name: string;
  description: string;
  filePath: string;
  disableModelInvocation: boolean;
}

interface Props {
  cwd: string;
  query: string; // text after "/"
  onSelect: (skill: SkillItem) => void;
  onClose: () => void;
  anchorRect: { top: number; left: number; width: number } | null;
}

export function SkillMenu({ cwd, query, onSelect, onClose, anchorRect }: Props) {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Load skills once on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => r.json())
      .then((d: { skills?: SkillItem[]; error?: string }) => {
        if (cancelled) return;
        if (d.error) {
          setError(d.error);
          return;
        }
        setSkills(d.skills ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [cwd]);

  // Filter by query
  const filtered = skills.filter((s) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    );
  });

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useLayoutEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % Math.max(filtered.length, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filtered.length) % Math.max(filtered.length, 1));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [filtered, selectedIndex, onSelect, onClose]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid closing from the same click that opened the menu
    const t = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  if (!anchorRect) return null;
  if (loading) {
    return (
      <div ref={panelRef} style={menuStyle(anchorRect)}>
        <div style={headerStyle}>Skills</div>
        <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-muted)" }}>Loading…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div ref={panelRef} style={menuStyle(anchorRect)}>
        <div style={headerStyle}>Skills</div>
        <div style={{ padding: "10px 12px", fontSize: 12, color: "#f87171" }}>{error}</div>
      </div>
    );
  }
  if (skills.length === 0) {
    return (
      <div ref={panelRef} style={menuStyle(anchorRect)}>
        <div style={headerStyle}>Skills</div>
        <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-dim)" }}>No skills installed</div>
      </div>
    );
  }

  return (
    <div ref={panelRef} style={menuStyle(anchorRect)}>
      <div style={headerStyle}>
        <span>Skills</span>
        {query && (
          <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 6 }}>
            {filtered.length} match{filtered.length !== 1 ? "es" : ""}
          </span>
        )}
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-dim)" }}>
            No skills matching &ldquo;{query}&rdquo;
          </div>
        ) : (
          filtered.map((skill, i) => (
            <div
              key={skill.filePath}
              ref={(el) => { itemRefs.current[i] = el; }}
              onClick={() => onSelect(skill)}
              onMouseEnter={() => setSelectedIndex(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                cursor: "pointer",
                background: i === selectedIndex ? "var(--bg-selected)" : "none",
                transition: "background 0.08s",
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: skill.disableModelInvocation ? "var(--border)" : "var(--accent)",
                  boxShadow: skill.disableModelInvocation ? "none" : "0 0 4px var(--accent)",
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", fontFamily: "var(--font-mono)" }}>
                  /{skill.name}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    lineHeight: 1.4,
                    marginTop: 1,
                  }}
                >
                  {skill.description}
                </div>
              </div>
              {i === selectedIndex && (
                <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0, fontFamily: "var(--font-mono)" }}>
                  ↵
                </span>
              )}
            </div>
          ))
        )}
      </div>
      <div
        style={{
          padding: "5px 12px",
          borderTop: "1px solid var(--border)",
          fontSize: 10,
          color: "var(--text-dim)",
          display: "flex",
          gap: 10,
        }}
      >
        <span>↑↓ navigate</span>
        <span>↵ / tab select</span>
        <span>esc close</span>
      </div>
    </div>
  );
}

function menuStyle(rect: { top: number; left: number; width: number }): React.CSSProperties {
  return {
    position: "fixed",
    bottom: `calc(100vh - ${rect.top}px + 6px)`,
    left: rect.left,
    zIndex: 600,
    width: 380,
    maxWidth: "90vw",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    boxShadow: "0 -4px 20px rgba(0,0,0,0.12)",
    overflow: "hidden",
  };
}

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "8px 12px 4px",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-dim)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
};
