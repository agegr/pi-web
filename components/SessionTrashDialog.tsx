"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { TrashedSessionInfo } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;

interface Props {
  projectKey: string;
  projectLabel: string;
  onClose: () => void;
  onChanged: () => void;
}

async function responseError(response: Response): Promise<string> {
  const data = await response.json().catch(() => ({})) as { error?: string };
  return data.error ?? `HTTP ${response.status}`;
}

export function SessionTrashDialog({ projectKey, projectLabel, onClose, onChanged }: Props) {
  const { locale, t } = useI18n();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [sessions, setSessions] = useState<TrashedSessionInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadTrash = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/trash?projectKey=${encodeURIComponent(projectKey)}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as { sessions?: TrashedSessionInfo[] };
      const nextSessions = data.sessions ?? [];
      setSessions(nextSessions);
      setSelectedIds((previous) => {
        const available = new Set(nextSessions.map((session) => session.id));
        return new Set([...previous].filter((id) => available.has(id)));
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [projectKey]);

  useEffect(() => {
    setPortalTarget(document.body);
    void loadTrash();
  }, [loadTrash]);

  const allSelected = sessions.length > 0 && selectedIds.size === sessions.length;
  const selectedCount = selectedIds.size;
  const mutationPending = deleting || Boolean(restoringId);

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(sessions.map((session) => session.id)));
    setConfirmDelete(false);
  };

  const toggleOne = (sessionId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
    setConfirmDelete(false);
  };

  const restore = async (sessionId: string) => {
    setConfirmDelete(false);
    setRestoringId(sessionId);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/trash/${encodeURIComponent(sessionId)}/restore`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(await responseError(response));
      setSessions((previous) => previous.filter((session) => session.id !== sessionId));
      setSelectedIds((previous) => {
        const next = new Set(previous);
        next.delete(sessionId);
        return next;
      });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRestoringId(null);
    }
  };

  const permanentlyDelete = async () => {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    setError(null);
    try {
      const ids = [...selectedIds];
      const response = await fetch("/api/sessions/trash", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setSessions((previous) => previous.filter((session) => !selectedIds.has(session.id)));
      setSelectedIds(new Set());
      setConfirmDelete(false);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      void loadTrash();
    } finally {
      setDeleting(false);
    }
  };

  if (!portalTarget) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("trash.title")}
      onClick={(event) => {
        if (event.target === event.currentTarget && !mutationPending) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !mutationPending) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
        background: "rgba(0,0,0,0.42)",
      }}
    >
      <div style={{
        width: 620,
        maxWidth: "100%",
        maxHeight: "min(720px, calc(100dvh - 24px))",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--bg)",
        boxShadow: "0 18px 48px rgba(0,0,0,0.28)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("trash.title")}</div>
            <div title={projectLabel} style={{ marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
              {projectLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            disabled={mutationPending}
            aria-label={t("i18n.close")}
            title={t("i18n.close")}
            style={{ border: 0, background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "3px 7px" }}
          >
            ×
          </button>
        </div>

        <div style={{
          margin: "14px 18px 0",
          padding: "11px 13px",
          border: "1px solid rgba(245,158,11,0.45)",
          borderRadius: 8,
          background: "rgba(245,158,11,0.10)",
          color: "var(--text)",
          fontSize: 12,
          fontWeight: 650,
          lineHeight: 1.55,
        }}>
          {t("trash.retentionNotice")}
        </div>

        {error && (
          <div role="alert" style={{ margin: "10px 18px 0", padding: "8px 10px", borderRadius: 6, background: "rgba(239,68,68,0.10)", color: "#ef4444", fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 180, overflowY: "auto", padding: "12px 18px 16px" }}>
          {loading ? (
            <div style={{ padding: "28px 0", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>{t("trash.loading")}</div>
          ) : sessions.length === 0 ? (
            <div style={{ padding: "34px 0", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>{t("trash.empty")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 10px 5px", color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={mutationPending} />
                <span>{t("trash.selectAll")}</span>
              </label>
              {sessions.map((session) => {
                const daysRemaining = Math.max(1, Math.ceil((Date.parse(session.expiresAt) - Date.now()) / DAY_MS));
                const busy = mutationPending;
                return (
                  <div key={session.id} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 64, padding: "9px 10px", border: "1px solid var(--border)", borderRadius: 8, background: selectedIds.has(session.id) ? "var(--bg-selected)" : "var(--bg-panel)" }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(session.id)}
                      onChange={() => toggleOne(session.id)}
                      disabled={mutationPending}
                      aria-label={t("trash.selectSession", { title: session.title })}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div title={session.title} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: 12, fontWeight: 600 }}>
                        {session.title}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 10px", marginTop: 5, color: "var(--text-dim)", fontSize: 10 }}>
                        <span>{t("trash.deletedAt", { date: new Date(session.deletedAt).toLocaleString(locale) })}</span>
                        <span style={{ color: "#d97706" }}>
                          {daysRemaining === 1 ? t("trash.oneDayRemaining") : t("trash.daysRemaining", { count: daysRemaining })}
                        </span>
                        {session.sessionCount > 1 && <span>{t("trash.familySize", { count: session.sessionCount })}</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void restore(session.id)}
                      disabled={busy}
                      style={{ flexShrink: 0, padding: "6px 11px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--accent)", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, fontSize: 11, fontWeight: 600 }}
                    >
                      {restoringId === session.id ? t("trash.restoring") : t("trash.restore")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {sessions.length > 0 && (
          <div style={{ padding: "11px 18px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
            {confirmDelete ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, color: "#ef4444", fontSize: 12, fontWeight: 600 }}>
                  {t("trash.confirmPermanentDelete", { count: selectedCount })}
                </div>
                <button type="button" onClick={() => setConfirmDelete(false)} disabled={mutationPending} style={{ padding: "6px 11px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>
                  {t("i18n.cancel")}
                </button>
                <button type="button" onClick={() => void permanentlyDelete()} disabled={mutationPending} style={{ padding: "6px 11px", border: 0, borderRadius: 6, background: "#ef4444", color: "#fff", cursor: mutationPending ? "default" : "pointer", fontSize: 11, fontWeight: 650 }}>
                  {deleting ? t("trash.deleting") : t("trash.deleteNow")}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, color: "var(--text-muted)", fontSize: 12 }}>{t("trash.selectedCount", { count: selectedCount })}</div>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={selectedCount === 0 || mutationPending}
                  style={{ padding: "6px 12px", border: "1px solid rgba(239,68,68,0.45)", borderRadius: 6, background: "rgba(239,68,68,0.08)", color: "#ef4444", cursor: selectedCount === 0 || mutationPending ? "default" : "pointer", opacity: selectedCount === 0 || mutationPending ? 0.5 : 1, fontSize: 11, fontWeight: 600 }}
                >
                  {t("trash.deletePermanently")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    portalTarget,
  );
}
