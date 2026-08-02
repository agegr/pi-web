// 回收站弹窗：按目录分组展示已删除的会话，支持搜索、恢复与彻底删除。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { TrashedSession } from "@/lib/trash";

interface Props {
  onClose: () => void;
  /** 有会话被恢复后回调（侧边栏借此刷新会话列表） */
  onRestored: () => void;
}

export function TrashPanel({ onClose, onRestored }: Props) {
  const { t, locale } = useI18n();
  const isMobile = useIsMobile();
  const [sessions, setSessions] = useState<TrashedSession[] | null>(null);
  const [query, setQuery] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(() => {
    fetch("/api/trash")
      .then((r) => r.json())
      .then((d: { sessions?: TrashedSession[] }) => setSessions(d.sessions ?? []))
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setSessions([]);
      });
  }, []);

  useEffect(load, [load]);

  // Esc 关闭面板（与项目内其它 modal 行为一致）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  // 搜索过滤：匹配标题或原目录
  const filtered = useMemo(() => {
    if (!sessions) return [];
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) => s.title.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q),
    );
  }, [sessions, query]);

  // 按 cwd 分组，保持删除时间倒序
  const groups = useMemo(() => {
    const map = new Map<string, TrashedSession[]>();
    for (const s of filtered) {
      const list = map.get(s.cwd) ?? [];
      list.push(s);
      map.set(s.cwd, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const handleRestore = async (s: TrashedSession) => {
    setBusyKey(s.fileName);
    setError(null);
    try {
      const res = await fetch(`/api/trash/${encodeURIComponent(s.fileName)}`, { method: "POST" });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onRestored();
      setSessions((prev) => prev?.filter((x) => x.fileName !== s.fileName) ?? prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  // 清空回收站：删除全部会话（仅当有会话时可用）
  const handleClearAll = async () => {
    setBusyKey("__clear_all__");
    setError(null);
    try {
      const res = await fetch("/api/trash", { method: "DELETE" });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSessions([]);
      setConfirmClear(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const handlePurge = async (s: TrashedSession) => {
    setBusyKey(s.fileName);
    setError(null);
    try {
      const res = await fetch(`/api/trash?name=${encodeURIComponent(s.fileName)}`, { method: "DELETE" });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSessions((prev) => prev?.filter((x) => x.fileName !== s.fileName) ?? prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
      setConfirmPurge(null);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: isMobile ? "calc(100vw - 16px)" : 620,
        maxWidth: "calc(100vw - 16px)",
        height: isMobile ? "calc(100dvh - 16px)" : "70vh",
        maxHeight: "calc(100dvh - 16px)",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("trash.title")}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {sessions !== null && sessions.length > 0 && (confirmClear ? (
              <>
                <span style={{ fontSize: 12, color: "#ef4444" }}>{t("trash.clearConfirm")}</span>
                <button onClick={handleClearAll} disabled={busyKey !== null} style={{
                  display: "flex", alignItems: "center", gap: 4, height: 26, padding: "0 10px",
                  background: "#ef4444", border: "none", borderRadius: 6, color: "#fff",
                  cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                }}>
                  {t("trash.clearAll")}
                </button>
                <button onClick={() => setConfirmClear(false)} style={{
                  height: 26, padding: "0 10px",
                  background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
                  color: "var(--text-muted)", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap",
                }}>
                  {t("sidebar.cancel")}
                </button>
              </>
            ) : (
              <button onClick={() => setConfirmClear(true)} title={t("trash.clearAll")} style={{
                display: "flex", alignItems: "center", gap: 4, height: 26, padding: "0 10px",
                background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 6,
                color: "var(--text-muted)", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap",
              }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
                {t("trash.clearAll")}
              </button>
            ))}
            <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("trash.searchPlaceholder")}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "var(--bg-panel)", border: "1px solid var(--border)",
              borderRadius: 7, color: "var(--text)", fontSize: 13,
              padding: "7px 10px", outline: "none",
            }}
          />
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: "6px 18px", fontSize: 12, color: "#ef4444", background: "rgba(239,68,68,0.08)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            {error}
          </div>
        )}

        {/* Body: grouped list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
          {sessions === null ? (
            <div style={{ padding: "24px 18px", color: "var(--text-dim)", fontSize: 12 }}>{t("i18n.loading")}</div>
          ) : sessions.length === 0 ? (
            <div style={{ padding: "24px 18px", color: "var(--text-dim)", fontSize: 12 }}>{t("trash.empty")}</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "24px 18px", color: "var(--text-dim)", fontSize: 12 }}>{t("trash.noMatches")}</div>
          ) : (
            groups.map(([cwd, items]) => (
              <div key={cwd}>
                {/* Group header: directory */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 18px 5px",
                  color: "var(--text-muted)", fontSize: 11, fontWeight: 600,
                  fontFamily: "var(--font-mono)",
                  position: "sticky", top: 0,
                  background: "var(--bg)",
                }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cwd}</span>
                </div>

                {/* Sessions in this directory */}
                {items.map((s) => (
                  <TrashItem
                    key={s.fileName}
                    session={s}
                    busy={busyKey === s.fileName}
                    confirmPurge={confirmPurge === s.fileName}
                    updatedAt={t("trash.updatedAt", { time: formatRelativeTime(new Date(s.modified), locale) })}
                    onRestore={() => handleRestore(s)}
                    onPurgeClick={() => setConfirmPurge(s.fileName)}
                    onPurgeCancel={() => setConfirmPurge(null)}
                    onPurgeConfirm={() => handlePurge(s)}
                    t={t}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function TrashItem({
  session, busy, confirmPurge, updatedAt,
  onRestore, onPurgeClick, onPurgeCancel, onPurgeConfirm, t,
}: {
  session: TrashedSession;
  busy: boolean;
  confirmPurge: boolean;
  /** 已格式化的最后更新时间文本 */
  updatedAt: string;
  onRestore: () => void;
  onPurgeClick: () => void;
  onPurgeCancel: () => void;
  onPurgeConfirm: () => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 18px",
        background: hovered ? "var(--bg-hover)" : "transparent",
        opacity: busy ? 0.5 : 1,
      }}
    >
      {confirmPurge ? (
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("trash.purgeConfirm", { title: session.title })}
          </div>
          <button onClick={onPurgeConfirm} disabled={busy} style={{
            display: "flex", alignItems: "center", gap: 4, height: 26, padding: "0 10px",
            background: "#ef4444", border: "none", borderRadius: 6, color: "#fff",
            cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
          }}>
            {t("trash.purge")}
          </button>
          <button onClick={onPurgeCancel} style={{
            height: 26, padding: "0 10px",
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
            color: "var(--text-muted)", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap", flexShrink: 0,
          }}>
            {t("sidebar.cancel")}
          </button>
        </>
      ) : (
        <>
          {/* Title + last updated time */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={session.title}>
              {session.title}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 1 }}>
              {updatedAt}
            </div>
          </div>

          {/* Actions */}
          <button onClick={onRestore} disabled={busy} title={t("trash.restore")} style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            height: 26, padding: "0 10px",
            background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 6,
            color: "var(--accent)", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            {t("trash.restore")}
          </button>
          <button
            onClick={onPurgeClick}
            title={t("trash.purge")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, padding: 0,
              background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 6,
              color: hovered ? "#ef4444" : "var(--text-dim)", cursor: "pointer", flexShrink: 0,
              transition: "color 0.1s",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
