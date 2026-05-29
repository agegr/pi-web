"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { getFileIcon, FolderIcon } from "./FileIcons";

interface Props { cwd: string; }

interface GitFileInfo { status: string; file: string; isConflict?: boolean; }
interface GitHistoryCommit { hash: string; message: string; }
interface GitState {
  branch: string; ahead: number; behind: number;
  modifiedFiles: GitFileInfo[]; history: GitHistoryCommit[];
  isMerging: boolean; isClean: boolean;
}

/* ─── Tree node type (same shape as FileExplorer's FileNode) ─── */

interface FileTreeNode {
  name: string;
  fullPath: string;    // relative path used as key / display
  isFolder: boolean;
  children: FileTreeNode[];
  fileEntry?: GitFileInfo;
}

function normalizeGitPath(path: string): string {
  return path.replace(/"/g, "").replace(/\\/g, "/").replace(/\/+/g, "/");
}

function splitGitPath(path: string): string[] {
  return normalizeGitPath(path).split("/").filter(Boolean);
}

function buildFileTree(files: GitFileInfo[]): FileTreeNode[] {
  type BuildNode = FileTreeNode & { childMap: Map<string, BuildNode> };

  const root: BuildNode = {
    name: "",
    fullPath: "",
    isFolder: true,
    children: [],
    childMap: new Map(),
  };

  for (const f of files) {
    const parts = splitGitPath(f.file);
    if (parts.length === 0) continue;

    let current = root;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      const isLast = i === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;

      let next = current.childMap.get(segment);
      if (!next) {
        next = {
          name: segment,
          fullPath: currentPath,
          isFolder: !isLast,
          children: [],
          childMap: new Map(),
          ...(isLast ? { fileEntry: f } : {}),
        };
        current.childMap.set(segment, next);
      }

      current = next;
    }
  }

  const toSortedTree = (node: BuildNode): FileTreeNode[] => {
    const children = Array.from(node.childMap.values()).map((child) => ({
      name: child.name,
      fullPath: child.fullPath,
      isFolder: child.isFolder,
      children: toSortedTree(child),
      ...(child.fileEntry ? { fileEntry: child.fileEntry } : {}),
    }));

    children.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return children;
  };

  return toSortedTree(root);
}

/** Collect all leaf file paths under a node */
function collectLeafFiles(node: FileTreeNode): string[] {
  const out: string[] = [];
  for (const ch of node.children) {
    if (ch.isFolder) out.push(...collectLeafFiles(ch));
    else if (ch.fileEntry) out.push(ch.fileEntry.file);
  }
  return out;
}

/** Count leaf files recursively */
function countLeafFiles(node: FileTreeNode): number {
  let c = 0;
  for (const ch of node.children) {
    if (ch.isFolder) c += countLeafFiles(ch); else c += 1;
  }
  return c;
}

/** Collect all folder paths so we can expand/collapse the whole tree at once. */
function collectFolderPaths(nodes: FileTreeNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (!node.isFolder) continue;
    out.push(node.fullPath, ...collectFolderPaths(node.children));
  }
  return out;
}

/* ─── SVG icon helpers ─── */

function Chevi({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.1s" }}>
      <polyline points="3 2 7 5 3 8" />
    </svg>
  );
}

