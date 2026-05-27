"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { getFileIcon, FolderIcon } from "./FileIcons";

interface Props { cwd: string; }

interface GitFileInfo { status: string; file: string; isConflict?: boolean; }
interface GitHistoryCommit { hash: string; message: string; }
interface GitState {
  branch: string; ahead: number; behind: number;
  modifiedFiles: GitFileInfo[]; history: GitHistoryCommit[];
  isMerging: boolean; isClean: boolean;
}

interface FileTreeNode {
  name: string; fullPath: string; isFolder: boolean;
  children: Record<string, FileTreeNode>; fileEntry?: GitFileInfo;
}

function buildFileTree(files: GitFileInfo[]): FileTreeNode {
  const root: FileTreeNode = { name: "root", fullPath: "", isFolder: true, children: {} };
  for (const f of files) {
    const parts = f.file.split(/[/\\]/);
    let cur = root;
    let accum = "";
    for (let i = 0; i < parts.length; i++) {
      accum = accum ? `${accum}/${parts[i]}` : parts[i];
      const isLast = i === parts.length - 1;
      if (!cur.children[parts[i]]) {
        cur.children[parts[i]] = { name: parts[i], fullPath: accum, isFolder: !isLast, children: {}, ...(isLast ? { fileEntry: f } : {}) };
      }
      cur = cur.children[parts[i]];
    }
  }
  return root;
}

/* ─── SVG icon helpers (same style as Explorer uses) ─── */

// Chevron triangle — the ONE canonical chevron used across EXPLORER
function Chevi({ open }: { open: boolean }) {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}>
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

