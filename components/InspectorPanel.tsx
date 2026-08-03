"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useAgentRuntime } from "@/lib/agent-runtime-store";
import { usePersistentState } from "@/hooks/usePersistentState";
import { sendAgentCommand } from "@/lib/agent-client";
import { MiniToggle } from "@/components/ui/MiniToggle";

// ---- Types ----

type FileWhere = "unstaged" | "staged" | "untracked";

interface GitFile {
  path: string;
  status: string;
  where: FileWhere;
  added: number;
  deleted: number;
}

interface GitDiffData {
  isGit: boolean;
  branch: string | null;
  added: number;
  deleted: number;
  modified: number;
  staged: number;
  untracked: number;
  files: GitFile[];
}

// ---- Component ----

/**
 * Inspector panel（专注 Git）— git 变更统计 + 文件级 diff + 分支 + 注入提交。
 *
 * 方案C（docs/TODO-INSPECTOR-CLEANUP.md）：inspector 升格为唯一 Git 面板。
 * 任务展示交 TodoPanel，git-status 扩展降级为入口（action+label）。
 * 本面板读 /api/git-diff（聚合统计 + 文件级列表），可点开分组看文件列表，
 * 三点菜单支持「让 agent 提交」（注入 prompt，非直接 git）+ git 轮询开关。
 *
 * 已删除（方案C P0）：
 *   - 任务区（ProgressRing / InspectorTaskRow / 进度环）→ 迁 TodoPanel（P1）
 *   - 死按钮（branch 选择器无 onClick / commit-push 无 onClick）→ branch 改纯展示
 *   - pin / open / onToggle / 收起态 pill 残留（容器 WorkspacePanelsHost 接管显隐）
 *   - TodoTask / reloadTodos（todo 数据层交 useTodoTasks）
 */
