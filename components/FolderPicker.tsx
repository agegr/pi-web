"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { FolderIcon } from "./FileIcons";

interface DirEntry {
  name: string;
  isDir: boolean;
}

interface DriveInfo {
  name: string;
  path: string;
}

interface DirBrowseResult {
  path?: string;
  parentPath?: string | null;
  entries?: DirEntry[];
  drives?: DriveInfo[];
  homePath?: string;
  error?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

async function fetchApi(params: Record<string, string>): Promise<DirBrowseResult> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`/api/dir-browse?${qs}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    return { error: data.error ?? `HTTP ${res.status}` };
  }
  return res.json();
}

function isWindowsDrivePath(p: string): false | string {
  const m = /^([a-zA-Z]:)/.exec(p);
  if (m) return m[1].toLowerCase();
  return false;
}

function joinPath(parent: string, name: string): string {
  const sep = parent.includes("\\") ? "\\" : "/";
  return parent.endsWith(sep) ? parent + name : parent + sep + name;
}

export function FolderPicker({ isOpen, onClose, onSelect, initialPath }: Props) {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [mode, setMode] = useState<"empty" | "drives" | "browse">("empty");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const navigate = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchApi({ path: p });
      if (result.error) {
        setError(result.error);
        setEntries([]);
        setParentPath(result.parentPath ?? null);
        setCurrentPath(result.path ?? p);
        setPathInput(result.path ?? p);
        setDrives(result.drives ?? []);
        setMode("browse");
      } else {
        setEntries(result.entries ?? []);
        setParentPath(result.parentPath ?? null);
        setCurrentPath(result.path ?? p);
        setPathInput(result.path ?? p);
        setDrives(result.drives ?? []);
        setMode("browse");
      }
    } catch {
      setError("Failed to load directory");
    } finally {
      setLoading(false);
    }
  }, []);

  const init = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchApi({});
      const ds = result.drives ?? [];
      setDrives(ds);
      if (ds.length > 0) {
        setMode("drives");
        setCurrentPath("");
        setPathInput("");
        setEntries([]);
        setParentPath(null);
      } else {
        setMode("browse");
        setCurrentPath("/");
        setPathInput("/");
        setEntries([]);
        setParentPath(null);
      }
    } catch {
      setError("Failed to load drives");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      if (initialPath) {
        navigate(initialPath);
      } else {
        init();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleDriveClick = useCallback((drivePath: string) => {
    navigate(drivePath);
  }, [navigate]);

  const handleGoUp = useCallback(() => {
    if (parentPath) navigate(parentPath);
  }, [parentPath, navigate]);

  const handleEnterDir = useCallback((name: string) => {
    navigate(joinPath(currentPath, name));
  }, [currentPath, navigate]);

  const handleSelect = useCallback(() => {
    if (currentPath) {
      onSelect(currentPath);
      onClose();
    }
  }, [currentPath, onSelect, onClose]);

  const handlePathInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      const trimmed = pathInput.trim();
      if (trimmed) navigate(trimmed);
    }
    if (e.key === "Escape") {
      onClose();
    }
  }, [pathInput, navigate, onClose]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (document.activeElement === inputRef.current) return;
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, mode]);

  if (!isOpen) return null;

  const currentDrive = isWindowsDrivePath(currentPath);
  const hasDrives = drives.length > 0;
  const canBrowse = mode === "browse" && !!currentPath;

  return (
    <div
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxHeight: "80vh",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.24)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 600, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
          <FolderIcon size={16} />
          Select Folder
        </div>

        {/* Drive tabs */}
        {hasDrives && (
          <div style={{ display: "flex", gap: 2, padding: "6px 10px", borderBottom: "1px solid var(--border)", overflowX: "auto", flexShrink: 0 }}>
            <button onClick={() => navigate("/")} style={tabStyle(false)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              Home
            </button>
            {drives.map((d) => (
              <button key={d.path} onClick={() => navigate(d.path)} style={tabStyle(currentDrive === d.path.toLowerCase())}>
                {d.name}
              </button>
            ))}
          </div>
        )}

        {/* Path input bar */}
        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, padding: "4px 8px" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={handlePathInputKeyDown}
              placeholder="Type a path or browse below..."
              style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 12, fontFamily: "var(--font-mono)" }}
            />
            {pathInput && pathInput !== currentPath && (
              <button onClick={() => navigate(pathInput.trim())} disabled={!pathInput.trim()} style={goBtnStyle(!!pathInput.trim())}>
                Go
              </button>
            )}
          </div>
        </div>

        {/* Content area */}
        <div ref={listRef} style={{ flex: 1, overflowY: "auto", minHeight: 200, maxHeight: 400 }}>
          {loading && (
            <div style={{ padding: "16px 14px", color: "var(--text-dim)", fontSize: 12 }}>Loading...</div>
          )}

          {error && (
            <div style={{ padding: "12px 14px", color: "#f87171", fontSize: 12 }}>{error}</div>
          )}

          {/* Drives list mode */}
          {!loading && !error && mode === "drives" && hasDrives && (
            <>
              <div style={{ padding: "6px 14px 2px", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Drives</div>
              {drives.map((d, i) => (
                <div
                  key={d.path}
                  onClick={() => handleDriveClick(d.path)}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={rowStyle(hoveredIndex === i)}
                >
                  <div style={{ width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="16" rx="2" ry="2" />
                      <circle cx="12" cy="11" r="2" />
                      <line x1="6" y1="17" x2="18" y2="17" />
                      <line x1="3" y1="20" x2="21" y2="20" />
                    </svg>
                  </div>
                  <span style={{ fontSize: 13, color: "var(--text)" }}>{d.name}</span>
                </div>
              ))}
            </>
          )}

          {!loading && !error && mode === "drives" && !hasDrives && (
            <div style={{ padding: "16px 14px", color: "var(--text-dim)", fontSize: 12 }}>Type a path above to get started</div>
          )}

          {/* Browse mode - directory listing */}
          {canBrowse && parentPath && (
            <div onClick={handleGoUp} onMouseEnter={() => setHoveredIndex(-1)} onMouseLeave={() => setHoveredIndex(null)} style={rowStyle(hoveredIndex === -1)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M15 18l-6-6 6-6" />
              </svg>
              <FolderIcon size={14} open />
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>..</span>
            </div>
          )}

          {!loading && !error && canBrowse && (
            <>
              {entries.length === 0 && (
                <div style={{ padding: "16px 14px", color: "var(--text-dim)", fontSize: 12 }}>No subdirectories found</div>
              )}

              {entries.map((entry, i) => (
                <div
                  key={entry.name}
                  onClick={() => handleEnterDir(entry.name)}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={rowStyle(hoveredIndex === i)}
                >
                  <FolderIcon size={14} />
                  <span style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={entry.name}>
                    {entry.name}
                  </span>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5 }}>
                    <polyline points="3 2 7 5 3 8" />
                  </svg>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div
            style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 8, userSelect: "all" }}
            title={currentPath}
          >
            {mode === "drives" || !currentPath ? "Select a drive or type a path" : currentPath}
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button onClick={onClose} style={footerBtnStyle(false)}>Cancel</button>
            <button onClick={handleSelect} disabled={!currentPath} style={footerBtnStyle(true, !currentPath)}>Select</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 5,
    padding: "4px 10px", whiteSpace: "nowrap",
    background: active ? "var(--accent)" : "var(--bg)",
    border: active ? "none" : "1px solid var(--border)",
    borderRadius: 4,
    color: active ? "#fff" : "var(--text)",
    fontSize: 11, fontWeight: active ? 600 : 400,
    cursor: "pointer", flexShrink: 0,
  };
}

function rowStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 8,
    padding: "7px 14px",
    cursor: "pointer",
    background: active ? "var(--bg-selected)" : "transparent",
    borderRadius: 0,
  };
}

function goBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    background: "var(--accent)",
    border: "none", borderRadius: 3,
    color: "#fff", fontSize: 11,
    padding: "2px 8px", cursor: "pointer",
    opacity: enabled ? 1 : 0.5,
  };
}

function footerBtnStyle(primary: boolean, disabled?: boolean): React.CSSProperties {
  return {
    padding: "5px 14px",
    background: primary ? (disabled ? "var(--bg-hover)" : "var(--accent)") : "var(--bg-hover)",
    border: primary && !disabled ? "none" : "1px solid var(--border)",
    borderRadius: 5,
    color: primary && !disabled ? "#fff" : disabled ? "var(--text-dim)" : "var(--text-muted)",
    fontSize: 12, cursor: disabled ? "default" : "pointer",
    fontWeight: primary ? 600 : 500,
  };
}
