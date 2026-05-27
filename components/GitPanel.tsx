"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";

interface Props {
  cwd: string;
  inline?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

interface GitFileInfo {
  status: string;
  file: string;
  isConflict?: boolean;
}

interface GitHistoryCommit {
  hash: string;
  message: string;
}

interface GitState {
  branch: string;
  modifiedFiles: GitFileInfo[];
  history: GitHistoryCommit[];
  isMerging: boolean;
  isClean: boolean;
}

// Simple Tree representation helper for Local folder files list (7A)
interface FileTreeNode {
  name: string;
  fullPath: string; // original git path e.g. "components/AppShell.tsx"
  isFolder: boolean;
  children: Record<string, FileTreeNode>;
  fileEntry?: GitFileInfo;
}

function buildFileTree(files: GitFileInfo[]): FileTreeNode {
  const root: FileTreeNode = { name: "root", fullPath: "", isFolder: true, children: {} };
  for (const f of files) {
    const parts = f.file.split(/[/\\]/);
    let cur = root;
    let accumulated = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      const isLast = i === parts.length - 1;
      if (!cur.children[part]) {
        cur.children[part] = {
          name: part,
          fullPath: accumulated,
          isFolder: !isLast,
          children: {},
          ...(isLast ? { fileEntry: f } : {}),
        };
      }
      cur = cur.children[part];
    }
  }
  return root;
}