function IconRefresh({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function IconGitBranch() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

/* ─── Status label helper ─── */

function fileStatusLabel(file: GitFileInfo): { color: string; label: string } {
  const st = file.status.trim().toUpperCase();
  if (file.isConflict) return { color: "#f97316", label: "!" };
  if (st === "M") return { color: "#eab308", label: "M" };
  if (st === "A" || st === "??") return { color: "#22c55e", label: "U" };
  if (st === "D") return { color: "#ef4444", label: "D" };
  return { color: "var(--text-dim)", label: st };
}

type TabKey = "changes" | "branches" | "history";

/* ═══════════════════════════════════════════════════════
   GitPanel
   ═══════════════════════════════════════════════════════ */

export function GitPanel({ cwd }: Props) {
  const [gitState, setGitState] = useState<GitState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("changes");

  const [checkedFiles, setCheckedFiles] = useState<Record<string, boolean>>({});
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommiting] = useState(false);

  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<{ oldContent: string; newContent: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [historicalDiffHash, setHistoricalDiffHash] = useState<string | null>(null);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [selectedBranchForAction, setSelectedBranchForAction] = useState<string | null>(null);
  const [newBranchInput, setNewBranchInput] = useState("");
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [remoteBranchesOpen, setRemoteBranchesOpen] = useState(false);

  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [showForcePushBtn, setShowForcePushBtn] = useState(false);

  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [commitDetailsFiles, setCommitDetailsFiles] = useState<{ status: string; file: string }[]>([]);
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);

  const showNotification = useCallback((msg: string) => { setActionSuccess(msg); setTimeout(() => setActionSuccess(null), 3000); }, []);

  /* ─── Data fetching ─── */

  const fetchGitStatus = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    try {
      const res = await fetch("/api/git-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, action: "status" }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取 Git 状态失败");
      if (data.error) { setError(data.error); setGitState(null); }
      else {
        setError(null);
        setGitState(data);
        // Sync checkedFiles: add new files as checked, remove files no longer present
        const currentFiles = new Set((data.modifiedFiles as GitFileInfo[]).map((f: GitFileInfo) => f.file));
        setCheckedFiles((prev) => {
          const next: Record<string, boolean> = {};
          // Keep only files that still exist in the new state
          for (const f of data.modifiedFiles as GitFileInfo[]) {
            next[f.file] = prev[f.file] !== undefined ? prev[f.file] : true;
          }
          return next;
        });
      }
    } catch (err: any) { setError(err?.message || String(err)); setGitState(null); }
    finally { setLoading(false); }
  }, [cwd]);

  const fetchBranches = useCallback(async () => {
    if (!cwd) return;
    setBranchLoading(true);
    try {
      const res = await fetch("/api/git-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, action: "list-branches" }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取分支列表失败");
      setLocalBranches(data.local || []); setRemoteBranches(data.remote || []);
    } catch { /* quiet */ }
    finally { setBranchLoading(false); }
  }, [cwd]);

  useEffect(() => { fetchGitStatus(); fetchBranches(); }, [cwd, fetchGitStatus, fetchBranches]);

  const fileTreeRoots = useMemo(() => buildFileTree(gitState?.modifiedFiles ?? []), [gitState?.modifiedFiles]);
  const allFolderPaths = useMemo(() => collectFolderPaths(fileTreeRoots), [fileTreeRoots]);
  const isAllExpanded = allFolderPaths.length > 0 && allFolderPaths.every((path) => expandedFolders.has(path));

  // Auto-expand all parent folders when files load
  useEffect(() => {
    if (!gitState?.modifiedFiles) return;
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      for (const f of gitState.modifiedFiles) {
        const parts = splitGitPath(f.file);
        let acc = "";
        for (let i = 0; i < parts.length - 1; i++) {
          acc = acc ? `${acc}/${parts[i]}` : parts[i];
          next.add(acc);
        }
      }
      return next;
    });
  }, [gitState?.modifiedFiles]);

  /* ─── Folder checkbox helpers ─── */

  const setFolderChecked = useCallback((node: FileTreeNode, checked: boolean) => {
    const leaves = collectLeafFiles(node);
    setCheckedFiles((prev) => {
      const next = { ...prev };
      for (const f of leaves) next[f] = checked;
      return next;
    });
  }, []);

  /* ─── API helper ─── */

  const api = useCallback(async (action: string, body: Record<string, unknown>) => {
    const res = await fetch("/api/git-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, action, ...body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${action} failed`);
    return data;
  }, [cwd]);

  /* ─── Branch actions ─── */

  const handleCheckoutBranch = async (branch: string) => {
    if (!cwd) return;
    setBranchLoading(true);
    try { await api("checkout", { branchName: branch }); showNotification(`已切出分支: ${branch}`); setSelectedBranchForAction(null); await fetchGitStatus(); await fetchBranches(); }
    catch (err: any) { setError(err.message); }
    finally { setBranchLoading(false); }
  };

  const handleMergeBranch = async (branch: string) => {
    if (!cwd) return;
    if (!window.confirm(`确认合并 "${branch}" 到当前分支 "${gitState?.branch}" 吗？`)) return;
    setBranchLoading(true);
    try {
      const data = await api("merge", { targetBranch: branch });
      if (data.conflicted) { setError("存在合并冲突！请在「变更清单」中双击冲突文件进行解决。"); await fetchGitStatus(); }
      else { showNotification(`成功从 "${branch}" 合并！`); setSelectedBranchForAction(null); await fetchGitStatus(); }
    } catch (err: any) { setError(err?.message || String(err)); }
    finally { setBranchLoading(false); }
  };

  const handleDeleteBranch = async (branch: string) => {
    if (!cwd) return;
    if (!window.confirm(`确认删除本地分支 "${branch}"？`)) return;
    setBranchLoading(true);
    try { await api("delete-branch", { branchName: branch }); showNotification(`已删除本地分支: ${branch}`); setSelectedBranchForAction(null); await fetchBranches(); }
    catch (err: any) { setError(err?.message || String(err)); }
    finally { setBranchLoading(false); }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchInput.trim() || !cwd) return;
    setBranchLoading(true);
    try { await api("create-branch", { branchName: newBranchInput.trim() }); showNotification(`成功创建并切入新分支: ${newBranchInput}`); setNewBranchInput(""); setIsCreatingBranch(false); await fetchGitStatus(); await fetchBranches(); }
    catch (err: any) { setError(err?.message || String(err)); }
    finally { setBranchLoading(false); }
  };

  /* ─── Git actions ─── */

  const handleFetch = async () => { setFetching(true); try { await api("fetch", {}); showNotification("已同步拉取远程索引"); await fetchGitStatus(); await fetchBranches(); } catch (err: any) { setError(err?.message || String(err)); } finally { setFetching(false); } };
  const handlePull = async () => { setPulling(true); try { await api("pull", {}); showNotification("拉取完毕，本地工作区已刷新！"); await fetchGitStatus(); } catch (err: any) { setError(err?.message || String(err)); } finally { setPulling(false); } };
  const handlePush = async (force = false) => { setPushing(true); try { await api("push", { forcePush: force }); showNotification(force ? "强制推送完成！" : "推送成功！"); await fetchGitStatus(); } catch (err: any) { setError(err?.message || String(err)); } finally { setPushing(false); } };

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim() || !cwd) return;
    const selectedFiles = Object.keys(checkedFiles).filter((f) => checkedFiles[f]);
    if (selectedFiles.length === 0) { alert("请至少勾选一个要保存的文件"); return; }
    setCommiting(true);
    try { await api("commit", { commitMessage }); showNotification(`成功保存提交: "${commitMessage}"`); setCommitMessage(""); setSelectedDiffFile(null); await fetchGitStatus(); }
    catch (err: any) { setError(err?.message || String(err)); }
    finally { setCommiting(false); }
  };

  const handleRollbackSelected = async () => {
    const selectedFiles = Object.keys(checkedFiles).filter((f) => checkedFiles[f]);
    if (selectedFiles.length === 0) return;
    if (!window.confirm(`确认丢弃这 ${selectedFiles.length} 个文件的所有本地修改吗？`)) return;
    setLoading(true);
    try { await api("rollback", { rollbackFiles: selectedFiles }); showNotification("本地选中的修改已被全部回滚舍弃"); setSelectedDiffFile(null); setCheckedFiles({}); await fetchGitStatus(); }
    catch (err: any) { setError(err?.message || String(err)); }
    finally { setLoading(false); }
  };

  /* ─── Diff helpers ─── */

  const triggerDiffView = async (filePath: string, historicalHash?: string) => {
    setSelectedDiffFile(filePath); setHistoricalDiffHash(historicalHash || null); setDiffLoading(true); setDiffData(null);
    try {
      const res = await fetch("/api/git-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, action: "diff", filePath, commitHash: historicalHash }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDiffData({ oldContent: data.oldContent ?? "", newContent: data.newContent ?? "" });
    } catch { /* quiet */ }
    finally { setDiffLoading(false); }
  };

  const handleConflictResolve = async (filePath: string, mode: "mine" | "theirs") => {
    try { await api("resolve-conflict", { filePath, resolveConflictMode: mode }); showNotification(`冲突解决完毕！已保留${mode === "mine" ? "我的修改" : "对方修改"}`); await triggerDiffView(filePath); await fetchGitStatus(); }
    catch (err: any) { setError(err.message); }
  };

  const handleRollbackFile = async (filePath: string) => {
    if (!window.confirm(`确认回滚文件 "${filePath}" 到 HEAD 版本？`)) return;
    try { await api("rollback", { rollbackFiles: [filePath] }); showNotification(`已回滚: ${filePath}`); setSelectedDiffFile(null); await fetchGitStatus(); }
    catch (err: any) { setError(err?.message || String(err)); }
  };

  const writeFileContent = useCallback(async (filePath: string, content: string) => {
    await api("write-file", { filePath, content });
  }, [api]);

  const handleRollbackHunk = useCallback(async (filePath: string, oldContent: string, newContent: string) => {
    // Read the current file, reverse the hunk, write back
    try {
      const res = await fetch("/api/git-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, action: "diff", filePath }) });
      const data = await res.json();
      const currentContent: string = data.newContent ?? "";
      // Replace the new hunk text with the old hunk text in the current content
      const idx = currentContent.indexOf(newContent);
      if (idx === -1) { setError("无法定位要回滚的代码段"); return; }
      const updated = currentContent.substring(0, idx) + oldContent + currentContent.substring(idx + newContent.length);
      await writeFileContent(filePath, updated);
      showNotification("已回滚该代码段");
      // Re-fetch diff
      await triggerDiffView(filePath, historicalDiffHash ?? undefined);
    } catch (err: any) { setError(err?.message || String(err)); }
  }, [cwd, writeFileContent, historicalDiffHash, showNotification, setError]);

  const fetchCommitFiles = useCallback(async (commitHash: string) => {
    setSelectedCommitHash(commitHash); setCommitDetailsFiles([]); setCommitFilesLoading(true);
    try { const data = await api("commit-files", { branchName: commitHash }); setCommitDetailsFiles(data.files || []); }
    catch { /* quiet */ }
    finally { setCommitFilesLoading(false); }
  }, [api]);

  /* ─── File tree rendering (mirrors FileExplorer's TreeNode pattern) ─── */

  const fileCheckedCount = Object.keys(checkedFiles).filter((f) => checkedFiles[f]).length;

  const toggleAllFiles = () => {
    const allFiles = gitState?.modifiedFiles ?? [];
    const allChecked = fileCheckedCount === allFiles.length && allFiles.length > 0;
    const next: Record<string, boolean> = {};
    allFiles.forEach((f) => { next[f.file] = !allChecked; });
    setCheckedFiles(next);
  };

  const toggleAllFolders = () => {
    setExpandedFolders(isAllExpanded ? new Set() : new Set(allFolderPaths));
  };

  /** Render a single tree node (folder or file) — same structure as FileExplorer's TreeNode */
  const renderNode = (node: FileTreeNode, depth: number): React.ReactNode => {
    const isOpen = expandedFolders.has(node.fullPath);
    const rowH = 22;
    const indent = 8 + depth * 14;

    if (node.isFolder) {
      const fileCount = countLeafFiles(node);
      const leaves = collectLeafFiles(node);
      const checkedCount = leaves.filter((f) => checkedFiles[f]).length;
      const folderChecked = checkedCount === leaves.length && leaves.length > 0;
      const folderIndeterminate = checkedCount > 0 && checkedCount < leaves.length;

      const handleToggle = () => {
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          if (next.has(node.fullPath)) next.delete(node.fullPath); else next.add(node.fullPath);
          return next;
        });
      };

      return (
        <div key={node.fullPath}>
          <div
            style={{
              position: "relative",
              display: "flex", alignItems: "center", gap: 4,
              paddingLeft: indent, paddingRight: 6,
              height: rowH, userSelect: "none",
              borderRadius: 4,
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            {/* Chevron — toggles expand/collapse */}
            <span onClick={handleToggle} style={{ display: "flex", alignItems: "center", cursor: "pointer", flexShrink: 0 }}>
              <Chevi open={isOpen} />
            </span>
            {/* Checkbox — toggles all children */}
            <input
              type="checkbox"
              checked={folderChecked}
              ref={(el) => { if (el) el.indeterminate = folderIndeterminate; }}
              onClick={(e) => e.stopPropagation()}
              onChange={() => setFolderChecked(node, !folderChecked)}
              style={{ margin: 0, width: 12, height: 12, cursor: "pointer", accentColor: "var(--accent)", flexShrink: 0 }}
            />
            {/* Folder icon */}
            <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
              <FolderIcon size={14} open={isOpen} />
            </span>
            {/* Folder name — click to toggle */}
            <span onClick={handleToggle} style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, cursor: "pointer" }}>
              {node.name}
            </span>
            {/* File count badge */}
            <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
              {fileCount}
            </span>
          </div>
          {isOpen && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    // ── Leaf file ──
    const file = node.fileEntry!;
    const isChecked = !!checkedFiles[file.file];
    const { color: statusColor, label: statusLabel } = fileStatusLabel(file);
    const isSel = selectedDiffFile === file.file && !historicalDiffHash;

    return (
      <div
        key={node.fullPath}
        onDoubleClick={() => triggerDiffView(file.file)}
        style={{
          position: "relative",
          display: "flex", alignItems: "center", gap: 4,
          paddingLeft: indent, paddingRight: 6,
          height: rowH, cursor: "pointer",
          background: isSel ? "var(--bg-selected)" : "transparent",
          borderRadius: 4,
        }}
        onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
        title={file.file + "  \u2014  \u53cc\u51fb\u67e5\u770b Diff"}
      >
        {/* Spacer where chevron would be (same width as Chevron = 10px) */}
        <span style={{ width: 10, flexShrink: 0 }} />
        <input type="checkbox" checked={isChecked} onClick={(e) => e.stopPropagation()}
          onChange={(e) => setCheckedFiles((p) => ({ ...p, [file.file]: e.target.checked }))}
          style={{ margin: 0, width: 12, height: 12, cursor: "pointer", accentColor: "var(--accent)", flexShrink: 0 }} />
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
          {getFileIcon(node.name, 14)}
        </span>
        <span style={{ fontSize: 12, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, minWidth: 14, textAlign: "center", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{statusLabel}</span>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", overflow: "hidden", background: "var(--bg)" }}>

      {/* ── Tab bar ── */}
      <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--bg-panel)" }}>
        {([
          { key: "changes" as TabKey, label: "CHANGES", count: gitState?.modifiedFiles.length ?? 0 },
          { key: "branches" as TabKey, label: "BRANCHES", count: localBranches.length },
          { key: "history" as TabKey, label: "HISTORY", count: gitState?.history.length ?? 0 },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "5px 12px", fontSize: 11, fontWeight: 600,
              letterSpacing: "0.04em", textTransform: "uppercase",
              background: activeTab === tab.key ? "var(--bg)" : "transparent",
              border: "none",
              borderBottom: activeTab === tab.key ? "2px solid var(--accent)" : "2px solid transparent",
              color: activeTab === tab.key ? "var(--text)" : "var(--text-dim)",
              cursor: "pointer", transition: "color 0.12s, border-color 0.12s",
            }}
            onMouseEnter={(e) => { if (activeTab !== tab.key) e.currentTarget.style.color = "var(--text-muted)"; }}
            onMouseLeave={(e) => { if (activeTab !== tab.key) e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            {tab.label}
            <span style={{ marginLeft: 4, fontWeight: 500, textTransform: "none", color: "var(--text-dim)" }}>({tab.count})</span>
          </button>
        ))}
        {/* Right side: current branch badge + refresh */}
        <div style={{ marginLeft: "auto", paddingRight: 8, display: "flex", alignItems: "center", gap: 6 }}>
          {gitState?.branch && (
            <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 4, fontFamily: "var(--font-mono)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 3, color: "var(--text-muted)" }}>
              <IconGitBranch />
              {gitState.branch}
              {gitState.ahead > 0 && <span style={{ color: "var(--accent)" }}>+{gitState.ahead}</span>}
              {gitState.behind > 0 && <span style={{ color: "#ef4444" }}>-{gitState.behind}</span>}
            </span>
          )}
          <button onClick={fetchGitStatus} title="重新扫描状态"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", borderRadius: 4, width: 20, height: 20 }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
          ><IconRefresh size={12} /></button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{ padding: "6px 10px", fontSize: 11, color: "#ef4444", background: "rgba(239,68,68,0.06)", borderBottom: "1px solid rgba(239,68,68,0.15)", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* ── Tab content ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>

        {/* ═══ CHANGES TAB ═══ */}
        {activeTab === "changes" && (
          <>
            {/* toolbar */}
            <div style={{ padding: "3px 8px", borderBottom: "1px solid var(--border)", display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
              <button onClick={toggleAllFiles} disabled={!gitState?.modifiedFiles?.length}
                style={{ fontSize: 10, padding: "2px 6px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", color: "var(--text-muted)", fontWeight: 600 }}
              >{fileCheckedCount === (gitState?.modifiedFiles.length ?? 0) ? "取消全选" : "全选"}</button>

              <button onClick={handleRollbackSelected} disabled={fileCheckedCount === 0 || loading}
                style={{ fontSize: 10, padding: "2px 6px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)", borderRadius: 4, cursor: "pointer", color: "#ef4444", fontWeight: 600 }}
              >放弃修改({fileCheckedCount})</button>

              <button onClick={handlePull} disabled={pulling || loading}
                style={{ fontSize: 10, padding: "2px 6px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", color: "var(--text-muted)", fontWeight: 600 }}
              >Pull</button>

              <div style={{ position: "relative", display: "inline-flex" }}>
                <button onClick={() => handlePush(false)} disabled={pushing || loading}
                  style={{ fontSize: 10, padding: "2px 6px", background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.22)", borderRadius: "4px 0 0 4px", cursor: "pointer", color: "var(--accent)", fontWeight: 700 }}
                >Push</button>
                <button onClick={() => setShowForcePushBtn(!showForcePushBtn)}
                  style={{ fontSize: 8, padding: "2px 3px", background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.22)", borderLeft: "none", borderRadius: "0 4px 4px 0", cursor: "pointer", color: "var(--accent)" }}
                >▼</button>
                {showForcePushBtn && (
                  <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 300, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, boxShadow: "0 4px 10px rgba(0,0,0,0.15)", padding: 4, minWidth: 80 }}>
                    <button onClick={() => { setShowForcePushBtn(false); if (confirm("确定强制覆盖远端仓库？")) handlePush(true); }}
                      style={{ width: "100%", padding: "4px 6px", fontSize: 9.5, border: "none", background: "none", color: "#ef4444", fontWeight: 600, cursor: "pointer", textAlign: "left" }}
                    >Force Push</button>
                  </div>
                )}
              </div>

              <button onClick={toggleAllFolders} disabled={allFolderPaths.length === 0}
                style={{ marginLeft: "auto", fontSize: 10, padding: "2px 6px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", color: "var(--text-muted)", fontWeight: 600 }}
              >{isAllExpanded ? "折叠" : "展开"}</button>
            </div>

            {/* file tree */}
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "2px 0", scrollbarWidth: "thin" }}>
              {loading && !gitState ? (
                <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }}>扫描工作区...</div>
              ) : gitState?.isClean ? (
                <div style={{ padding: "12px 16px", color: "var(--text-dim)", fontSize: 11 }}>没有检测到本地文件变动。</div>
              ) : (
                fileTreeRoots.map((node) => renderNode(node, 0))
              )}
            </div>

            {/* commit form */}
            {!gitState?.isClean && (
              <form onSubmit={handleCommit} style={{ padding: "4px 8px", borderTop: "1px solid var(--border)", display: "flex", gap: 4, flexShrink: 0 }}>
                <input type="text" placeholder={`提交日志 (${fileCheckedCount}个)...`} value={commitMessage} required disabled={committing || fileCheckedCount === 0}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  style={{ flex: 1, fontSize: 11, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", color: "var(--text)", outline: "none", minWidth: 0 }} />
                <button type="submit" disabled={committing || fileCheckedCount === 0 || !commitMessage.trim()}
                  style={{ fontSize: 11, fontWeight: 700, padding: "0 10px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", opacity: fileCheckedCount === 0 ? 0.5 : 1 }}
                >{committing ? "..." : "Commit"}</button>
              </form>
            )}
          </>
        )}

        {/* ═══ BRANCHES TAB ═══ */}
        {activeTab === "branches" && (
          <>
            {isCreatingBranch && (
              <form onSubmit={handleCreateBranch} style={{ display: "flex", gap: 3, padding: "4px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                <input type="text" placeholder="分支名 (如: feat/widget)..." value={newBranchInput} required onChange={(e) => setNewBranchInput(e.target.value)}
                  style={{ flex: 1, fontSize: 11, padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", color: "var(--text)", outline: "none" }} />
                <button type="submit" style={{ fontSize: 10, padding: "0 8px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 700 }}>创建</button>
              </form>
            )}

            <div style={{ display: "flex", gap: 4, padding: "3px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              <button onClick={handleFetch} disabled={fetching} style={{ flex: 1, fontSize: 9.5, padding: "3px 0", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer" }}>{fetching ? "..." : "Fetch"}</button>
              <button onClick={handlePull} disabled={pulling} style={{ flex: 1, fontSize: 9.5, padding: "3px 0", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer" }}>{pulling ? "..." : "Pull"}</button>
              <button onClick={() => setIsCreatingBranch(!isCreatingBranch)} title="新建分支"
                style={{ fontSize: 9.5, padding: "3px 8px", background: isCreatingBranch ? "var(--accent)" : "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 4, color: isCreatingBranch ? "#fff" : "var(--text-muted)", cursor: "pointer", fontWeight: isCreatingBranch ? 700 : 400 }}
              >{isCreatingBranch ? "取消" : "+ 新建"}</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "2px 0", scrollbarWidth: "thin" }}>
              {branchLoading ? (
                <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }}>加载中...</div>
              ) : (
                <>
                  <div style={{ padding: "4px 8px 2px", fontSize: 9.5, fontWeight: 700, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Local</div>
                  {localBranches.map((b) => {
                    const isCurrent = b === gitState?.branch;
                    const isFocused = selectedBranchForAction === b;
                    return (
                      <div key={b} onClick={() => setSelectedBranchForAction(isFocused ? null : b)}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "0 8px 0 12px", height: 26, cursor: "pointer", fontSize: 12,
                          background: isCurrent ? "rgba(37,99,235,0.08)" : isFocused ? "var(--bg-selected)" : "transparent",
                          borderLeft: isCurrent ? "3px solid var(--accent)" : "3px solid transparent",
                        }}
                        onMouseEnter={(e) => { if (!isCurrent && !isFocused) e.currentTarget.style.background = "var(--bg-hover)"; }}
                        onMouseLeave={(e) => { if (!isCurrent && !isFocused) e.currentTarget.style.background = "transparent"; }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                          {isCurrent ? (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <span style={{ flexShrink: 0, display: "flex", alignItems: "center", color: "var(--text-dim)" }}>
                              <IconGitBranch />
                            </span>
                          )}
                          <span style={{ fontWeight: isCurrent ? 700 : 500, color: isCurrent ? "var(--accent)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {b}
                          </span>
                          {isCurrent && (
                            <span style={{ fontSize: 9, color: "var(--accent)", marginLeft: 2, padding: "1px 5px", background: "rgba(37,99,235,0.12)", borderRadius: 3, fontWeight: 700, flexShrink: 0, lineHeight: "13px" }}>HEAD</span>
                          )}
                        </div>
                        {isFocused && (
                          <div style={{ display: "flex", gap: 2 }}>
                            {!isCurrent && <button onClick={(e) => { e.stopPropagation(); handleCheckoutBranch(b); }} style={{ padding: "2px 6px", fontSize: 9, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontWeight: 700 }}>切出</button>}
                            <button onClick={(e) => { e.stopPropagation(); handleMergeBranch(b); }} style={{ padding: "2px 6px", fontSize: 9, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 3, cursor: "pointer" }}>合并</button>
                            {!isCurrent && <button onClick={(e) => { e.stopPropagation(); handleDeleteBranch(b); }} style={{ padding: "2px 6px", fontSize: 9, background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.18)", color: "#ef4444", borderRadius: 3, cursor: "pointer" }}>删除</button>}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {remoteBranches.length > 0 && (
                    <>
                      <div onClick={() => setRemoteBranchesOpen((p) => !p)}
                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 8px 2px", fontSize: 9.5, fontWeight: 700, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", userSelect: "none" }}
                        onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-muted)"}
                        onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-dim)"}
                      >
                        <Chevi open={remoteBranchesOpen} />
                        Remote
                        <span style={{ marginLeft: 2, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>({remoteBranches.length})</span>
                      </div>
                      {remoteBranchesOpen && remoteBranches.map((b) => {
                        const isFocused = selectedBranchForAction === b;
                        return (
                          <div key={b} onClick={() => setSelectedBranchForAction(isFocused ? null : b)}
                            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 0 24px", height: 24, cursor: "pointer", fontSize: 12, background: isFocused ? "var(--bg-selected)" : "transparent" }}
                            onMouseEnter={(e) => { if (!isFocused) e.currentTarget.style.background = "var(--bg-hover)"; }}
                            onMouseLeave={(e) => { if (!isFocused) e.currentTarget.style.background = "transparent"; }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: "var(--text-dim)" }}>
                                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                              </svg>
                              <span style={{ fontWeight: 500, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b}</span>
                            </div>
                            {isFocused && (
                              <div style={{ display: "flex", gap: 2 }}>
                                <button onClick={(e) => { e.stopPropagation(); handleCheckoutBranch(b); }} style={{ padding: "2px 6px", fontSize: 9, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontWeight: 700 }}>切出</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* ═══ HISTORY TAB ═══ */}
        {activeTab === "history" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "2px 0", scrollbarWidth: "thin" }}>
              {gitState?.history.map((commit, idx) => {
                const isFocused = selectedCommitHash === commit.hash;
                return (
                  <div key={commit.hash} onClick={() => fetchCommitFiles(commit.hash)}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 8px", height: 22, cursor: "pointer", fontSize: 11.5, background: isFocused ? "var(--bg-selected)" : "transparent" }}
                    onMouseEnter={(e) => { if (!isFocused) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { if (!isFocused) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ flexShrink: 0, width: 6, height: 6, borderRadius: "50%", background: idx === 0 ? "var(--accent)" : "var(--border)" }} />
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)" }}>{commit.hash}</span>
                    <span style={{ flex: 1, color: isFocused ? "var(--text)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={commit.message}>{commit.message}</span>
                  </div>
                );
              })}
            </div>

            {selectedCommitHash && (
              <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--border)", flexShrink: 0, minHeight: 60 }}>
                {/* Drag handle for resizing */}
                <div
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const startY = e.clientY;
                    const container = (e.currentTarget as HTMLElement).parentElement!;
                    const startH = container.offsetHeight;
                    const onMove = (ev: MouseEvent) => { container.style.height = `${Math.max(60, startH - (ev.clientY - startY))}px`; };
                    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
                    window.addEventListener("mousemove", onMove);
                    window.addEventListener("mouseup", onUp);
                    document.body.style.cursor = "row-resize";
                    document.body.style.userSelect = "none";
                  }}
                  style={{ height: 5, cursor: "row-resize", background: "transparent", flexShrink: 0 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{selectedCommitHash}</span>
                  <button onClick={() => setSelectedCommitHash(null)} style={{ padding: 0, width: 16, height: 16, border: "none", background: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "2px 0", scrollbarWidth: "thin" }}>
                  {commitFilesLoading ? (
                    <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-dim)" }}>Loading...</div>
                  ) : (
                    commitDetailsFiles.map((file, idx) => {
                      const st2 = file.status.trim().toUpperCase();
                      let sc2 = "var(--text-muted)";
                      if (st2 === "M") sc2 = "#eab308"; else if (st2 === "A") sc2 = "#22c55e"; else if (st2 === "D") sc2 = "#ef4444";
                      return (
                        <div key={idx} onDoubleClick={() => triggerDiffView(file.file, selectedCommitHash)}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 8px", height: 22, cursor: "pointer", fontSize: 11.5 }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                          title={file.file + " — 双击查看 Diff"}
                        >
                          <span style={{ fontSize: 9.5, fontWeight: 700, color: sc2, width: 14, textAlign: "center", flexShrink: 0 }}>{st2}</span>
                          {getFileIcon(file.file, 13)}
                          <span style={{ flex: 1, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>{file.file}</span>
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

      {/* ── DIFF MODAL ── */}
      {selectedDiffFile && diffData && (
        <DiffModal
          filePath={selectedDiffFile}
          diffData={diffData}
          historicalDiffHash={historicalDiffHash}
          isConflict={!!gitState?.modifiedFiles.find((f) => f.file === selectedDiffFile)?.isConflict && !historicalDiffHash}
          isWorkingCopy={!historicalDiffHash}
          onClose={() => setSelectedDiffFile(null)}
          onResolveConflict={handleConflictResolve}
          onRollbackFile={handleRollbackFile}
          onRollbackHunk={handleRollbackHunk}
        />
      )}

      {/* Notification bar */}
      {actionSuccess && (
        <div style={{ padding: "5px 10px", borderTop: "1px solid var(--border)", fontSize: 10, color: "#22c55e", fontWeight: 500, display: "flex", alignItems: "center", gap: 5, flexShrink: 0, background: "rgba(34,197,94,0.06)" }}>
          <span style={{ borderRadius: "50%", width: 5, height: 5, background: "#22c55e", flexShrink: 0 }} />
          {actionSuccess}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Side-by-side Diff Modal with collapse + per-hunk rollback
   ═══════════════════════════════════════════════════════════ */

type DiffSegment =
  | { type: "equal"; oldLine: number; newLine: number; text: string }
  | { type: "del"; oldLine: number; text: string }
  | { type: "add"; newLine: number; text: string }
  | { type: "replace"; oldLine: number; newLine: number; oldText: string; newText: string };

type DiffHunk =
  | { type: "equal"; segments: DiffSegment[]; startIdx: number }
  | { type: "change"; segments: DiffSegment[]; startIdx: number };

function computeDiff(oldText: string, newText: string): DiffSegment[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const m = oldLines.length;
  const n = newLines.length;
  const max = m + n;
  const v: number[] = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];

  for (let d = 0; d <= max; d++) {
    trace.push([...v]);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max])) { x = v[k + 1 + max]; }
      else { x = v[k - 1 + max] + 1; }
      let y = x - k;
      while (x < m && y < n && oldLines[x] === newLines[y]) { x++; y++; }
      v[k + max] = x;
      if (x >= m && y >= n) {
        const edits: Array<{ type: "keep" | "del" | "add"; oldIdx?: number; newIdx?: number }> = [];
        let cx = m, cy = n;
        for (let dd = d; dd > 0; dd--) {
          const pv = trace[dd - 1];
          const pk = cx - cy;
          let prevK: number;
          if (pk === -dd || (pk !== dd && pv[pk - 1 + max] < pv[pk + 1 + max])) { prevK = pk + 1; }
          else { prevK = pk - 1; }
          const prevX = pv[prevK + max];
          const prevY = prevX - prevK;
          while (cx > prevX && cy > prevY) { cx--; cy--; edits.unshift({ type: "keep", oldIdx: cx, newIdx: cy }); }
          if (dd > 0) {
            if (cx > prevX) { cx--; edits.unshift({ type: "del", oldIdx: cx }); }
            else { cy--; edits.unshift({ type: "add", newIdx: cy }); }
          }
        }
        while (cx > 0 && cy > 0) { cx--; cy--; edits.unshift({ type: "keep", oldIdx: cx, newIdx: cy }); }
        // Handle remaining deletions when cy === 0
        while (cx > 0) { cx--; edits.unshift({ type: "del", oldIdx: cx }); }

        const segments: DiffSegment[] = [];
        let i = 0;
        while (i < edits.length) {
          const e = edits[i];
          if (e.type === "keep") { segments.push({ type: "equal", oldLine: e.oldIdx! + 1, newLine: e.newIdx! + 1, text: oldLines[e.oldIdx!] }); i++; }
          else if (e.type === "del" && i + 1 < edits.length && edits[i + 1].type === "add" && edits[i + 1].newIdx! >= 0) { segments.push({ type: "replace", oldLine: e.oldIdx! + 1, newLine: edits[i + 1].newIdx! + 1, oldText: oldLines[e.oldIdx!], newText: newLines[edits[i + 1].newIdx!] }); i += 2; }
          else if (e.type === "del") { segments.push({ type: "del", oldLine: e.oldIdx! + 1, text: oldLines[e.oldIdx!] }); i++; }
          else if (e.type === "add" && e.newIdx! >= 0) { segments.push({ type: "add", newLine: e.newIdx! + 1, text: newLines[e.newIdx!] }); i++; }
          else { i++; } // Skip invalid add operations with negative newIdx
        }
        return segments;
      }
    }
  }
  return [
    ...oldLines.map((t, i) => ({ type: "del" as const, oldLine: i + 1, text: t })),
    ...newLines.map((t, i) => ({ type: "add" as const, newLine: i + 1, text: t })),
  ];
}

function groupIntoHunks(segments: DiffSegment[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let i = 0;
  while (i < segments.length) {
    const isChange = segments[i].type !== "equal";
    const start = i;
    const group: DiffSegment[] = [];
    while (i < segments.length && (segments[i].type !== "equal") === isChange) { group.push(segments[i]); i++; }
    hunks.push({ type: isChange ? "change" : "equal", segments: group, startIdx: start });
  }
  return hunks;
}

const CTX = 3; // context lines shown around collapsed equal hunks

function DiffModal({
  filePath, diffData, historicalDiffHash, isConflict, isWorkingCopy,
  onClose, onResolveConflict, onRollbackFile, onRollbackHunk,
}: {
  filePath: string;
  diffData: { oldContent: string; newContent: string };
  historicalDiffHash: string | null;
  isConflict: boolean;
  isWorkingCopy: boolean;
  onClose: () => void;
  onResolveConflict: (filePath: string, mode: "mine" | "theirs") => void;
  onRollbackFile: (filePath: string) => void;
  onRollbackHunk: (filePath: string, oldText: string, newText: string) => void;
}) {
  const segments = useMemo(() => computeDiff(diffData.oldContent, diffData.newContent), [diffData.oldContent, diffData.newContent]);
  const hunks = useMemo(() => groupIntoHunks(segments), [segments]);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const [collapsedEqual, setCollapsedEqual] = useState<Set<number>>(new Set());
  const [rollingBackHunk, setRollingBackHunk] = useState<number | null>(null);

  useEffect(() => {
    const eq = new Set<number>();
    hunks.forEach((h, i) => { if (h.type === "equal") eq.add(i); });
    setCollapsedEqual(eq);
  }, [hunks]);

  const handleScroll = useCallback((src: "left" | "right") => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const s = src === "left" ? leftRef.current : rightRef.current;
    const d = src === "left" ? rightRef.current : leftRef.current;
    if (s && d) d.scrollTop = s.scrollTop;
    requestAnimationFrame(() => { syncingRef.current = false; });
  }, []);

  const toggleHunk = (hi: number) => {
    setCollapsedEqual((prev) => { const next = new Set(prev); if (next.has(hi)) next.delete(hi); else next.add(hi); return next; });
  };

  const toggleAllCollapsed = () => {
    if (collapsedEqual.size > 0) { setCollapsedEqual(new Set()); }
    else { const eq = new Set<number>(); hunks.forEach((h, i) => { if (h.type === "equal") eq.add(i); }); setCollapsedEqual(eq); }
  };

  /** Extract the old/new text for a changed hunk */
  const getHunkTexts = (hunk: DiffHunk): { oldText: string; newText: string } | null => {
    if (hunk.type === "equal") return null;
    const oldLines: string[] = [];
    const newLines: string[] = [];
    for (const seg of hunk.segments) {
      if (seg.type === "del") { oldLines.push(seg.text); }
      else if (seg.type === "add") { newLines.push(seg.text); }
      else if (seg.type === "replace") { oldLines.push(seg.oldText); newLines.push(seg.newText); }
    }
    return { oldText: oldLines.join("\n"), newText: newLines.join("\n") };
  };

  const lineH = 20;
  const hasChanges = segments.some((s) => s.type !== "equal");
  const scrollStyle: React.CSSProperties = { colorScheme: "dark", scrollbarWidth: "thin", scrollbarColor: "var(--border) transparent" };

  const renderSegRow = (seg: DiffSegment, side: "left" | "right", idx: number) => {
    if (seg.type === "equal") {
      const ln = side === "left" ? seg.oldLine : seg.newLine;
      return (
        <div key={`${side}-${idx}`} style={{ display: "flex", height: lineH }}>
          <span style={{ width: 48, textAlign: "right", paddingRight: 8, color: "var(--text-dim)", fontSize: 10, userSelect: "none", flexShrink: 0 }}>{ln}</span>
          <span style={{ flex: 1, color: "var(--text-muted)", whiteSpace: "pre", overflow: "hidden", paddingLeft: 4 }}>{seg.text || "\u00a0"}</span>
        </div>
      );
    }
    if (seg.type === "del") {
      if (side === "left") {
        return (
          <div key={`${side}-${idx}`} style={{ display: "flex", height: lineH, background: "rgba(239,68,68,0.1)", borderLeft: "3px solid #ef4444" }}>
            <span style={{ width: 48, textAlign: "right", paddingRight: 8, color: "var(--text-dim)", fontSize: 10, userSelect: "none", flexShrink: 0 }}>{seg.oldLine}</span>
            <span style={{ flex: 1, color: "#f87171", whiteSpace: "pre", overflow: "hidden", paddingLeft: 4 }}>{seg.text || "\u00a0"}</span>
          </div>
        );
      }
      // Right side: show empty placeholder with same height
      return <div key={`${side}-${idx}`} style={{ display: "flex", height: lineH, background: "rgba(234,234,234,0.03)" }}><span style={{ width: 48, flexShrink: 0 }} /><span style={{ flex: 1 }} /></div>;
    }
    if (seg.type === "add") {
      if (side === "right") {
        return (
          <div key={`${side}-${idx}`} style={{ display: "flex", height: lineH, background: "rgba(34,197,94,0.1)", borderLeft: "3px solid #22c55e" }}>
            <span style={{ width: 48, textAlign: "right", paddingRight: 8, color: "var(--text-dim)", fontSize: 10, userSelect: "none", flexShrink: 0 }}>{seg.newLine}</span>
            <span style={{ flex: 1, color: "#4ade80", whiteSpace: "pre", overflow: "hidden", paddingLeft: 4 }}>{seg.text || "\u00a0"}</span>
          </div>
        );
      }
      return <div key={`${side}-${idx}`} style={{ display: "flex", height: lineH, background: "rgba(234,234,234,0.03)" }}><span style={{ width: 48, flexShrink: 0 }} /><span style={{ flex: 1 }} /></div>;
    }
    // replace
    const isLeft = side === "left";
    return (
      <div key={`${side}-${idx}`} style={{ display: "flex", height: lineH, background: "rgba(234,179,8,0.08)", borderLeft: "3px solid #eab308" }}>
        <span style={{ width: 48, textAlign: "right", paddingRight: 8, color: "var(--text-dim)", fontSize: 10, userSelect: "none", flexShrink: 0 }}>{isLeft ? seg.oldLine : seg.newLine}</span>
        <span style={{ flex: 1, color: isLeft ? "#f87171" : "#4ade80", whiteSpace: "pre", overflow: "hidden", paddingLeft: 4 }}>{(isLeft ? seg.oldText : seg.newText) || "\u00a0"}</span>
      </div>
    );
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2.5px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "min(1600px, 96vw)", height: "85vh", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, display: "flex", flexDirection: "column", boxShadow: "0 12px 30px rgba(0,0,0,0.25)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--bg-panel)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{historicalDiffHash ? "Commit Diff" : "Working Copy Diff"}</span>
            {historicalDiffHash && <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--accent)", background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)", padding: "1px 5px", borderRadius: 4 }}>{historicalDiffHash}</span>}
          </div>
          <span style={{ flex: 1, textAlign: "center", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text)" }}>{filePath}</span>
          <div style={{ display: "flex", gap: 6 }}>
            {isWorkingCopy && hasChanges && <button onClick={() => onRollbackFile(filePath)} style={{ padding: "4px 10px", fontSize: 11, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>回滚此文件</button>}
            {hasChanges && <button onClick={toggleAllCollapsed} style={{ padding: "4px 10px", fontSize: 11, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 4, cursor: "pointer" }}>{collapsedEqual.size > 0 ? "展开全部" : "折叠未改动"}</button>}
            {isConflict && <><button onClick={() => onResolveConflict(filePath, "mine")} style={{ padding: "4px 10px", fontSize: 11, background: "#22c55e", fontWeight: "bold", border: "none", color: "#fff", borderRadius: 4, cursor: "pointer" }}>Keep Ours</button><button onClick={() => onResolveConflict(filePath, "theirs")} style={{ padding: "4px 10px", fontSize: 11, background: "var(--accent)", fontWeight: "bold", border: "none", color: "#fff", borderRadius: 4, cursor: "pointer" }}>Keep Theirs</button></>}
            <button onClick={onClose} style={{ background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 4, width: 24, height: 24, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "var(--text-muted)" }}>×</button>
          </div>
        </div>
        {/* Column headers */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--bg-panel)" }}>
          <div style={{ flex: 1, padding: "4px 12px", fontSize: 11, fontWeight: 600, color: "var(--text-dim)", borderRight: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", opacity: 0.6 }} />{historicalDiffHash ? "Parent" : "HEAD (原版)"}</div>
          <div style={{ flex: 1, padding: "4px 12px", fontSize: 11, fontWeight: 600, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", opacity: 0.6 }} />{historicalDiffHash ? "Commit" : "Working Copy (当前)"}</div>
        </div>
        {/* Split panels */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div ref={leftRef} onScroll={() => handleScroll("left")} style={{ flex: 1, overflow: "auto", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: `${lineH}px`, borderRight: "1px solid var(--border)", ...scrollStyle }}>
            {hunks.map((hunk, hi) => {
              const isChange = hunk.type !== "equal";
              const isCollapsed = hunk.type === "equal" && collapsedEqual.has(hi);
              const hunkTexts = isChange ? getHunkTexts(hunk) : null;
              return (
                <React.Fragment key={hi}>
                  {isCollapsed ? (
                    (() => { const total = hunk.segments.length; if (total <= CTX * 2 + 1) return hunk.segments.map((seg, si) => renderSegRow(seg, "left", si));
                      return <>
                        {hunk.segments.slice(0, CTX).map((seg, si) => renderSegRow(seg, "left", si))}
                        <div onClick={() => toggleHunk(hi)} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: lineH, background: "var(--bg-panel)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", cursor: "pointer", color: "var(--text-dim)", fontSize: 10, userSelect: "none", gap: 4 }} onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-muted)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-dim)"}><Chevi open={false} />{total - CTX * 2} unchanged lines</div>
                        {hunk.segments.slice(-CTX).map((seg, si) => renderSegRow(seg, "left", si))}
                      </>;
                    })()
                  ) : (
                    hunk.segments.map((seg, si) => renderSegRow(seg, "left", si))
                  )}
                  {isChange && isWorkingCopy && hunkTexts && hunkTexts.newText && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 24, background: "rgba(239,68,68,0.04)", borderTop: "1px dashed rgba(239,68,68,0.2)", borderBottom: "1px dashed rgba(239,68,68,0.2)" }}>
                      <button
                        disabled={rollingBackHunk === hi}
                        onClick={async () => { setRollingBackHunk(hi); await onRollbackHunk(filePath, hunkTexts.oldText, hunkTexts.newText); setRollingBackHunk(null); }}
                        style={{ fontSize: 10, padding: "2px 8px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 3, cursor: "pointer", color: "#ef4444", fontWeight: 600 }}
                      >{rollingBackHunk === hi ? "回滚中..." : "回滚此段"}</button>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
          <div ref={rightRef} onScroll={() => handleScroll("right")} style={{ flex: 1, overflow: "auto", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: `${lineH}px`, ...scrollStyle }}>
            {hunks.map((hunk, hi) => {
              const isCollapsed = hunk.type === "equal" && collapsedEqual.has(hi);
              const isChange = hunk.type !== "equal";
              const hunkTexts = isChange ? getHunkTexts(hunk) : null;
              // Show spacer to match left side rollback bar - must match same condition as left side
              const showSpacer = isChange && isWorkingCopy && hunkTexts && hunkTexts.newText;
              return (
                <React.Fragment key={hi}>
                  {isCollapsed ? (
                    (() => { const total = hunk.segments.length; if (total <= CTX * 2 + 1) return hunk.segments.map((seg, si) => renderSegRow(seg, "right", si));
                      return <>
                        {hunk.segments.slice(0, CTX).map((seg, si) => renderSegRow(seg, "right", si))}
                        <div onClick={() => toggleHunk(hi)} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: lineH, background: "var(--bg-panel)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", cursor: "pointer", color: "var(--text-dim)", fontSize: 10, userSelect: "none", gap: 4 }} onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-muted)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-dim)"}><Chevi open={false} />{total - CTX * 2} unchanged lines</div>
                        {hunk.segments.slice(-CTX).map((seg, si) => renderSegRow(seg, "right", si))}
                      </>;
                    })()
                  ) : (
                    hunk.segments.map((seg, si) => renderSegRow(seg, "right", si))
                  )}
                  {showSpacer && (
                    <div style={{ height: 24 }} /> /* spacer to match left side rollback bar */
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