export const InspectorPanel = memo(function InspectorPanel({
  cwd,
  sessionId,
}: {
  cwd: string | null;
  sessionId: string | null;
}) {
  const { t } = useI18n();
  const runtime = useAgentRuntime();
  const [gitData, setGitData] = useState<GitDiffData | null>(null);
  // Timestamp of the last successful git fetch — drives the "Xs ago" indicator.
  const [lastGitFetchAt, setLastGitFetchAt] = useState<number | null>(null);
  // Current timestamp, refreshed every 5s, re-renders the relative-time label.
  // Stored in state (not Date.now() inline in JSX) to satisfy react-hooks/purity.
  const [now, setNow] = useState(() => Date.now());
  const [gitLoading, setGitLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // L2 功能开关：git 轮询（默认开）。关闭后停止定时 fetch，"Xs ago" 也不再更新；
  // 手动 reload 与 agent 结束触发仍可工作。
  const [gitPolling, setGitPolling] = usePersistentState<boolean>("pi-inspector-git-polling", true);

  // 三段分组（unstaged/staged/untracked）展开状态。默认全部展开，便于一眼看完。
  const [expanded, setExpanded] = useState<Record<FileWhere, boolean>>({
    unstaged: true,
    staged: true,
    untracked: true,
  });

  // 「让 agent 提交」按钮反馈：注入 prompt 后短暂禁用避免重复点。
  const [committing, setCommitting] = useState(false);

  // ---- Git data fetching ----
  const reloadGit = useCallback(async () => {
    if (!cwd) {
      setGitLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/git-diff?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) {
        setGitLoading(false);
        return;
      }
      const data = (await res.json()) as GitDiffData;
      setGitData(data);
      setLastGitFetchAt(Date.now());
    } catch {
      /* best-effort */
    }
    setGitLoading(false);
  }, [cwd]);

  // Initial load + git polling (10s)，可通过 L2 开关关闭。
  useEffect(() => {
    void reloadGit();
    if (!gitPolling) return;
    const interval = setInterval(() => void reloadGit(), 10_000);
    return () => clearInterval(interval);
  }, [reloadGit, gitPolling]);

  // Tick every 5s so the "Xs ago" label advances visually between real git refreshes
  // — only when polling is on, to avoid giving a false sense of freshness.
  useEffect(() => {
    if (!gitPolling) return;
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, [gitPolling]);

  // Re-fetch when agent finishes a run (files may have changed). Still triggered even
  // when polling is off so the panel doesn't go stale after each agent turn.
  useEffect(() => {
    if (!runtime.agentRunning) void reloadGit();
  }, [runtime.agentRunning, reloadGit]);

  // ---- Close the 3-dot menu on outside click ----
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // ---- Group files by where ----
  const grouped = useMemo(() => {
    const out: Record<FileWhere, GitFile[]> = { unstaged: [], staged: [], untracked: [] };
    if (gitData?.isGit) {
      for (const f of gitData.files) out[f.where].push(f);
      // Sort each group by path for stable rendering
      for (const k of Object.keys(out) as FileWhere[]) {
        out[k].sort((a, b) => a.path.localeCompare(b.path));
      }
    }
    return out;
  }, [gitData]);

  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  // Type-narrowed alias: if git is non-null, gitData is a valid GitDiffData.
  const git = gitData?.isGit === true ? gitData : null;
  const agentRunning = runtime.agentRunning;
  const canCommit = !!sessionId && !agentRunning && !committing && !!git;

  // ---- 「让 agent 提交」：注入 prompt 让 agent 自行 git add/commit ----
  const handleCommit = useCallback(async () => {
    if (!sessionId || committing) return;
    setCommitting(true);
    setMenuOpen(false);
    try {
      await sendAgentCommand(sessionId, {
        type: "prompt",
        message:
          "请提交当前工作区的变更（git add -A 后 git commit，message 用一句话概括本次改动；如有远端配置可顺手 push，但不要 push --force）。完成后回复 summary。",
      });
    } catch {
      /* swallow — agent may not be ready; user can retry */
    } finally {
      // Reset after a short delay so the button doesn't re-enable during prompt arrival.
      setTimeout(() => setCommitting(false), 1500);
    }
  }, [sessionId, committing]);

  const toggleExpanded = (k: FileWhere) => setExpanded((s) => ({ ...s, [k]: !s[k] }));

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* ---- Header ---- */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: cwd ? 2 : 0,
          padding: "10px 14px 8px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          minHeight: 38,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flex: 1 }}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--accent)", flexShrink: 0 }}
            >
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M6 9v6" />
              <path d="M18 9a3 3 0 1 0-3-3" />
              <path d="M15 21h6" />
              <path d="M18 18v3" />
            </svg>
          </div>

          {/* Three-dot menu */}
          <div
            ref={menuRef}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 2,
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => setMenuOpen((v) => !v)}
              title={t("inspector.more")}
              aria-label={t("inspector.more")}
              style={{
                ...iconBtn,
                color: menuOpen ? "var(--text)" : "var(--text-muted)",
                background: menuOpen ? "var(--bg-hover)" : "transparent",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="19" cy="12" r="1.6" />
              </svg>
            </button>

            {menuOpen && (
              <div
                role="menu"
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  minWidth: 220,
                  padding: 4,
                  background: "color-mix(in srgb, var(--bg-panel) 96%, transparent)",
                  backdropFilter: "blur(14px) saturate(160%)",
                  WebkitBackdropFilter: "blur(14px) saturate(160%)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  boxShadow: "0 8px 28px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.10)",
                  zIndex: 3,
                  animation: "inspector-fade-down 0.14s ease-out",
                }}
              >
                <MenuItem
                  onClick={() => {
                    void reloadGit();
                    setMenuOpen(false);
                  }}
                  icon={
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
                    </svg>
                  }
                  label={t("common.refresh")}
                />
                <MenuItem
                  onClick={() => {
                    void handleCommit();
                  }}
                  disabled={!canCommit}
                  icon={
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2v20M5 9l7-7 7 7" />
                    </svg>
                  }
                  label={
                    committing
                      ? t("inspector.commitPending")
                      : agentRunning
                        ? t("inspector.commitBusy")
                        : !sessionId
                          ? t("inspector.commitNoSession")
                          : !git
                            ? t("inspector.commitNoGit")
                            : t("inspector.commitAskAgent")
                  }
                />
                <div
                  style={{
                    height: 1,
                    margin: "4px 6px",
                    background: "var(--border)",
                  }}
                />
                <ToggleRow
                  enabled={gitPolling}
                  onToggle={() => setGitPolling(!gitPolling)}
                  label={t("inspector.gitPolling")}
                />
              </div>
            )}
          </div>
        </div>

        {/* cwd subtitle (shows which dir is being inspected) */}
        {cwd && (
          <div
            title={cwd}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-dim)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              direction: "rtl", // keep the meaningful path tail visible when truncating
              textAlign: "left",
            }}
          >
            {cwd}
          </div>
        )}
      </div>

      {/* ---- Block: Git changes (skeleton while loading) ---- */}
      {git === null && gitLoading && cwd && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px 6px" }}>
            <Skeleton width={22} height={22} rounded={6} />
            <Skeleton width={60} />
            <span style={{ flex: 1 }} />
            <Skeleton width={36} />
            <Skeleton width={36} />
          </div>
          <div style={{ display: "flex", gap: 14, padding: "0 14px 10px 44px" }}>
            <Skeleton width={80} height={9} />
            <Skeleton width={70} height={9} />
          </div>
        </div>
      )}

      {/* ---- Block: Git changes ---- */}
      {git && (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px 6px",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--text-muted)" }}
              >
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </span>
            <span style={{ fontSize: 13, color: "var(--text)", flex: 1, fontWeight: 500 }}>
              {t("inspector.changes")}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--git-added)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              +{fmt(git.added)}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--git-deleted)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              −{fmt(git.deleted)}
            </span>
          </div>

          {/* Sub-detail: file counts (semantic colors) — each is a click target for expand/collapse */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              padding: "0 14px 6px 44px",
            }}
          >
            <FileCountRow
              where="unstaged"
              label={t("inspector.modified")}
              count={git.modified}
              files={grouped.unstaged}
              expanded={expanded.unstaged}
              onToggle={() => toggleExpanded("unstaged")}
              accent="var(--git-modified)"
            />
            <FileCountRow
              where="staged"
              label={t("inspector.staged")}
              count={git.staged}
              files={grouped.staged}
              expanded={expanded.staged}
              onToggle={() => toggleExpanded("staged")}
              accent="var(--accent)"
            />
            {git.untracked > 0 && (
              <FileCountRow
                where="untracked"
                label={t("inspector.untracked")}
                count={git.untracked}
                files={grouped.untracked}
                expanded={expanded.untracked}
                onToggle={() => toggleExpanded("untracked")}
                accent="var(--git-untracked)"
              />
            )}
          </div>

          {/* "Xs ago" indicator — hidden when polling is off (avoid fake freshness) */}
          {gitPolling && lastGitFetchAt && (
            <div
              data-now-tick={now}
              style={{
                display: "flex",
                justifyContent: "flex-end",
                padding: "0 14px 6px 44px",
                fontSize: 9,
                color: "var(--text-dim)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "var(--git-added)",
                    opacity: 0.7,
                  }}
                />
                {t("inspector.updatedAgo", {
                  time: formatRelative(now - lastGitFetchAt),
                })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ---- Block: Branch (纯展示，原死按钮已删) ---- */}
      {git && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <span
            title={t("inspector.branch")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
              padding: "5px 8px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--text)",
              flex: 1,
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--accent)", flexShrink: 0 }}
            >
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M6 9v6" />
              <path d="M18 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M18 12v3a3 3 0 0 1-3 3H9" />
            </svg>
            <span
              style={{
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {git.branch ?? t("inspector.detached")}
            </span>
          </span>
        </div>
      )}

      {/* ---- Empty state ---- */}
      {!git && !gitLoading && (
        <div
          style={{
            padding: "32px 16px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          {!cwd ? (
            <>
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--text-dim)" }}
              >
                <path d="M3 7l9-4 9 4-9 4-9-4z" />
                <path d="M3 7v10l9 4 9-4V7" />
                <path d="M12 11v10" />
              </svg>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-dim)",
                  textAlign: "center",
                  lineHeight: 1.5,
                }}
              >
                {t("inspector.emptyNoCwd")}
              </span>
            </>
          ) : gitData && !gitData.isGit ? (
            <>
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--text-dim)" }}
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-dim)",
                  textAlign: "center",
                  lineHeight: 1.5,
                }}
              >
                {t("inspector.emptyNoGit")}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--text-dim)",
                  direction: "rtl",
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {cwd}
              </span>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
});

