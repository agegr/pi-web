"use client";

import React, { useEffect, useRef, useState, useLayoutEffect, useMemo } from "react";
import { getFileIcon } from "./FileIcons";
import { encodeFilePathForApi } from "@/lib/file-paths";

interface Props {
  cwd: string;
  query: string; // text after "@"
  onSelect: (filePath: string) => void;
  onClose: () => void;
  anchorRect: { top: number; left: number; width: number } | null;
}

export function AtMentionMenu({ cwd, query, onSelect, onClose, anchorRect }: Props) {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Load recursive file list once on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    
    const encodedCwd = encodeFilePathForApi(cwd);
    fetch(`/api/files/${encodedCwd}?type=recursive-list`)
      .then((r) => r.json())
      .then((d: { files?: string[]; error?: string }) => {
        if (cancelled) return;
        if (d.error) {
          setError(d.error);
          return;
        }
        setFiles(d.files ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [cwd]);

  // Filter based on query (case-insensitive fuzzy match)
  const filtered = useMemo(() => {
    if (!query) {
      // If no query, show top 10-15 files to keep it clean (prioritizing common files)
      return files.slice(0, 50);
    }
    const q = query.toLowerCase();
    
    // Sort logic: exact name match first, then extension match, then path contains
    return files
      .filter((f) => f.toLowerCase().includes(q))
      .sort((a, b) => {
        const aName = a.split("/").pop()?.toLowerCase() ?? "";
        const bName = b.split("/").pop()?.toLowerCase() ?? "";
        const aStarts = aName.startsWith(q);
        const bStarts = bName.startsWith(q);
        
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        
        const aCont = aName.includes(q);
        const bCont = bName.includes(q);
        if (aCont && !bCont) return -1;
        if (!aCont && bCont) return 1;
        
        return a.localeCompare(b);
      })
      .slice(0, 100); // Max 100 visible matches for performance
  }, [files, query]);

  // Reset selected index when query changes
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
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
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
    const t = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  if (!anchorRect) return null;

  return (
    <div ref={panelRef} style={menuStyle(anchorRect)}>
      <div style={headerStyle}>
        <span>Files</span>
        {query && (
          <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 6 }}>
            {filtered.length} match{filtered.length !== 1 ? "es" : ""}
          </span>
        )}
      </div>

      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
            <span className="spinner-mini" style={spinnerStyle} />
            <span>Scanning project files…</span>
          </div>
        ) : error ? (
          <div style={{ padding: "10px 12px", fontSize: 11, color: "#f87171" }}>
            Error scanning workspace: {error}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-dim)" }}>
            No files matching &ldquo;{query}&rdquo;
          </div>
        ) : (
          filtered.map((filePath, i) => {
            const fileName = filePath.split("/").pop() ?? filePath;
            const parentPath = filePath.substring(0, filePath.length - fileName.length);
            return (
              <div
                key={filePath}
                ref={(el) => { itemRefs.current[i] = el; }}
                onClick={() => onSelect(filePath)}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  cursor: "pointer",
                  background: i === selectedIndex ? "var(--bg-selected)" : "none",
                  transition: "background 0.08s",
                }}
              >
                <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                  {getFileIcon(fileName, 15)}
                </span>
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)", fontFamily: "var(--font-mono)", display: "inline-block" }}>
                    {fileName}
                  </span>
                  {parentPath && (
                    <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      in {parentPath}
                    </span>
                  )}
                </div>
                {i === selectedIndex && (
                  <span style={{ fontSize: 9, color: "var(--text-dim)", flexShrink: 0, fontFamily: "var(--font-mono)", opacity: 0.7 }}>
                    Enter
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const menuStyle = (rect: { top: number; left: number; width: number }): React.CSSProperties => {
  const popupHeight = 300;
  const top = rect.top - popupHeight - 8;
  return {
    position: "fixed",
    top,
    left: rect.left,
    width: Math.min(rect.width, 500),
    height: popupHeight,
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    boxShadow: "0 10px 25px -5px rgba(0,0,0,0.4), 0 8px 10px -6px rgba(0,0,0,0.4)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    zIndex: 100,
  };
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-dim)",
  background: "rgba(100,116,139,0.03)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const spinnerStyle: React.CSSProperties = {
  width: 10,
  height: 10,
  border: "1.5px solid var(--border)",
  borderTopColor: "var(--accent)",
  borderRadius: "50%",
  display: "inline-block",
  animation: "spin 0.8s linear infinite",
};
