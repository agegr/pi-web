"use client";

import { useEffect, useState, useRef, useCallback } from "react";

interface Props {
  cwd: string;
  isOpen: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface GitFileInfo {
  status: string;
  file: string;
}

interface GitHistoryCommit {
  hash: string;
  message: string;
}

interface GitState {
  branch: string;
  modifiedFiles: GitFileInfo[];
  history: GitHistoryCommit[];
  isClean: boolean;
}

export function GitPanel({ cwd, isOpen, onClose, containerRef }: Props) {
  const [gitState, setGitState] = useState<GitState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommiting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);

  const fetchGitStatus = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "status" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch Git status");
      }
      if (data.error) {
        setError(data.error);
        setGitState(null);
      } else {
        setGitState(data);
      }
    } catch (err: any) {
      setError(err?.message || String(err));
      setGitState(null);
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    if (isOpen) {
      fetchGitStatus();
      setCommitMessage("");
      setActionSuccess(null);
    }
  }, [isOpen, fetchGitStatus]);

  // Click outside to close panel
  useEffect(() => {
    if (!isOpen) return;
    const clickHandler = (e: MouseEvent) => {
      // Don't close if clicking target buttons or menu
      if (panelRef.current?.contains(e.target as Node)) {
        return;
      }
      // Check if clicking the Git Trigger Button in top bar
      const target = e.target as HTMLElement;
      if (target.closest("[data-git-btn]")) {
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", clickHandler);
    return () => document.removeEventListener("mousedown", clickHandler);
  }, [isOpen, onClose]);

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim() || !cwd) return;
    setCommiting(true);
    setError(null);
    setActionSuccess(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "commit", commitMessage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Commit failed");
      
      setActionSuccess("Commit successful!");
      setCommitMessage("");
      await fetchGitStatus();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setCommiting(false);
    }
  };

  const handlePush = async () => {
    if (!cwd) return;
    setPushing(true);
    setError(null);
    setActionSuccess(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "push" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Push failed");

      setActionSuccess("Successfully pushed to remote branch!");
      await fetchGitStatus();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setPushing(false);
    }
  };

  if (!isOpen) return null;

  // Position relative to top bar container
  let dropdownStyle: React.CSSProperties = {
    position: "absolute",
    top: "100%",
    left: 0,
    width: "100%",
    background: "var(--bg)",
    borderBottom: "1px solid var(--border)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
    zIndex: 400,
    display: "flex",
    flexDirection: "column",
  };

  if (containerRef.current) {
    const rect = containerRef.current.getBoundingClientRect();
    dropdownStyle = {
      ...dropdownStyle,
      position: "fixed",
      top: rect.bottom,
      left: rect.left,
      width: rect.width,
    };
  }

  const getStatusColor = (status: string) => {
    const s = status.trim().toUpperCase();
    if (s.includes("M")) return "#eab308"; // modifying yellow
    if (s.includes("A") || s.includes("??")) return "#22c55e"; // adding green
    if (s.includes("D")) return "#ef4444"; // deleting red
    return "var(--text-muted)";
  };

  return (
    <div ref={panelRef} style={dropdownStyle}>
      <div
        style={{
          display: "flex",
          padding: "12px 16px",
          gap: 24,
          maxHeight: 280,
          overflowY: "auto",
        }}
      >
        {/* LEFT COLUMN: MODIFIED FILES / COMMIT */}
        <div style={{ flex: 1.2, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
              Changes ({gitState?.modifiedFiles.length ?? 0})
            </span>
            {gitState && (
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              >
                git branch: <strong style={{ color: "var(--accent)" }}>{gitState.branch}</strong>
              </span>
            )}
          </div>

          {/* Files container */}
          <div
            style={{
              flex: 1,
              minHeight: 80,
              maxHeight: 120,
              overflowY: "auto",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg-panel)",
              padding: "4px 8px",
            }}
          >
            {loading ? (
              <div style={{ display: "flex", alignItems: "center", height: "100%", justifyContent: "center", fontSize: 11, color: "var(--text-dim)", gap: 6 }}>
                <span className="animate-pulse">Loading status...</span>
              </div>
            ) : error ? (
              <div style={{ padding: 6, fontSize: 11, color: "#f87171", wordBreak: "break-all" }}>
                {error}
              </div>
            ) : gitState?.isClean ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 4, opacity: 0.8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 500 }}>No changes left to commit</span>
              </div>
            ) : (
              gitState?.modifiedFiles.map((file, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 0",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    borderBottom: i < gitState.modifiedFiles.length - 1 ? "1px solid rgba(120,120,120,0.05)" : "none",
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      fontWeight: 700,
                      fontSize: 10,
                      textAlign: "center",
                      color: getStatusColor(file.status),
                    }}
                  >
                    {file.status}
                  </span>
                  <span style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.file}>
                    {file.file}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Form for committing */}
          <form onSubmit={handleCommit} style={{ display: "flex", gap: 6, marginTop: 2 }}>
            <input
              type="text"
              placeholder={gitState?.isClean ? "Working directory is clean" : "Commit message (e.g. update code)..."}
              value={commitMessage}
              disabled={committing || pushing || loading || !!error || gitState?.isClean}
              onChange={(e) => setCommitMessage(e.target.value)}
              style={{
                flex: 1,
                fontSize: 11,
                padding: "6px 10px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg)",
                color: "var(--text)",
                outline: "none",
                minWidth: 0,
              }}
            />
            <button
              type="submit"
              disabled={committing || pushing || loading || !commitMessage.trim() || gitState?.isClean}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#ffffff",
                background: "var(--accent)",
                border: "none",
                borderRadius: 6,
                padding: "0 12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                opacity: (committing || pushing || loading || !commitMessage.trim() || gitState?.isClean) ? 0.5 : 1,
              }}
            >
              {committing ? "Saving..." : "Commit"}
            </button>
          </form>
        </div>

        {/* RIGHT COLUMN: RECENT HISTORY + ACTION BUTTON */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, borderLeft: "1px solid var(--border)", paddingLeft: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
              Recent Commits
            </span>
            <button
              onClick={handlePush}
              disabled={pushing || committing || loading || !!error}
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--accent)",
                background: "rgba(37,99,235,0.06)",
                border: "1px solid rgba(37,99,235,0.2)",
                borderRadius: 4,
                padding: "2px 8px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 3,
                opacity: (pushing || committing || loading) ? 0.5 : 1,
                transition: "all 0.1s",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
              {pushing ? "Pushing..." : "Git Push"}
            </button>
          </div>

          {/* History container */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "2px 0",
            }}
          >
            {loading ? (
              <div style={{ display: "flex", alignItems: "center", height: "100%", justifyContent: "center", fontSize: 11, color: "var(--text-dim)" }}>
                Checking logs...
              </div>
            ) : error ? (
              <div style={{ fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }}>
                Log trace unavailable
              </div>
            ) : gitState?.history.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }}>
                No commit history found
              </div>
            ) : (
              gitState?.history.map((commit, i) => (
                <div key={commit.hash} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11 }}>
                  {/* Visual timeline node */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative", height: "100%", paddingTop: 3 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: i === 0 ? "var(--accent)" : "var(--border)", zIndex: 2 }} />
                    {i < gitState.history.length - 1 && (
                      <div style={{ width: 1, position: "absolute", top: 8, bottom: -12, background: "var(--border)", zIndex: 1 }} />
                    )}
                  </div>
                  {/* Message content */}
                  <div style={{ display: "flex", gap: 6, overflow: "hidden" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>
                      {commit.hash}
                    </span>
                    <span style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={commit.message}>
                      {commit.message}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* FOOTER status notification bar */}
      {actionSuccess && (
        <div
          style={{
            padding: "5px 16px",
            background: "rgba(34,197,94,0.08)",
            borderTop: "1px solid rgba(34,197,94,0.15)",
            fontSize: 10.5,
            color: "#22c55e",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ borderRadius: "50%", width: 5, height: 5, background: "#22c55e" }} />
          {actionSuccess}
        </div>
      )}
    </div>
  );
}
