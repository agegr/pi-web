"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";

interface Props {
  cwd: string;
  inline?: boolean;
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
  ahead: number;
  behind: number;
  modifiedFiles: GitFileInfo[];
  history: GitHistoryCommit[];
  isMerging: boolean;
  isClean: boolean;
}

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

export function GitPanel({ cwd }: Props) {
  const [activeSubTab, setActiveSubTab] = useState<"changes" | "branches" | "history">("changes");
  const [gitState, setGitState] = useState<GitState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 1. Changes tab state
  const [checkedFiles, setCheckedFiles] = useState<Record<string, boolean>>({});
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommiting] = useState(false);
  
  // ── POPUP DIALOG MODE FOR DIFFS (像 IDEA 类似，在全视野弹出红绿对照，支持宽阔阅读和上下滚动) ──
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<{ oldContent: string; newContent: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [historicalDiffHash, setHistoricalDiffHash] = useState<string | null>(null);

  // Expanded folders state map for folder tree
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  // 2. Branches state
  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [selectedBranchForAction, setSelectedBranchForAction] = useState<string | null>(null);
  const [newBranchInput, setNewBranchInput] = useState("");
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);

  // Command running overlay statuses
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [showForcePushBtn, setShowForcePushBtn] = useState(false);

  // 3. History Commit detail view (6A)
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [commitDetailsFiles, setCommitDetailsFiles] = useState<{ status: string; file: string }[]>([]);
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);

  // Height of history bottom panel (adjustable split)
  const [historySplitHeight, setHistorySplitHeight] = useState(250);
  const historyResizerRef = useRef<HTMLDivElement>(null);

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
      if (!res.ok) throw new Error(data.error || "获取 Git 状态失败");
      
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
              next[f.file] = true; // Checked by default
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
      if (!res.ok) throw new Error(data.error || "获取分支列表失败");
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

  // Handle history split dragging
  const handleSplitMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = historySplitHeight;
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY;
      // Invert delta because lower height increases when dragging up
      setHistorySplitHeight(Math.max(100, Math.min(500, startH - delta)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

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
      if (!res.ok) throw new Error(data.error || "切换分支失败");
      showNotification(`成功切换至分支: ${branch}`);
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
    if (!window.confirm(`确认将分支 "${branch}" 合并到当前分支 "${gitState?.branch}" 吗？`)) return;
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
        setError("发生合并冲突！请在「变更清单」下双击冲突文件进行手动解决。");
        await fetchGitStatus();
      } else {
        if (!res.ok) throw new Error(data.error || "合并失败");
        showNotification(`成功从 "${branch}" 分支合并！`);
        setSelectedBranchForAction(null);
        await fetchGitStatus();
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBranchLoading(false);
    }
  };

  const handleDeleteBranch = async (branch: string) => {
    if (!cwd) return;
    if (!window.confirm(`确认【强行删除】本地分支 "${branch}" 吗？该操作不可撤销！`)) return;
    setBranchLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "delete-branch", branchName: branch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除本地分支失败");
      showNotification(`成功强行删除本地分支: ${branch}`);
      setSelectedBranchForAction(null);
      await fetchBranches();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBranchLoading(false);
    }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchInput.trim() || !cwd) return;
    setBranchLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "create-branch", branchName: newBranchInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "新建分支失败");
      showNotification(`成功创建新分支并切入: ${newBranchInput}`);
      setNewBranchInput("");
      setIsCreatingBranch(false);
      await fetchGitStatus();
      await fetchBranches();
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
      if (!res.ok) throw new Error(data.error || "同步拉取远端失败");
      showNotification("同步远端成功！远端分支索引已刷新。");
      await fetchGitStatus();
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
      if (!res.ok) throw new Error(data.error || "拉取更新失败");
      showNotification("成功拉取远端更新并同步本地代码！");
      await fetchGitStatus();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setPulling(false);
    }
  };

  const handlePush = async (force = false) => {
    if (!cwd) return;
    setPushing(true);
    setError(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "push", forcePush: force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "推送远程失败");
      showNotification(force ? "【强制推送】成功同步至远程仓库！" : "推送成功！本地提交已完美同步至远程。");
      await fetchGitStatus();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setPushing(false);
    }
  };

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim() || !cwd) return;

    const selectedFiles = Object.keys(checkedFiles).filter((f) => checkedFiles[f]);
    if (selectedFiles.length === 0) {
      alert("请至少勾选一个要提交的文件");
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
      if (!res.ok) throw new Error(data.error || "提交失败");

      showNotification(`成功保存提交: "${commitMessage}"！`);
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
    if (!window.confirm(`确认舍弃这 ${selectedFiles.length} 个勾选文件的本地修改吗？此操作无法恢复！`)) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "rollback", rollbackFiles: selectedFiles }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "撤销修改失败");
      showNotification("选中的本地更改已全部舍弃！");
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
  const triggerDiffView = async (filePath: string, historicalHash?: string) => {
    setSelectedDiffFile(filePath);
    setHistoricalDiffHash(historicalHash || null);
    setDiffLoading(true);
    setDiffData(null);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "diff", filePath, commitHash: historicalHash }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取对比差异失败");
      setDiffData({ oldContent: data.oldContent ?? "", newContent: data.newContent ?? "" });
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
      if (!res.ok) throw new Error(data.error || "冲突自动解决失败");
      showNotification(`文件冲突已成功解决！已选择保留${mode === "mine" ? "我的修改" : "对方的修改"}`);
      await triggerDiffView(filePath);
      await fetchGitStatus();
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  };

  // Commit history files reader loader (6A)
  const fetchCommitFiles = useCallback(async (commitHash: string) => {
    setSelectedCommitHash(commitHash);
    setDiffData(null);
    setCommitDetailsFiles([]);
    setCommitFilesLoading(true);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "commit-files", branchName: commitHash }), // reuse name
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取历史提交文件清单失败");
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
                padding: "4px 6px",
                paddingLeft: leftPadding,
                cursor: "pointer",
                borderRadius: 4,
                fontSize: 11,
                color: "var(--text-muted)",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "none"}
            >
              {/* Folder angle toggle arrow */}
              <span
                style={{
                  fontSize: 7,
                  width: 10,
                  marginRight: 4,
                  transform: isExpanded ? "rotate(90deg)" : "none",
                  transition: "transform 0.1s",
                  display: "inline-block",
                  color: "var(--text-dim)",
                }}
              >
                ▶
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)" }}>{child.name}</span>
            </div>
            {isExpanded && renderTreeNodes(child, depth + 1)}
          </div>
        );
      } else {
        const file = child.fileEntry!;
        const isChecked = !!checkedFiles[file.file];
        const rawStatus = file.status.trim();
        const statusType = rawStatus.toUpperCase();
        
        let statusColor = "var(--text-dim)";
        let statusLabel = rawStatus;

        if (statusType === "M") {
          statusColor = "#eab308";
          statusLabel = "已修改";
        } else if (statusType === "A" || statusType === "??") {
          statusColor = "#22c55e";
          statusLabel = "未追踪";
        } else if (statusType === "D") {
          statusColor = "#ef4444";
          statusLabel = "已删除";
        }

        const isDoubleClicked = selectedDiffFile === file.file && !historicalDiffHash;

        return (
          <div
            key={path}
            onDoubleClick={() => triggerDiffView(file.file)}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "4px 6px",
              paddingLeft: leftPadding,
              fontSize: 11.5,
              borderRadius: 4,
              cursor: "pointer",
              background: isDoubleClicked ? "rgba(37,99,235,0.06)" : "transparent",
              border: isDoubleClicked ? "1px solid rgba(37,99,235,0.18)" : "1px solid transparent",
              transition: "background 0.1s",
            }}
            onMouseEnter={(e) => { if (!isDoubleClicked) e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { if (!isDoubleClicked) e.currentTarget.style.background = "none"; }}
            title="双击进行行级 Diff 代码差异比对"
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
            <span style={{ fontSize: 9.5, fontWeight: 700, width: 36, color: statusColor, marginRight: 2, textTransform: "uppercase" }}>
              {file.isConflict ? "冲突" : statusLabel}
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", overflow: "hidden", borderLeft: "1px solid var(--border)", background: "var(--bg)" }}>
      {/* 3B: SUB TABS HEADERS */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          padding: "6px 8px",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setActiveSubTab("changes")}
          style={{
            padding: "4px 10px",
            fontSize: 11.5,
            fontWeight: activeSubTab === "changes" ? 700 : 500,
            background: activeSubTab === "changes" ? "var(--bg)" : "transparent",
            color: activeSubTab === "changes" ? "var(--text)" : "var(--text-muted)",
            border: activeSubTab === "changes" ? "1px solid var(--border)" : "1px solid transparent",
            borderRadius: 5,
            cursor: "pointer",
          }}
        >
          变更清单
        </button>
        <button
          onClick={() => setActiveSubTab("branches")}
          style={{
            padding: "4px 10px",
            fontSize: 11.5,
            fontWeight: activeSubTab === "branches" ? 700 : 500,
            background: activeSubTab === "branches" ? "var(--bg)" : "transparent",
            color: activeSubTab === "branches" ? "var(--text)" : "var(--text-muted)",
            border: activeSubTab === "branches" ? "1px solid var(--border)" : "1px solid transparent",
            borderRadius: 5,
            cursor: "pointer",
          }}
        >
          分支管理
        </button>
        <button
          onClick={() => setActiveSubTab("history")}
          style={{
            padding: "4px 10px",
            fontSize: 11.5,
            fontWeight: activeSubTab === "history" ? 700 : 500,
            background: activeSubTab === "history" ? "var(--bg)" : "transparent",
            color: activeSubTab === "history" ? "var(--text)" : "var(--text-muted)",
            border: activeSubTab === "history" ? "1px solid var(--border)" : "1px solid transparent",
            borderRadius: 5,
            cursor: "pointer",
          }}
        >
          提交日志
        </button>

        {/* Global pull triggers in header bar */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 3 }}>
          <button
            onClick={fetchGitStatus}
            disabled={loading}
            title="刷新 Git 状态"
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
            
            {/* Top Toolbar Action menus aligned with IDEA (8 core commands) */}
            <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6, alignItems: "center", flexShrink: 0, flexWrap: "wrap", background: "var(--bg-panel)" }}>
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
                  padding: "4px 8px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                {filesCheckedCount === (gitState?.modifiedFiles.length ?? 0) ? "取消全选" : "全选文件"}
              </button>

              <button
                onClick={handleRollbackSelected}
                disabled={filesCheckedCount === 0 || loading}
                title="舍弃勾选文件本轮发生的所有代码修改"
                style={{
                  fontSize: 10.5,
                  padding: "4px 8px",
                  background: "rgba(239,68,68,0.06)",
                  border: "1px solid rgba(239,68,68,0.18)",
                  borderRadius: 5,
                  cursor: "pointer",
                  color: "#ef4444",
                  fontWeight: 600,
                }}
              >
                撤销修改({filesCheckedCount})
              </button>

              {/* IDEA push & pull actions right next to Commit inputs */}
              <button
                onClick={handlePull}
                disabled={pulling || loading}
                title="Git Pull: 快速拉取合并远端分支"
                style={{
                  fontSize: 10.5,
                  padding: "4px 8px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                拉取 Pull
              </button>

              <div style={{ position: "relative", display: "inline-flex" }}>
                <button
                  onClick={() => handlePush(false)}
                  disabled={pushing || loading}
                  title="Git Push: 上报推送本地提交"
                  style={{
                    fontSize: 10.5,
                    padding: "4px 8px",
                    background: "rgba(37,99,235,0.08)",
                    border: "1px solid rgba(37,99,235,0.22)",
                    borderRadius: "5px 0 0 5px",
                    cursor: "pointer",
                    color: "var(--accent)",
                    fontWeight: 700,
                  }}
                >
                  推送 Push
                </button>
                <button
                  onClick={() => setShowForcePushBtn(!showForcePushBtn)}
                  style={{
                    fontSize: 8,
                    padding: "4px 5px",
                    background: "rgba(37,99,235,0.08)",
                    border: "1px solid rgba(37,99,235,0.22)",
                    borderLeft: "none",
                    borderRadius: "0 5px 5px 0",
                    cursor: "pointer",
                    color: "var(--accent)",
                  }}
                  title="强制推送高级菜单 Options"
                >
                  ▼
                </button>

                {showForcePushBtn && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      marginTop: 4,
                      zIndex: 300,
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                      padding: 4,
                      minWidth: 100,
                    }}
                  >
                    <button
                      onClick={() => {
                        setShowForcePushBtn(false);
                        if (confirm("⚠️ 注意：强制推送将会覆盖远端仓库。确认吗？")) {
                          handlePush(true);
                        }
                      }}
                      style={{
                        width: "100%",
                        padding: "5px 8px",
                        fontSize: 10,
                        border: "none",
                        background: "none",
                        color: "#ef4444",
                        fontWeight: 600,
                        cursor: "pointer",
                        textAlign: "left",
                        borderRadius: 3,
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(239,68,68,0.05)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                    >
                      🔥 强制推送 (Force)
                    </button>
                  </div>
                )}
              </div>

              {/* Connected Ahead-Behind upward/downward Indicators (5) */}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "var(--text-muted)", background: "var(--bg)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border)" }}>
                {gitState?.branch && <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)" }}>{gitState.branch}</span>}
                {gitState && (gitState.ahead > 0 || gitState.behind > 0) && (
                  <span style={{ display: "inline-flex", gap: 3, color: "var(--accent)", fontVariantNumeric: "tabular-nums" }}>
                    {gitState.behind > 0 && <span title={`${gitState.behind} commits to update (待拉取)`}>⬇️{gitState.behind}</span>}
                    {gitState.ahead > 0 && <span title={`${gitState.ahead} commits to push (待推送)`}>⬆{gitState.ahead}</span>}
                  </span>
                )}
              </div>
            </div>

            {/* Tree View changes list (7A) */}
            <div style={{ flex: 1, overflowY: "auto", padding: "6px 4px" }}>
              {loading && gitState === null ? (
                <div style={{ padding: 12, fontSize: 11.5, color: "var(--text-dim)", fontStyle: "italic" }} className="animate-pulse">正在解析本地文件夹树并加载修改文件...</div>
              ) : gitState?.isClean ? (
                <div style={{ padding: 18, textAlign: "center", display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" />
                  </svg>
                  <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>本地没有任何改动，代码完全干净！</span>
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
                  placeholder={`提交勾选的 ${filesCheckedCount} 个文件...`}
                  value={commitMessage}
                  required
                  disabled={committing || filesCheckedCount === 0}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  style={{
                    flex: 1, fontSize: 11.5, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", outline: "none", minWidth: 0
                  }}
                />
                <button
                  type="submit"
                  disabled={committing || filesCheckedCount === 0 || !commitMessage.trim()}
                  style={{
                    fontSize: 11.5, fontWeight: 700, padding: "0 12px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", opacity: filesCheckedCount === 0 ? 0.5 : 1
                  }}
                >
                  {committing ? "提交中..." : "保存提交"}
                </button>
              </form>
            )}
          </div>
        )}

        {/* SUBTAB 2: BRANCHES & REMOTES (🌿) */}
        {activeSubTab === "branches" && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto", padding: "8px 10px" }}>
            
            {/* Action Bar Aligned with IDEA Git controls (Pull/Fetch/Push/Create branch) */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
              <div style={{ display: "flex", gap: 5 }}>
                <button
                  onClick={handlePull}
                  disabled={pulling || pushing || fetching}
                  style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 3, padding: "5px 0", fontSize: 11, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: "pointer", fontWeight: 600
                  }}
                >
                  拉取 Pull
                </button>
                <button
                  onClick={handleFetch}
                  disabled={pulling || pushing || fetching}
                  style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 3, padding: "5px 0", fontSize: 11, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: "pointer", fontWeight: 600
                  }}
                >
                  获取 Fetch
                </button>
                <button
                  onClick={() => setIsCreatingBranch(!isCreatingBranch)}
                  style={{
                    flex: 1.2, display: "flex", alignItems: "center", justifyContent: "center", gap: 3, padding: "5px 0", fontSize: 11, border: "1px solid var(--border)", borderRadius: 5, background: "rgba(37,99,235,0.06)", color: "var(--accent)", cursor: "pointer", fontWeight: 600
                  }}
                >
                  ➕ 新建分支 (Branch)
                </button>
              </div>

              {/* Direct branch production form */}
              {isCreatingBranch && (
                <form onSubmit={handleCreateBranch} style={{ display: "flex", gap: 4, marginTop: 4 }}>
                  <input
                    type="text"
                    placeholder="输入新分支名称 (如: feat/ui)..."
                    value={newBranchInput}
                    required
                    onChange={(e) => setNewBranchInput(e.target.value)}
                    style={{
                      flex: 1, fontSize: 11, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", outline: "none"
                    }}
                  />
                  <button type="submit" style={{ fontSize: 11, padding: "0 8px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer" }}>
                    创建
                  </button>
                </form>
              )}
            </div>

            {/* Merge Conflict Warning Banner */}
            {gitState?.isMerging && (
              <div style={{ padding: "8px 10px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: "bold", color: "#ef4444" }}>⚠️ 当前存在未合并冲突！</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                  请前往「变更清单」，双击冲突中的文件，点击“保留我的修改”或“保留对方修改”来一秒解决冲突。
                </div>
              </div>
            )}

            {branchLoading ? (
              <div style={{ padding: 12, fontSize: 11.5, color: "var(--text-dim)", fontStyle: "italic" }} className="animate-pulse">正在获取分支拓扑列表...</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                
                {/* Local Branches list */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)", marginBottom: 4 }}>
                    本地分支 ({localBranches.length})
                  </div>
                  {localBranches.map((lbl) => {
                    const isCurrent = lbl === gitState?.branch;
                    const isFocused = selectedBranchForAction === lbl;

                    return (
                      <div
                        key={lbl}
                        onClick={() => { setSelectedBranchForAction(lbl); }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "6px 8px",
                          borderRadius: 5,
                          fontSize: 11.5,
                          cursor: "pointer",
                          background: isCurrent ? "rgba(37,99,235,0.06)" : isFocused ? "var(--bg-selected)" : "transparent",
                          border: isCurrent ? "1px solid rgba(37,99,235,0.18)" : "1px solid transparent",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 4, overflow: "hidden" }}>
                          {isCurrent && <span style={{ color: "var(--accent)", fontSize: 14 }}>●</span>}
                          <span style={{ fontWeight: isCurrent ? 700 : 500, color: isCurrent ? "var(--text)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {lbl} {isCurrent && "(当前分支)"}
                          </span>
                        </div>

                        {/* Actions for local branch */}
                        {isFocused && (
                          <div style={{ display: "flex", gap: 3 }}>
                            {!isCurrent && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCheckoutBranch(lbl); }}
                                style={{ padding: "2px 6px", fontSize: 9.5, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
                              >
                                Checkout
                              </button>
                            )}
                            {!isCurrent && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleMergeBranch(lbl); }}
                                style={{ padding: "2px 6px", fontSize: 9.5, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 4, cursor: "pointer" }}
                              >
                                合并
                              </button>
                            )}
                            {!isCurrent && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteBranch(lbl); }}
                                style={{ padding: "2px 6px", fontSize: 9.5, background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.18)", color: "#ef4444", borderRadius: 4, cursor: "pointer" }}
                              >
                                删除
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Remote Branches list */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)", marginBottom: 4 }}>
                    远程分支列表 ({remoteBranches.length})
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
                            style={{ padding: "2px 6px", fontSize: 9.5, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
                          >
                            本地跟踪
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
            <div style={{ flex: 1, minHeight: 90, overflowY: "auto", padding: "6px" }}>
              {loading && gitState === null ? (
                <div style={{ padding: 12, fontSize: 11.5, color: "var(--text-dim)", fontStyle: "italic" }} className="animate-pulse">正在获取提交树日志...</div>
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

            {/* 6A: Commit Details view showing altered files list (Bottom half, height adjustable split) */}
            {selectedCommitHash && (
              <div style={{ height: historySplitHeight, display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden", borderTop: "3px double var(--border)" }}>
                {/* Drag Handle splitter line */}
                <div
                  onMouseDown={handleSplitMouseDown}
                  style={{
                    height: 5,
                    cursor: "row-resize",
                    background: "var(--bg-panel)",
                    borderTop: "1px solid var(--border)",
                    borderBottom: "1px solid var(--border)",
                    zIndex: 200,
                  }}
                  title="可上下拖拽拉伸下方细节面板比例"
                />

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-panel)", padding: "4px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)" }}>
                    改动文件 (双击查看比对内容): <strong style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{selectedCommitHash}</strong>
                  </span>
                  <button
                    onClick={() => { setSelectedCommitHash(null); }}
                    style={{ padding: "1px 4px", fontSize: 12, border: "none", background: "none", color: "var(--text-dim)", cursor: "pointer" }}
                  >
                    ×
                  </button>
                </div>

                {/* Left modifications tree list */}
                <div style={{ flex: 1, overflowY: "auto", padding: "6px" }}>
                  {commitFilesLoading ? (
                    <div style={{ padding: 12, color: "var(--text-dim)", fontStyle: "italic" }} className="animate-pulse">Loading commit file list...</div>
                  ) : commitDetailsFiles.length === 0 ? (
                    <div style={{ padding: 12, color: "var(--text-dim)", fontStyle: "italic" }}>对应历史提交未发现修改文件</div>
                  ) : (
                    commitDetailsFiles.map((file, idx) => {
                      const stat = file.status.trim().toUpperCase();
                      let color = "var(--text-muted)";
                      let chLabel = file.status;

                      if (stat === "M") {
                        color = "#eab308";
                        chLabel = "修改";
                      } else if (stat === "A") {
                        color = "#22c55e";
                        chLabel = "新增";
                      } else if (stat === "D") {
                        color = "#ef4444";
                        chLabel = "删除";
                      }

                      return (
                        <div
                          key={idx}
                          onDoubleClick={() => triggerDiffView(file.file, selectedCommitHash)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "4px 6px",
                            fontSize: 11,
                            borderRadius: 4,
                            cursor: "pointer",
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                          title="双击查看该次提交的文件改动变化 Details"
                        >
                          <span style={{ width: 28, fontWeight: 700, fontSize: 10, color }}>
                            {chLabel}
                          </span>
                          <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.file}>
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

      {/* ── BROAD FLUID SCREEN POPUP DIFF VIEW DIALOG (完美复刻 IDEA 的高密度、宽阔全画副 Diff 比对框，支持完美纵横拖拉阅读) ── */}
      {selectedDiffFile && diffData && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedDiffFile(null); }}
        >
          <div
            style={{
              width: "min(1200px, 95vw)",
              height: "85vh",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 12px 36px rgba(0,0,0,0.25)",
              overflow: "hidden",
            }}
          >
            {/* Dialog Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 18px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-panel)",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                  {historicalDiffHash ? `📜 历史提交 Diff 对比 (${historicalDiffHash})` : "✏️ 本地工作区 Diff 编辑比对"}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    padding: "2px 8px",
                    borderRadius: 4,
                    color: "var(--accent)",
                    fontWeight: 600,
                  }}
                >
                  {selectedDiffFile}
                </span>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                {/* Conflict resolves side tool and checkout resets */}
                {gitState?.modifiedFiles.find((f) => f.file === selectedDiffFile)?.isConflict && !historicalDiffHash && (
                  <>
                    <button
                      onClick={() => handleConflictResolve(selectedDiffFile, "mine")}
                      style={{ padding: "4px 10px", fontSize: 11, background: "#22c55e", fontWeight: "bold", border: "none", color: "#fff", borderRadius: 5, cursor: "pointer" }}
                    >
                      保留我的修改 (Keep Ours)
                    </button>
                    <button
                      onClick={() => handleConflictResolve(selectedDiffFile, "theirs")}
                      style={{ padding: "4px 10px", fontSize: 11, background: "var(--accent)", fontWeight: "bold", border: "none", color: "#fff", borderRadius: 5, cursor: "pointer" }}
                    >
                      保留对方修改 (Keep Theirs)
                    </button>
                  </>
                )}
                <button
                  onClick={() => setSelectedDiffFile(null)}
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    width: 24,
                    height: 24,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    fontSize: 16,
                    color: "var(--text-muted)",
                  }}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Dialog comparative Content side list (Myers Diff lines rendering) */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: 12,
                background: "var(--bg)",
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                lineHeight: 1.5,
              }}
            >
              {completedDiffLinesCompiler(diffData.oldContent, diffData.newContent).map((line, idx) => {
                let lineBg = "transparent";
                let sign = " ";
                let color = "var(--text-muted)";
                
                if (line.type === "add") {
                  lineBg = "rgba(34,197,94,0.07)";
                  sign = "+";
                  color = "#22c55e";
                } else if (line.type === "del") {
                  lineBg = "rgba(239,68,68,0.07)";
                  sign = "-";
                  color = "#ef4444";
                }

                return (
                  <div key={idx} style={{ display: "flex", background: lineBg, borderBottom: "1px solid rgba(120,120,120,0.02)" }}>
                    <span
                      style={{
                        width: 36,
                        color: "var(--text-dim)",
                        userSelect: "none",
                        borderRight: "1px solid var(--border)",
                        paddingRight: 8,
                        display: "inline-block",
                        textAlign: "right",
                        flexShrink: 0,
                      }}
                    >
                      {line.num}
                    </span>
                    <span style={{ color, paddingLeft: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                      {sign} {line.text}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

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

// Lightweight Side-by-Side lines parser
function completedDiffLinesCompiler(oldText: string, newContent: string) {
  const oldLines = oldText.split("\n");
  const newLines = newContent.split("\n");
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
}