export function GitPanel({ cwd }: Props) {
  const [gitState, setGitState] = useState<GitState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [secOpen, setSecOpen] = useState({ changes: true, branches: true, history: true });
  const [checkedFiles, setCheckedFiles] = useState<Record<string, boolean>>({});
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommiting] = useState(false);

  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<{ oldContent: string; newContent: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [historicalDiffHash, setHistoricalDiffHash] = useState<string | null>(null);

  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [selectedBranchForAction, setSelectedBranchForAction] = useState<string | null>(null);
  const [newBranchInput, setNewBranchInput] = useState("");
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);

  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [showForcePushBtn, setShowForcePushBtn] = useState(false);

  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [commitDetailsFiles, setCommitDetailsFiles] = useState<{ status: string; file: string }[]>([]);
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);

  const showNotification = useCallback((msg: string) => { setActionSuccess(msg); setTimeout(() => setActionSuccess(null), 3000); }, []);

  const fetchGitStatus = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    try {
      const res = await fetch("/api/git-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, action: "status" }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取 Git 状态失败");
      if (data.error) { setError(data.error); setGitState(null); }
      else {
        setError(null); setGitState(data);
        setCheckedFiles((prev) => { const next = { ...prev }; for (const f of data.modifiedFiles as GitFileInfo[]) { if (next[f.file] === undefined) next[f.file] = true; } return next; });
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

  const fileTreeRoot = useMemo(() => buildFileTree(gitState?.modifiedFiles ?? []), [gitState?.modifiedFiles]);

  // Auto-expand all parent folders when files load
  useEffect(() => {
    if (!gitState?.modifiedFiles) return;
    setExpandedFolders((prev) => {
      const next = { ...prev };
      for (const f of gitState.modifiedFiles) {
        const parts = f.file.split(/[/\\]/);
        let acc = "";
        for (let i = 0; i < parts.length - 1; i++) { acc = acc ? `${acc}/${parts[i]}` : parts[i]; if (next[acc] === undefined) next[acc] = true; }
      }
      return next;
    });
  }, [gitState?.modifiedFiles]);

  /* ─── Branch / Push / Pull helpers ─── */

  const api = useCallback(async (action: string, body: Record<string, unknown>) => {
    const res = await fetch("/api/git-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, action, ...body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${action} failed`);
    return data;
  }, [cwd]);

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

  const fetchCommitFiles = useCallback(async (commitHash: string) => {
    setSelectedCommitHash(commitHash); setCommitDetailsFiles([]); setCommitFilesLoading(true);
    try { const data = await api("commit-files", { branchName: commitHash }); setCommitDetailsFiles(data.files || []); }
    catch { /* quiet */ }
    finally { setCommitFilesLoading(false); }
  }, [api]);

  /* ─── Tree renderer: folders + leaf files, Explorer-identical row style ─── */

  const renderTreeNodes = (node: FileTreeNode, depth = 0): React.ReactNode => {
    return Object.values(node.children).map((child) => {
      const isFolder = child.isFolder;
      const path = child.fullPath;
      const isExpanded = !!expandedFolders[path];
      const rowH = 22;
      const indent = depth * 16;

      if (isFolder) {
        // Count leaf files (recursively) for folder badge
        const countFiles = (n: FileTreeNode): number => {
          let c = 0;
          for (const ch of Object.values(n.children)) {
            if (ch.isFolder) c += countFiles(ch); else c += 1;
          }
          return c;
        };
        const fileCount = countFiles(child);
        return (
          <div key={path}>
            <div
              onClick={() => setExpandedFolders((p) => ({ ...p, [path]: !p[path] }))}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                paddingLeft: 8 + indent, paddingRight: 8,
                height: rowH, cursor: "pointer", userSelect: "none",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              <Chevi open={isExpanded} />
              <FolderIcon size={14} open={isExpanded} />
              <span style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{child.name}</span>
              <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                {fileCount}
              </span>
            </div>
            {isExpanded && renderTreeNodes(child, depth + 1)}
          </div>
        );
      }

      const file = child.fileEntry!;
      const isChecked = !!checkedFiles[file.file];
      const st = file.status.trim().toUpperCase();
      let statusColor = "var(--text-dim)";
      let statusLabel = st;
      if (st === "M") statusColor = "#eab308";
      else if (st === "A" || st === "??") { statusColor = "#22c55e"; statusLabel = "U"; }
      else if (st === "D") statusColor = "#ef4444";
      if (file.isConflict) { statusColor = "#f97316"; statusLabel = "!"; }

      const isSel = selectedDiffFile === file.file && !historicalDiffHash;

      return (
        <div
          key={path}
          onDoubleClick={() => triggerDiffView(file.file)}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            paddingLeft: 8 + indent + 13, paddingRight: 8,
            height: rowH, cursor: "pointer",
            background: isSel ? "var(--bg-selected)" : "transparent",
          }}
          onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
          title={file.file + "  \u2014  \u53cc\u51fb\u67e5\u770b Diff"}
        >
          <input type="checkbox" checked={isChecked} onClick={(e) => e.stopPropagation()}
            onChange={(e) => setCheckedFiles((p) => ({ ...p, [file.file]: e.target.checked }))}
            style={{ margin: 0, width: 12, height: 12, cursor: "pointer", accentColor: "var(--accent)" }} />
          {getFileIcon(child.name, 14)}
          <span style={{ fontSize: 12, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>{child.name}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, minWidth: 14, textAlign: "center", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{statusLabel}</span>
        </div>
      );
    });
  };

  const filesCheckedCount = Object.keys(checkedFiles).filter((f) => checkedFiles[f]).length;
  const toggleSection = (key: keyof typeof secOpen) => setSecOpen((p) => ({ ...p, [key]: !p[key] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", overflow: "hidden", background: "var(--bg)" }}>

      {/* ── SECTION 1: CHANGES ── */}
      <div style={{ display: "flex", flexDirection: "column", flex: "2 1 0", minHeight: 0, overflow: "hidden" }}>
        {/* header */}
        <button onClick={() => toggleSection("changes")} style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          padding: "6px 10px", background: "none", border: "none",
          color: "var(--text-muted)", cursor: "pointer",
          fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", textAlign: "left",
        }}>
          <Chevi open={secOpen.changes} />
          <span style={{ flex: 1 }}>
            CHANGES
            <span style={{ color: "var(--text-dim)", textTransform: "none", fontWeight: 500, marginLeft: 4 }}>({gitState?.modifiedFiles.length ?? 0})</span>
          </span>
          {gitState?.branch && (
            <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 4, textTransform: "none", fontFamily: "var(--font-mono)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 3, color: "var(--text-muted)" }}>
              <IconGitBranch />
              {gitState.branch}
              {gitState.ahead > 0 && <span style={{ color: "var(--accent)" }}>+{gitState.ahead}</span>}
              {gitState.behind > 0 && <span style={{ color: "#ef4444" }}>-{gitState.behind}</span>}
            </span>
          )}
        </button>

        {secOpen.changes && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            {/* toolbar */}
            <div style={{ padding: "3px 8px", borderBottom: "1px solid var(--border)", display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
              <button
                onClick={() => { const sel = Object.keys(checkedFiles).some((f) => !checkedFiles[f]); const next: Record<string, boolean> = {}; gitState?.modifiedFiles.forEach((file) => { next[file.file] = sel; }); setCheckedFiles(next); }}
                disabled={!gitState?.modifiedFiles?.length}
                style={{ fontSize: 10, padding: "2px 6px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", color: "var(--text-muted)", fontWeight: 600 }}
              >{filesCheckedCount === (gitState?.modifiedFiles.length ?? 0) ? "取消全选" : "全选"}</button>

              <button onClick={handleRollbackSelected} disabled={filesCheckedCount === 0 || loading}
                style={{ fontSize: 10, padding: "2px 6px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)", borderRadius: 4, cursor: "pointer", color: "#ef4444", fontWeight: 600 }}
              >放弃修改({filesCheckedCount})</button>

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

              <button onClick={fetchGitStatus} title="重新扫描状态"
                style={{ marginLeft: "auto", display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", borderRadius: 4, width: 20, height: 20 }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
              ><IconRefresh size={12} /></button>
            </div>

            {/* file tree */}
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "2px 0", scrollbarWidth: "thin" }}>
              {loading && !gitState ? (
                <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }}>扫描工作区...</div>
              ) : gitState?.isClean ? (
                <div style={{ padding: "12px 16px", color: "var(--text-dim)", fontSize: 11 }}>没有检测到本地文件变动。</div>
              ) : (
                renderTreeNodes(fileTreeRoot)
              )}
            </div>

            {/* commit form */}
            {!gitState?.isClean && (
              <form onSubmit={handleCommit} style={{ padding: "4px 8px", borderTop: "1px solid var(--border)", display: "flex", gap: 4, flexShrink: 0 }}>
                <input type="text" placeholder={`提交日志 (${filesCheckedCount}个)...`} value={commitMessage} required disabled={committing || filesCheckedCount === 0}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  style={{ flex: 1, fontSize: 11, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", color: "var(--text)", outline: "none", minWidth: 0 }} />
                <button type="submit" disabled={committing || filesCheckedCount === 0 || !commitMessage.trim()}
                  style={{ fontSize: 11, fontWeight: 700, padding: "0 10px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", opacity: filesCheckedCount === 0 ? 0.5 : 1 }}
                >{committing ? "..." : "Commit"}</button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* ── SECTION 2: BRANCHES ── */}
      <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--border)", flex: secOpen.branches ? "1 1 0" : "0 0 auto", minHeight: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          <button onClick={() => toggleSection("branches")} style={{
            display: "flex", alignItems: "center", gap: 6, flex: 1,
            padding: "6px 10px", background: "none", border: "none",
            color: "var(--text-muted)", cursor: "pointer",
            fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", textAlign: "left",
          }}>
            <Chevi open={secOpen.branches} />
            <span style={{ flex: 1 }}>
              BRANCHES
              <span style={{ color: "var(--text-dim)", textTransform: "none", fontWeight: 500, marginLeft: 4 }}>({localBranches.length})</span>
            </span>
          </button>
          <button onClick={() => setIsCreatingBranch(!isCreatingBranch)}
            title="新建分支"
            style={{ fontSize: 14, lineHeight: 1, background: "none", border: "none", color: "var(--accent)", fontWeight: 700, cursor: "pointer", width: 22, height: 22, marginRight: 6, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center" }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "none"}
          >+</button>
        </div>

        {secOpen.branches && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
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
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "2px 0", scrollbarWidth: "thin" }}>
              {branchLoading ? (
                <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }}>加载中...</div>
              ) : (
                localBranches.map((b) => {
                  const isCurrent = b === gitState?.branch;
                  const isFocused = selectedBranchForAction === b;
                  return (
                    <div key={b} onClick={() => setSelectedBranchForAction(b)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "0 8px", height: 22, cursor: "pointer", fontSize: 12,
                        background: isCurrent ? "rgba(37,99,235,0.06)" : isFocused ? "var(--bg-selected)" : "transparent",
                      }}
                      onMouseEnter={(e) => { if (!isCurrent && !isFocused) e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { if (!isCurrent && !isFocused) e.currentTarget.style.background = "transparent"; }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                        <span style={{ flexShrink: 0, display: "flex", alignItems: "center", color: isCurrent ? "var(--accent)" : "var(--text-dim)" }}>
                          <IconGitBranch />
                        </span>
                        <span style={{ fontWeight: isCurrent ? 700 : 500, color: isCurrent ? "var(--text)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {b}{isCurrent && <span style={{ fontSize: 10, color: "var(--accent)", marginLeft: 3 }}>(current)</span>}
                        </span>
                      </div>
                      {isFocused && !isCurrent && (
                        <div style={{ display: "flex", gap: 2 }}>
                          <button onClick={(e) => { e.stopPropagation(); handleCheckoutBranch(b); }} style={{ padding: "1px 4px", fontSize: 9, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontWeight: 700 }}>切出</button>
                          <button onClick={(e) => { e.stopPropagation(); handleMergeBranch(b); }} style={{ padding: "1px 4px", fontSize: 9, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 3, cursor: "pointer" }}>合并</button>
                          <button onClick={(e) => { e.stopPropagation(); handleDeleteBranch(b); }} style={{ padding: "1px 4px", fontSize: 9, background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.18)", color: "#ef4444", borderRadius: 3, cursor: "pointer" }}>删除</button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── SECTION 3: HISTORY ── */}
      <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--border)", flex: secOpen.history ? "2 1 0" : "0 0 auto", minHeight: 0, overflow: "hidden" }}>
        <button onClick={() => toggleSection("history")} style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          padding: "6px 10px", background: "none", border: "none",
          color: "var(--text-muted)", cursor: "pointer",
          fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", textAlign: "left", flexShrink: 0,
        }}>
          <Chevi open={secOpen.history} />
          HISTORY
        </button>

        {secOpen.history && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "2px 0", scrollbarWidth: "thin" }}>
              {gitState?.history.map((commit, idx) => {
                const isFocused = selectedCommitHash === commit.hash;
                return (
                  <div key={commit.hash} onClick={() => fetchCommitFiles(commit.hash)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "0 8px", height: 22, cursor: "pointer", fontSize: 11.5,
                      background: isFocused ? "var(--bg-selected)" : "transparent",
                    }}
                    onMouseEnter={(e) => { if (!isFocused) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { if (!isFocused) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ flexShrink: 0, width: 6, height: 6, borderRadius: "50%", background: idx === 0 ? "var(--accent)" : "var(--border)" }} />
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)" }}>{commit.hash}</span>
                    <span style={{ flex: 1, color: isFocused ? "var(--text)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={commit.message}>
                      {commit.message}
                    </span>
                  </div>
                );
              })}
            </div>

            {selectedCommitHash && (
              <div style={{ height: 160, display: "flex", flexDirection: "column", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
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
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2.5px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedDiffFile(null); }}>
          <div style={{ width: "min(1300px, 94vw)", height: "82vh", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, display: "flex", flexDirection: "column", boxShadow: "0 12px 30px rgba(0,0,0,0.25)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
                  {historicalDiffHash ? "Commit " : "Working Copy"}
                </span>
                {historicalDiffHash && (
                  <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--accent)", background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)", padding: "1px 5px", borderRadius: 4 }}>{historicalDiffHash}</span>
                )}
              </div>
              <span style={{ flex: 1, textAlign: "center", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text)" }}>{selectedDiffFile}</span>
              <div style={{ display: "flex", gap: 6 }}>
                {gitState?.modifiedFiles.find((f) => f.file === selectedDiffFile)?.isConflict && !historicalDiffHash && (
                  <>
                    <button onClick={() => handleConflictResolve(selectedDiffFile, "mine")} style={{ padding: "4px 10px", fontSize: 11, background: "#22c55e", fontWeight: "bold", border: "none", color: "#fff", borderRadius: 4, cursor: "pointer" }}>Keep Ours</button>
                    <button onClick={() => handleConflictResolve(selectedDiffFile, "theirs")} style={{ padding: "4px 10px", fontSize: 11, background: "var(--accent)", fontWeight: "bold", border: "none", color: "#fff", borderRadius: 4, cursor: "pointer" }}>Keep Theirs</button>
                  </>
                )}
                <button onClick={() => setSelectedDiffFile(null)} style={{ background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 4, width: 24, height: 24, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "var(--text-muted)" }}>×</button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 12, fontFamily: "var(--font-mono)", fontSize: 11.5, scrollbarWidth: "thin" }}>
              {completedDiffLinesCompiler(diffData.oldContent, diffData.newContent).map((line, idx) => {
                let bg = "transparent", sign = " ", color = "var(--text-muted)";
                if (line.type === "add") { bg = "rgba(34,197,94,0.06)"; sign = "+"; color = "#22c55e"; }
                else if (line.type === "del") { bg = "rgba(239,68,68,0.06)"; sign = "-"; color = "#ef4444"; }
                return (
                  <div key={idx} style={{ display: "flex", background: bg, minHeight: 18 }}>
                    <span style={{ width: 36, color: "var(--text-dim)", userSelect: "none", borderRight: "1px solid var(--border)", paddingRight: 6, textAlign: "right", flexShrink: 0 }}>{line.num}</span>
                    <span style={{ color, paddingLeft: 10, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{sign} {line.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
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

function completedDiffLinesCompiler(oldText: string, newText: string) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const out: { type: "add" | "del" | "same"; text: string; num?: number }[] = [];
  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) { out.push({ type: "same", text: oldLines[i], num: j + 1 }); i++; j++; }
    else if (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) { out.push({ type: "del", text: oldLines[i], num: i + 1 }); i++; }
    else if (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) { out.push({ type: "add", text: newLines[j], num: j + 1 }); j++; }
  }
  return out;
}