// ---- File count row (clickable, expands to show file list) ----

function FileCountRow({
  label,
  count,
  files,
  expanded,
  onToggle,
  accent,
}: {
  where: FileWhere;
  label: string;
  count: number;
  files: GitFile[];
  expanded: boolean;
  onToggle: () => void;
  accent: string;
}) {
  const [hover, setHover] = useState(false);
  // Hide row entirely when there are no files in this bucket (e.g. 0 untracked).
  if (count === 0 && files.length === 0) return null;
  const hasFiles = files.length > 0;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        aria-expanded={expanded}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 4px",
          marginLeft: -4,
          border: "none",
          borderRadius: 4,
          background: hover ? "var(--bg-hover)" : "transparent",
          color: count > 0 ? accent : "var(--text-dim)",
          fontSize: 10,
          fontWeight: count > 0 ? 500 : 400,
          cursor: hasFiles ? "pointer" : "default",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: hasFiles ? 0.7 : 0,
            transition: "transform 0.15s",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          }}
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M9 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: count > 0 ? accent : "var(--border)",
          }}
        />
        <span>
          {label}: {count}
        </span>
      </button>
      {expanded && hasFiles && (
        <div style={{ marginTop: 2, marginBottom: 4 }}>
          {files.map((f) => (
            <FileRow key={`${f.where}:${f.path}`} file={f} accent={accent} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Single file row (path + +/- + status) ----

function FileRow({ file, accent }: { file: GitFile; accent: string }) {
  const [hover, setHover] = useState(false);
  const isUntracked = file.where === "untracked";
  const showCounts = !isUntracked && (file.added > 0 || file.deleted > 0);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={file.path}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 4px",
        borderRadius: 4,
        background: hover ? "var(--bg-hover)" : "transparent",
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        lineHeight: 1.5,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          minWidth: 14,
          textAlign: "center",
          color: accent,
          fontWeight: 600,
        }}
      >
        {file.status === "??" ? "??" : file.status}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--text)",
          direction: "rtl", // keep filename tail visible when truncating long paths
          textAlign: "left",
        }}
      >
        {file.path}
      </span>
      {showCounts ? (
        <span
          style={{
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
            fontSize: 9,
            color: "var(--text-dim)",
          }}
        >
          <span style={{ color: "var(--git-added)" }}>+{file.added}</span>
          {file.deleted > 0 && (
            <>
              <span style={{ color: "var(--text-dim)", margin: "0 1px" }}>·</span>
              <span style={{ color: "var(--git-deleted)" }}>−{file.deleted}</span>
            </>
          )}
        </span>
      ) : (
        <span style={{ flexShrink: 0, width: 1 }} />
      )}
    </div>
  );
}

