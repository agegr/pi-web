"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useAgentRuntime } from "@/lib/agent-runtime-store";

// ---- Types ----

interface GitDiffData {
  isGit: boolean;
  branch: string | null;
  added: number;
  deleted: number;
  modified: number;
  staged: number;
  untracked: number;
}

// ---- Component ----

/**
 * Inspector panel（专注 Git）— git 变更统计 + 分支。
 *
 * 方案C（docs/TODO-INSPECTOR-CLEANUP.md）：inspector 升格为唯一 Git 面板。
 * 任务展示交 TodoPanel，git-status 扩展降级为入口（action+label）。
 * 本面板只读展示 /api/git-diff 的聚合统计（+/- 行数、modified/staged/untracked
 * 计数、分支名）。
 *
 * 已删除（方案C P0）：
 *   - 任务区（ProgressRing / InspectorTaskRow / 进度环）→ 迁 TodoPanel（P1）
 *   - 死按钮（branch 选择器无 onClick / commit-push 无 onClick）→ branch 改纯展示
 *   - pin / open / onToggle / 收起态 pill 残留（容器 WorkspacePanelsHost 接管显隐）
 *   - TodoTask / reloadTodos（todo 数据层交 useTodoTasks）
 */
export const InspectorPanel = memo(function InspectorPanel({ cwd }: { cwd: string | null }) {
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
      setGitData(await res.json());
      setLastGitFetchAt(Date.now());
    } catch {
      /* best-effort */
    }
    setGitLoading(false);
  }, [cwd]);

  // Initial load + git polling (10s)
  useEffect(() => {
    void reloadGit();
    const interval = setInterval(() => void reloadGit(), 10_000);
    return () => clearInterval(interval);
  }, [reloadGit]);

  // Tick every 5s so the "Xs ago" label advances visually between real git refreshes.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  // Re-fetch when agent finishes a run (files may have changed).
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

  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  // Type-narrowed alias: if git is non-null, gitData is a valid GitDiffData.
  const git = gitData?.isGit === true ? gitData : null;

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
                  minWidth: 200,
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
                  checked={false}
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
          {/* Sub-detail: file counts (semantic colors) */}
          <div
            style={{
              display: "flex",
              gap: 10,
              padding: "0 14px 8px 44px",
              fontSize: 10,
              color: "var(--text-dim)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: git.modified > 0 ? "var(--git-modified)" : "var(--border)",
                }}
              />
              <span
                style={{
                  color: git.modified > 0 ? "var(--git-modified)" : "var(--text-dim)",
                  fontWeight: git.modified > 0 ? 500 : 400,
                }}
              >
                {t("inspector.modified")}: {git.modified}
              </span>
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: git.staged > 0 ? "var(--accent)" : "var(--border)",
                }}
              />
              <span
                style={{
                  color: git.staged > 0 ? "var(--accent)" : "var(--text-dim)",
                  fontWeight: git.staged > 0 ? 500 : 400,
                }}
              >
                {t("inspector.staged")}: {git.staged}
              </span>
            </span>
            {git.untracked > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--git-untracked)",
                  }}
                />
                <span style={{ color: "var(--git-untracked)", fontWeight: 500 }}>
                  {t("inspector.untracked")}: {git.untracked}
                </span>
              </span>
            )}
          </div>
          {/* "Xs ago" indicator */}
          {lastGitFetchAt && (
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

// ---- Menu item helper ----

function MenuItem({
  onClick,
  label,
  icon,
  checked,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  checked: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="menuitem"
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "7px 10px",
        border: "none",
        borderRadius: 7,
        background: hover ? "var(--bg-hover)" : "transparent",
        color: "var(--text)",
        cursor: "pointer",
        fontSize: 12,
        textAlign: "left",
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
      {checked && (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: "var(--accent)" }}
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
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