export function GitPanel({ cwd, inline = true }: Props) {
  const [activeSubTab, setActiveSubTab] = useState<"changes" | "branches" | "history">("changes");
  const [gitState, setGitState] = useState<GitState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 1. Changes tab state
  const [checkedFiles, setCheckedFiles] = useState<Record<string, boolean>>({});
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommiting] = useState(false);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<{ oldContent: string; newContent: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // Expanded folders state map for folder tree
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  // 2. Branches state
  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [selectedBranchForAction, setSelectedBranchForAction] = useState<string | null>(null);

  // Command running overlay statuses
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // 3. History Commit detail view (6A)
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [commitDetailsFiles, setCommitDetailsFiles] = useState<{ status: string; file: string }[]>([]);
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);

  const showNotification = useCallback((message: string) => {
    setActionSuccess(message);
    setTimeout(() => setActionSuccess(null), 3500);
  }, []);

  const fetchGitStatus = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "status" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load Git status");
      
      if (data.error) {
        setError(data.error);
        setGitState(null);
      } else {
        setError(null);
        setGitState(data);
        
        // Auto check newly found modified files
        setCheckedFiles((prev) => {
          const next = { ...prev };
          for (const f of data.modifiedFiles as GitFileInfo[]) {
            if (next[f.file] === undefined) {
              next[f.file] = true; // checked by default
            }
          }
          return next;
        });
      }
    } catch (err: any) {
      setError(err?.message || String(err));
      setGitState(null);
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  // Fetch branches listings
  const fetchBranches = useCallback(async () => {
    if (!cwd) return;
    setBranchLoading(true);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "list-branches" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load branches");
      setLocalBranches(data.local || []);
      setRemoteBranches(data.remote || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setBranchLoading(false);
    }
  }, [cwd]);

  // Handle active sub tab change
  useEffect(() => {
    fetchGitStatus();
  }, [cwd, activeSubTab, fetchGitStatus]);

  useEffect(() => {
    if (activeSubTab === "branches") {
      fetchBranches();
    }
  }, [activeSubTab, fetchBranches]);

  // File tree construction representing uncommitted changes (folder depth hierarchical)
  const fileTreeRoot = useMemo(() => {
    if (!gitState?.modifiedFiles) return buildFileTree([]);
    return buildFileTree(gitState.modifiedFiles);
  }, [gitState?.modifiedFiles]);

  // Recursive folder expand state initializer
  useEffect(() => {
    if (gitState?.modifiedFiles) {
      setExpandedFolders((prev) => {
        const next = { ...prev };
        for (const f of gitState.modifiedFiles) {
          const parts = f.file.split(/[/\\]/);
          let acc = "";
          for (let i = 0; i < parts.length - 1; i++) {
            acc = acc ? `${acc}/${parts[i]}` : parts[i];
            if (next[acc] === undefined) {
              next[acc] = true; // Auto expand folders by default
            }
          }
        }
        return next;
      });
    }
  }, [gitState?.modifiedFiles]);

  const handleCheckoutBranch = async (branch: string) => {
    if (!cwd) return;
    setBranchLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "checkout", branchName: branch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      showNotification(`Successfully checked out to branch: ${branch}`);
      setSelectedBranchForAction(null);
      await fetchGitStatus();
      await fetchBranches();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBranchLoading(false);
    }
  };

  const handleMergeBranch = async (branch: string) => {
    if (!cwd) return;
    if (!window.confirm(`Merge "${branch}" branches into current "${gitState?.branch}" branch?`)) return;
    setBranchLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "merge", targetBranch: branch }),
      });
      const data = await res.json();
      if (data.conflicted) {
        setError("Merge Conflict Occurred! Resolve manually under Changes tab.");
        await fetchGitStatus();
      } else {
        if (!res.ok) throw new Error(data.error || "Merge failed");
        showNotification(`Merge from "${branch}" successful!`);
        setSelectedBranchForAction(null);
        await fetchGitStatus();
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBranchLoading(false);
    }
  };

  const handleFetch = async () => {
    if (!cwd) return;
    setFetching(true);
    setError(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "fetch" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fetch failed");
      showNotification("Fetch successful! Remote indexes updated.");
      if (activeSubTab === "branches") await fetchBranches();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setFetching(false);
    }
  };

  const handlePull = async () => {
    if (!cwd) return;
    setPulling(true);
    setError(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "pull" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Pull failed");
      showNotification("Pull from upstream repository completed successfully!");
      await fetchGitStatus();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setPulling(false);
    }
  };

  const handlePush = async () => {
    if (!cwd) return;
    setPushing(true);
    setError(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "push" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Push failed");
      showNotification("Push complete! Branches synchronized with origin.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setPushing(false);
    }
  };

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim() || !cwd) return;

    // Check which files are checked to build stage
    const selectedFiles = Object.keys(checkedFiles).filter((f) => checkedFiles[f]);
    if (selectedFiles.length === 0) {
      alert("Please select at least one file to commit");
      return;
    }

    setCommiting(true);
    setError(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "commit", commitMessage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Commit failed");

      showNotification(`Saved commit: "${commitMessage}" successfully!`);
      setCommitMessage("");
      setSelectedDiffFile(null);
      await fetchGitStatus();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setCommiting(false);
    }
  };

  // Rollback selected checked changes
  const handleRollbackSelected = async () => {
    const selectedFiles = Object.keys(checkedFiles).filter((f) => checkedFiles[f]);
    if (selectedFiles.length === 0) return;
    if (!window.confirm(`Discard all local unstaged changes for the ${selectedFiles.length} selected files?`)) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "rollback", rollbackFiles: selectedFiles }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Discard changes failed");
      showNotification("Selected alterations rolled back successfully!");
      setSelectedDiffFile(null);
      setCheckedFiles({});
      await fetchGitStatus();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  // File Diff view fetching
  const triggerDiffView = async (filePath: string) => {
    setSelectedDiffFile(filePath);
    setDiffLoading(true);
    setDiffData(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "diff", filePath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Diff load failed");
      setDiffData({ oldContent: data.oldContent || "", newContent: data.newContent || "" });
    } catch (err: any) {
      console.error(err);
    } finally {
      setDiffLoading(false);
    }
  };

  // Conflict direct resolves (with ours/theirs)
  const handleConflictResolve = async (filePath: string, mode: "mine" | "theirs") => {
    setError(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "resolve-conflict", filePath, resolveConflictMode: mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Conflict resolution failed");
      showNotification(`Conflict in ${filePath} resolved!`);
      // Update Diff details
      await triggerDiffView(filePath);
      await fetchGitStatus();
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  };

  // Commit history files reader loader (6A)
  const fetchCommitFiles = useCallback(async (commitHash: string) => {
    setSelectedCommitHash(commitHash);
    setCommitDetailsFiles([]);
    setCommitFilesLoading(true);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "commit-files", branchName: commitHash }), // reuse name
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Commit files load failed");
      setCommitDetailsFiles(data.files || []);
    } catch (err) {
      console.error(err);
    } finally {
      setCommitFilesLoading(false);
    }
  }, [cwd]);

  // Recurse directory visual node (7A Folding Folder visual rendering nodes)
  const renderTreeNodes = (node: FileTreeNode, depth = 0) => {
    return Object.values(node.children).map((child) => {
      const isFolder = child.isFolder;
      const path = child.fullPath;
      const isExpanded = !!expandedFolders[path];
      const leftPadding = depth * 12 + 6;

      if (isFolder) {
        return (
          <div key={path}>
            <div
              onClick={() => setExpandedFolders((p) => ({ ...p, [path]: !p[path] }))}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "3px 6px",
                paddingLeft,
                cursor: "pointer",
                borderRadius: 4,
                fontSize: 11,
                color: "var(--text-muted)",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "none"}
            >
              {/* Triangle toggle */}
              <span
                style={{
                  fontSize: 8,
                  marginRight: 4,
                  transform: isExpanded ? "rotate(90deg)" : "none",
                  transition: "transform 0.1s",
                  display: "inline-block",
                  color: "var(--text-dim)",
                }}
              >
                ▶
              </span>
              <span style={{ fontSize: 11, fontWeight: 600 }}>{child.name}</span>
            </div>
            {isExpanded && renderTreeNodes(child, depth + 1)}
          </div>
        );
      } else {
        const file = child.fileEntry!;
        const isChecked = !!checkedFiles[file.file];
        const statusType = file.status.trim().toUpperCase();
        
        let statusColor = "var(--text-dim)";
        if (statusType.includes("M")) statusColor = "#eab308";
        else if (statusType.includes("A") || statusType.includes("??")) statusColor = "#22c55e";
        else if (statusType.includes("D")) statusColor = "#ef4444";

        const isDoubleClicked = selectedDiffFile === file.file;

        return (
          <div
            key={path}
            onDoubleClick={() => triggerDiffView(file.file)}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "4px 6px",
              paddingLeft,
              fontSize: 11.5,
              borderRadius: 4,
              cursor: "pointer",
              background: isDoubleClicked ? "rgba(37,99,235,0.06)" : "transparent",
              border: isDoubleClicked ? "1px solid rgba(37,99,235,0.18)" : "1px solid transparent",
              transition: "background 0.1s",
            }}
            onMouseEnter={(e) => { if (!isDoubleClicked) e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { if (!isDoubleClicked) e.currentTarget.style.background = "none"; }}
            title="Double click to review inline changes diff (对比)"
          >
            {/* Checked Box */}
            <input
              type="checkbox"
              checked={isChecked}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setCheckedFiles((p) => ({ ...p, [file.file]: e.target.checked }))}
              style={{ marginRight: 6, width: 12, height: 12, cursor: "pointer" }}
            />
            {/* Status symbol badge */}
            <span style={{ fontSize: 10, fontWeight: 700, width: 18, color: statusColor, marginRight: 2 }}>
              {file.isConflict ? "⚠️" : file.status}
            </span>
            <span style={{ flex: 1, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>
              {child.name}
            </span>
          </div>
        );
      }
    });
  };

  // Diff parser to generate side by side view inside changes
  const computedDiffLines = useMemo(() => {
    if (!diffData) return [];
    const oldLines = diffData.oldContent.split("\n");
    const newLines = diffData.newContent.split("\n");
    
    // Quick diff compiler
    const out: { type: "add" | "del" | "same"; text: string; num?: number }[] = [];
    let i = 0, j = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        out.push({ type: "same", text: oldLines[i], num: j + 1 });
        i++; j++;
      } else if (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
        out.push({ type: "del", text: oldLines[i], num: i + 1 });
        i++;
      } else if (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) {
        out.push({ type: "add", text: newLines[j], num: j + 1 });
        j++;
      }
    }
    return out;
  }, [diffData]);

  // Overall counts checker
  const filesCheckedCount = Object.keys(checkedFiles).filter((f) => checkedFiles[f]).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", overflow: "hidden" }}>
      {/* 3B: SUB TABS HEADERS */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          padding: "4px 8px",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setActiveSubTab("changes")}
          style={{
            padding: "3px 8px",
            fontSize: 11,
            fontWeight: activeSubTab === "changes" ? 700 : 500,
            background: activeSubTab === "changes" ? "var(--bg)" : "transparent",
            color: activeSubTab === "changes" ? "var(--accent)" : "var(--text-muted)",
            border: activeSubTab === "changes" ? "1px solid var(--border)" : "1px solid transparent",
            borderRadius: 5,
            cursor: "pointer",
          }}
        >
          📝 Changes
        </button>
        <button
          onClick={() => setActiveSubTab("branches")}
          style={{
            padding: "3px 8px",
            fontSize: 11,
            fontWeight: activeSubTab === "branches" ? 700 : 500,
            background: activeSubTab === "branches" ? "var(--bg)" : "transparent",
            color: activeSubTab === "branches" ? "var(--accent)" : "var(--text-muted)",
            border: activeSubTab === "branches" ? "1px solid var(--border)" : "1px solid transparent",
            borderRadius: 5,
            cursor: "pointer",
          }}
        >
          🌿 Branches
        </button>
        <button
          onClick={() => setActiveSubTab("history")}
          style={{
            padding: "3px 8px",
            fontSize: 11,
            fontWeight: activeSubTab === "history" ? 700 : 500,
            background: activeSubTab === "history" ? "var(--bg)" : "transparent",
            color: activeSubTab === "history" ? "var(--accent)" : "var(--text-muted)",
            border: activeSubTab === "history" ? "1px solid var(--border)" : "1px solid transparent",
            borderRadius: 5,
            cursor: "pointer",
          }}
        >
          📜 History
        </button>

        {/* Global pull triggers in header bar */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 3 }}>
          <button
            onClick={fetchGitStatus}
            disabled={loading}
            title="Refresh Git State"
            style={{
              padding: "2px 5px", fontSize: 10, background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", borderRadius: 3
            }}
          >
            🔄
          </button>
        </div>
      </div>

      {/* BODY CONTENT DIVIDER */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* SUBTAB 1: CHANGES TREE (📝) */}
        {activeSubTab === "changes" && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            
            {/* Commit stage controls */}
            <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  const selectAll = Object.keys(checkedFiles).some((f) => !checkedFiles[f]);
                  const next: Record<string, boolean> = {};
                  gitState?.modifiedFiles.forEach((file) => {
                    next[file.file] = selectAll;
                  });
                  setCheckedFiles(next);
                }}
                disabled={!gitState?.modifiedFiles || gitState?.modifiedFiles.length === 0}
                style={{
                  fontSize: 10.5,
                  padding: "3px 6px",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  cursor: "pointer",
                  color: "var(--text-muted)",
                }}
              >
                {filesCheckedCount === (gitState?.modifiedFiles.length ?? 0) ? "Deselect All" : "Select All"}
              </button>

              <button
                onClick={handleRollbackSelected}
                disabled={filesCheckedCount === 0 || loading}
                title="Discard uncommitted deletions/edits in checked files"
                style={{
                  fontSize: 10.5,
                  padding: "3px 6px",
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  borderRadius: 4,
                  cursor: "pointer",
                  color: "#ef4444",
                }}
              >
                Rollback({filesCheckedCount})
              </button>

              <div style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-dim)", fontWeight: 500 }}>
                {gitState?.branch && <span>branch: <strong style={{ color: "var(--accent)" }}>{gitState.branch}</strong></span>}
              </div>
            </div>

            {/* Tree View changes list (7A) */}
            <div style={{ flex: selectedDiffFile ? 0.4 : 1, minHeight: 90, overflowY: "auto", padding: "6px 4px" }}>
              {loading && gitState === null ? (
                <div style={{ padding: 12, fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }} className="animate-pulse">Loading modified files tree...</div>
              ) : gitState?.isClean ? (
                <div style={{ padding: 18, textAlign: "center", display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" />
                  </svg>
                  <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>Working tree completely clean!</span>
                </div>
              ) : (
                renderTreeNodes(fileTreeRoot)
              )}
            </div>

            {/* Commit Message Box Section */}
            {!gitState?.isClean && (
              <form onSubmit={handleCommit} style={{ padding: "6px 8px", borderTop: "1px solid var(--border)", display: "flex", gap: 4, background: "var(--bg-panel)", flexShrink: 0 }}>
                <input
                  type="text"
                  placeholder={`Commit ${filesCheckedCount} files...`}
                  value={commitMessage}
                  required
                  disabled={committing || filesCheckedCount === 0}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  style={{
                    flex: 1, fontSize: 11, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", outline: "none", minWidth: 0
                  }}
                />
                <button
                  type="submit"
                  disabled={committing || filesCheckedCount === 0 || !commitMessage.trim()}
                  style={{
                    fontSize: 11, fontWeight: 700, padding: "0 10px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", opacity: filesCheckedCount === 0 ? 0.5 : 1
                  }}
                >
                  {committing ? "..." : "Commit"}
                </button>
              </form>
            )}

            {/* Split Dual view Embedded Diff rendering bottom zone (4C) */}
            {selectedDiffFile && (
              <div style={{ flex: 0.6, borderTop: "2px solid var(--border)", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-panel)", padding: "4px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                  <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>
                    ✏️ Diff: {selectedDiffFile}
                  </span>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {gitState?.modifiedFiles.find((f) => f.file === selectedDiffFile)?.isConflict && (
                      <>
                        <button
                          onClick={() => handleConflictResolve(selectedDiffFile, "mine")}
                          style={{ padding: "2px 6px", fontSize: 9.5, background: "#22c55e", border: "none", color: "#fff", borderRadius: 3, cursor: "pointer" }}
                        >
                          🟢 KEEP OURS (我的)
                        </button>
                        <button
                          onClick={() => handleConflictResolve(selectedDiffFile, "theirs")}
                          style={{ padding: "2px 6px", fontSize: 9.5, background: "var(--accent)", border: "none", color: "#fff", borderRadius: 3, cursor: "pointer" }}
                        >
                          🔵 KEEP THEIRS (他们的)
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setSelectedDiffFile(null)}
                      style={{ padding: "2px 5px", fontSize: 12, border: "none", background: "none", color: "var(--text-dim)", cursor: "pointer" }}
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Diff comparative code list viewport */}
                <div style={{ flex: 1, overflowY: "auto", padding: "4px", background: "var(--bg)", fontFamily: "var(--font-mono)", fontSize: 10.5, lineHeight: 1.4 }}>
                  {diffLoading ? (
                    <div style={{ padding: 12, color: "var(--text-dim)", fontStyle: "italic" }} className="animate-pulse">Loading diff lines comparison...</div>
                  ) : computedDiffLines.length === 0 ? (
                    <div style={{ padding: 12, color: "var(--text-dim)", fontStyle: "italic" }}>No diff line content changed. Maybe newly added file.</div>
                  ) : (
                    computedDiffLines.map((line, idx) => {
                      let lineBg = "transparent";
                      let sign = " ";
                      let color = "var(--text-muted)";
                      
                      if (line.type === "add") {
                        lineBg = "rgba(34,197,94,0.08)";
                        sign = "+";
                        color = "#22c55e";
                      } else if (line.type === "del") {
                        lineBg = "rgba(239,68,68,0.08)";
                        sign = "-";
                        color = "#ef4444";
                      }

                      return (
                        <div key={idx} style={{ display: "flex", background: lineBg, borderBottom: "1px solid rgba(120,120,120,0.02)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                          <span style={{ width: 22, color: "var(--text-dim)", userSelect: "none", textVariantNumeric: "tabular-nums", borderRight: "1px solid var(--border)", paddingRight: 4, display: "inline-block", textAlign: "right" }}>
                            {line.num}
                          </span>
                          <span style={{ color, paddingLeft: 4, fontWeight: line.type !== "same" ? "bold" : "normal" }}>
                            {sign} {line.text}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 2: BRANCHES & REMOTES (🌿) */}
        {activeSubTab === "branches" && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto", padding: "8px 10px" }}>
            
            {/* Quick action bar */}
            <div style={{ display: "flex", gap: 5, marginBottom: 12 }} title="Upstream Pull, Fetch and Push commands">
              <button
                onClick={handlePull}
                disabled={pulling || pushing || fetching}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 3, padding: "6px 0", fontSize: 11, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-hover)", color: "var(--text)", cursor: "pointer"
                }}
              >
                ⬇️ Pull
              </button>
              <button
                onClick={handleFetch}
                disabled={pulling || pushing || fetching}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 3, padding: "6px 0", fontSize: 11, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-hover)", color: "var(--text)", cursor: "pointer"
                }}
              >
                🔄 Fetch
              </button>
              <button
                onClick={handlePush}
                disabled={pulling || pushing || fetching}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 3, padding: "6px 0", fontSize: 11, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-hover)", color: "var(--text)", cursor: "pointer"
                }}
              >
                ⬆️ Push
              </button>
            </div>

            {/* Merge Conflict Warning Banner */}
            {gitState?.isMerging && (
              <div style={{ padding: "8px 10px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: "bold", color: "#ef4444" }}>⚠️ Active Merge Conflict!</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                  Go to Changes tab, double click conflicted files and click ours/theirs flags to resolve them.
                </div>
              </div>
            )}

            {branchLoading ? (
              <div style={{ padding: 12, fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }} className="animate-pulse">Fetching branches topology list...</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                
                {/* Local Branches list */}
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", marginBottom: 4 }}>
                    Local Branch列表 ({localBranches.length})
                  </div>
                  {localBranches.map((lbl) => {
                    const isCurrent = lbl === gitState?.branch;
                    const isFocused = selectedBranchForAction === lbl;

                    return (
                      <div
                        key={lbl}
                        onClick={() => { if (!isCurrent) setSelectedBranchForAction(lbl); }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "6px 8px",
                          borderRadius: 5,
                          fontSize: 11.5,
                          cursor: isCurrent ? "default" : "pointer",
                          background: isCurrent ? "rgba(37,99,235,0.06)" : isFocused ? "var(--bg-selected)" : "transparent",
                          border: isCurrent ? "1px solid rgba(37,99,235,0.18)" : "1px solid transparent",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 4, overflow: "hidden" }}>
                          {isCurrent && <span style={{ color: "var(--accent)" }}>●</span>}
                          <span style={{ fontWeight: isCurrent ? 700 : 400, color: isCurrent ? "var(--text)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {lbl}
                          </span>
                        </div>

                        {/* Dropdown checkout actions */}
                        {!isCurrent && isFocused && (
                          <div style={{ display: "flex", gap: 3 }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCheckoutBranch(lbl); }}
                              style={{ padding: "2px 6px", fontSize: 9.5, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                            >
                              Checkout
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleMergeBranch(lbl); }}
                              style={{ padding: "2px 6px", fontSize: 9.5, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 4, cursor: "pointer" }}
                            >
                              Merge into Current
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Remote Branches list */}
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", marginBottom: 4 }}>
                    Remotes/Origin ({remoteBranches.length})
                  </div>
                  {remoteBranches.map((rbl) => {
                    const isRemoteFocused = selectedBranchForAction === rbl;

                    return (
                      <div
                        key={rbl}
                        onClick={() => setSelectedBranchForAction(rbl)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "6px 8px",
                          borderRadius: 5,
                          fontSize: 11.5,
                          cursor: "pointer",
                          background: isRemoteFocused ? "var(--bg-selected)" : "transparent",
                        }}
                      >
                        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={rbl}>
                          {rbl}
                        </span>

                        {isRemoteFocused && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCheckoutBranch(rbl); }}
                            style={{ padding: "2px 6px", fontSize: 9.5, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                          >
                            Checkout Local
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 3: HISTORY LIST (📜) */}
        {activeSubTab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
            {/* 6A: History Log list Viewport (Top half) */}
            <div style={{ flex: selectedCommitHash ? 0.45 : 1, minHeight: 90, overflowY: "auto", borderBottom: selectedCommitHash ? "2px solid var(--border)" : "none", padding: "6px" }}>
              {loading && gitState === null ? (
                <div style={{ padding: 12, fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }} className="animate-pulse">Loading commits stream...</div>
              ) : (
                gitState?.history.map((commit, i) => {
                  const isFocused = selectedCommitHash === commit.hash;
                  return (
                    <div
                      key={commit.hash}
                      onClick={() => fetchCommitFiles(commit.hash)}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        padding: "5px 6px",
                        borderRadius: 4,
                        fontSize: 11,
                        cursor: "pointer",
                        background: isFocused ? "var(--bg-selected)" : "transparent",
                      }}
                      onMouseEnter={(e) => { if (!isFocused) e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { if (!isFocused) e.currentTarget.style.background = "none"; }}
                    >
                      {/* Interactive visual bullet node */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative", height: "100%", paddingTop: 4 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: i === 0 ? "var(--accent)" : "var(--border)", zIndex: 2 }} />
                        {i < gitState.history.length - 1 && (
                          <div style={{ width: 1, position: "absolute", top: 8, bottom: -14, background: "var(--border)", zIndex: 1 }} />
                        )}
                      </div>
                      
                      {/* Commit hash & short title */}
                      <div style={{ display: "flex", gap: 6, overflow: "hidden" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>
                          {commit.hash}
                        </span>
                        <span style={{ color: isFocused ? "var(--text)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={commit.message}>
                          {commit.message}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* 6A: Commit Details view showing altered files list (Bottom half) */}
            {selectedCommitHash && (
              <div style={{ flex: 0.55, display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-panel)", padding: "4px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)" }}>
                    📦 Commit files: <strong style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{selectedCommitHash}</strong>
                  </span>
                  <button
                    onClick={() => setSelectedCommitHash(null)}
                    style={{ padding: "1px 4px", fontSize: 12, border: "none", background: "none", color: "var(--text-dim)", cursor: "pointer" }}
                  >
                    ×
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: "6px" }}>
                  {commitFilesLoading ? (
                    <div style={{ padding: 12, color: "var(--text-dim)", fontStyle: "italic" }} className="animate-pulse">Loading commit file list...</div>
                  ) : commitDetailsFiles.length === 0 ? (
                    <div style={{ padding: 12, color: "var(--text-dim)", fontStyle: "italic" }}>No details found for this commit</div>
                  ) : (
                    commitDetailsFiles.map((file, idx) => {
                      const stat = file.status.trim().toUpperCase();
                      let color = "var(--text-muted)";
                      if (stat.includes("M")) color = "#eab308";
                      else if (stat.includes("A")) color = "#22c55e";
                      else if (stat.includes("D")) color = "#ef4444";

                      return (
                        <div
                          key={idx}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "3px 0",
                            fontSize: 11,
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          <span style={{ width: 18, fontWeight: 700, fontSize: 10, color }}>
                            {file.status}
                          </span>
                          <span style={{ color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.file}>
                            {file.file}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* FOOTER ACTION STATUS BAR */}
      {actionSuccess && (
        <div
          style={{
            padding: "5px 10px",
            background: "rgba(34,197,94,0.08)",
            borderTop: "1px solid rgba(34,197,94,0.15)",
            fontSize: 10,
            color: "#22c55e",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          <span style={{ borderRadius: "50%", width: 5, height: 5, background: "#22c55e" }} />
          {actionSuccess}
        </div>
      )}
    </div>
  );
}