// ---- Menu item helper ----

function MenuItem({
  onClick,
  label,
  icon,
  disabled,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled}
      role="menuitem"
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "7px 10px",
        border: "none",
        borderRadius: 7,
        background: hover && !disabled ? "var(--bg-hover)" : "transparent",
        color: disabled ? "var(--text-dim)" : "var(--text)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 12,
        textAlign: "left",
        opacity: disabled ? 0.6 : 1,
        transition: "background 0.1s",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          width: 14,
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
}

// ---- Toggle row for L2 switches inside the menu ----

function ToggleRow({
  enabled,
  onToggle,
  label,
}: {
  enabled: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "6px 10px",
        fontSize: 12,
        color: "var(--text)",
      }}
    >
      <span style={{ flex: 1 }}>{label}</span>
      <MiniToggle enabled={enabled} onToggle={onToggle} ariaLabel={label} />
    </div>
  );
}

// ---- Skeleton placeholder ----

function Skeleton({
  width,
  height = 12,
  rounded = 4,
}: {
  width: number | string;
  height?: number;
  rounded?: number;
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: rounded,
        background:
          "linear-gradient(90deg, var(--bg-subtle) 0%, color-mix(in srgb, var(--bg-hover) 70%, transparent) 50%, var(--bg-subtle) 100%)",
        backgroundSize: "200% 100%",
        animation: "inspector-shimmer 1.6s ease-in-out infinite",
      }}
    />
  );
}

// ---- Relative time formatter ----
// "just now" / "12s ago" / "3m ago". Inputs are non-negative ms.
function formatRelative(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--text-muted)",
  padding: 5,
  borderRadius: 6,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "background 0.1s",
};
