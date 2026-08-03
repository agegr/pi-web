"use client";

import { useCallback, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { PendingRecoveryItem, QueueEntry, QueueEntryInput } from "@/lib/queue-store";
import {
  downloadQueueExport,
  parseQueueImport,
} from "@/lib/queue-export";

/**
 * Modal shown when a session has queued messages that survived a server
 * restart. Nothing is delivered automatically — the user selects which to
 * re-queue, discard, export, or import.
 */
export function QueueRecoveryDialog({
  items,
  sessionId,
  onResolve,
  onExport,
  onImport,
  onDismiss,
  mode = "recovery",
}: {
  items: PendingRecoveryItem[];
  sessionId?: string;
  onResolve: (keep: string[], discard: string[], continueRun: boolean) => Promise<PendingRecoveryItem[]>;
  onExport: () => Promise<{ live: QueueEntry[]; recovery: QueueEntry[] } | null>;
  onImport: (entries: QueueEntryInput[]) => Promise<number | null>;
  onDismiss: () => void;
  /** "recovery" = crash-recovery copy; "import" = imported-queue copy. */
  mode?: "recovery" | "import";
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((item) => item.id)));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(items.map((item) => item.id)));
  }, [items]);

  const selectNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  const selectedIds = items.filter((item) => selected.has(item.id));
  const allSelected = items.length > 0 && selectedIds.length === items.length;

  const doResolve = useCallback(async (continueRun: boolean) => {
    if (selectedIds.length === 0) return;
    setBusy(true);
    setStatus(null);
    try {
      await onResolve(
        selectedIds.map((item) => item.id),
        [],
        continueRun,
      );
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), ok: false });
    } finally {
      setBusy(false);
    }
  }, [selectedIds, onResolve]);

  const doDiscard = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setBusy(true);
    setStatus(null);
    try {
      await onResolve([], selectedIds.map((item) => item.id), false);
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), ok: false });
    } finally {
      setBusy(false);
    }
  }, [selectedIds, onResolve]);

  const doExport = useCallback(async (format: "md" | "json") => {
    const data = await onExport();
    if (!data) return;
    const entries = data.recovery.filter((entry) => selected.has(entry.id));
    downloadQueueExport(entries, { sessionId, source: "recovery" }, format);
    if (entries.length > 0) {
      setStatus({ text: t("chat.queueExported", { count: String(entries.length) }), ok: true });
    }
  }, [onExport, selected, sessionId, t]);

  const doImport = useCallback(async (file: File) => {
    try {
      const content = await file.text();
      const entries = parseQueueImport(content);
      if (entries.length === 0) {
        setStatus({ text: t("chat.queueImportEmpty"), ok: false });
        return;
      }
      const imported = await onImport(entries);
      if (imported !== null) setStatus({ text: t("chat.queueImported", { count: String(imported) }), ok: true });
    } catch {
      setStatus({ text: t("chat.queueImportEmpty"), ok: false });
    }
  }, [onImport, t]);

  // Shared button styles
  const btnBase: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "6px 12px",
    borderRadius: 7,
    fontSize: 12.5,
    fontWeight: 550,
    cursor: "pointer",
    transition: "background 0.12s, border-color 0.12s, color 0.12s, opacity 0.12s",
    whiteSpace: "nowrap",
  };
  const btnDanger: React.CSSProperties = {
    ...btnBase,
    color: "#ef4444",
    background: "transparent",
    border: "1px solid color-mix(in srgb, #ef4444 35%, var(--border))",
  };
  const btnPrimary: React.CSSProperties = {
    ...btnBase,
    color: "var(--accent)",
    background: "color-mix(in srgb, var(--accent) 10%, transparent)",
    border: "1px solid color-mix(in srgb, var(--accent) 45%, var(--border))",
  };
  const btnPrimarySolid: React.CSSProperties = {
    ...btnBase,
    color: "#fff",
    background: "var(--accent)",
    border: "1px solid var(--accent)",
  };

  const disabled = busy || selectedIds.length === 0;
  const dimButton = (style: React.CSSProperties): React.CSSProperties => ({
    ...style,
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isMobile ? 10 : 24,
        background: "rgba(0,0,0,0.4)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "import" ? t("chat.queueImportTitle", { count: String(items.length) }) : t("chat.queueRecoveryTitle", { count: String(items.length) })}
        style={{
          width: "min(760px, calc(100vw - 32px))",
          maxHeight: "88%",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: "var(--bg)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: isMobile ? "10px 12px" : "12px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "flex-start",
          gap: isMobile ? 10 : 12,
          flexWrap: "wrap",
        }}>
          <div
            style={{
              flexShrink: 0,
              width: isMobile ? 30 : 34,
              height: isMobile ? 30 : 34,
              borderRadius: isMobile ? 8 : 9,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "color-mix(in srgb, var(--accent) 12%, transparent)",
              color: "var(--accent)",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
              <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            </svg>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: "var(--text)", fontSize: isMobile ? 14 : 15, fontWeight: 700 }}>
              {mode === "import" ? t("chat.queueImportTitle", { count: String(items.length) }) : t("chat.queueRecoveryTitle", { count: String(items.length) })}
            </div>
            <div style={{
              marginTop: 3,
              color: "var(--text-muted)",
              fontSize: isMobile ? 11 : 12.5,
              lineHeight: 1.5,
              ...(isMobile
                ? {}
                : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }),
            }}>
              {mode === "import"
                ? (isMobile ? t("chat.queueImportDescShort") : t("chat.queueImportDesc"))
                : (isMobile ? t("chat.queueRecoveryDescShort") : t("chat.queueRecoveryDesc"))}
            </div>
          </div>
          {/* Header utility actions (compact icon buttons) — wraps to its own row on small screens */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexShrink: 0,
            ...(isMobile ? { marginLeft: 40, width: "calc(100% - 40px)", justifyContent: "flex-end" } : {}),
          }}>
            <button
              onClick={allSelected ? selectNone : selectAll}
              title={allSelected ? t("chat.queueRecoverySelectNone") : t("chat.queueRecoverySelectAll")}
              aria-label={allSelected ? t("chat.queueRecoverySelectNone") : t("chat.queueRecoverySelectAll")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                height: 28,
                padding: "0 8px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-muted)",
                fontSize: 11.5,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              {allSelected ? t("chat.queueRecoverySelectNone") : t("chat.queueRecoverySelectAll")}
            </button>
            <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 4px" }} />
            <button
              onClick={() => doExport("json")}
              title={t("chat.queueRecoveryExportJson")}
              aria-label={t("chat.queueRecoveryExportJson")}
              disabled={busy || selectedIds.length === 0}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: 7,
                border: "1px solid transparent",
                background: "transparent",
                color: "var(--text-dim)",
                cursor: "pointer",
                opacity: busy || selectedIds.length === 0 ? 0.4 : 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
            <button
              onClick={() => doExport("md")}
              title={t("chat.queueRecoveryExportMd")}
              aria-label={t("chat.queueRecoveryExportMd")}
              disabled={busy || selectedIds.length === 0}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: 7,
                border: "1px solid transparent",
                background: "transparent",
                color: "var(--text-dim)",
                cursor: "pointer",
                opacity: busy || selectedIds.length === 0 ? 0.4 : 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </button>
            <button
              onClick={() => importFileRef.current?.click()}
              title={t("chat.queueImport")}
              aria-label={t("chat.queueImport")}
              disabled={busy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: 7,
                border: "1px solid transparent",
                background: "transparent",
                color: "var(--text-dim)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </button>
            <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 4px" }} />
            <button
              onClick={onDismiss}
              title={t("chat.close")}
              aria-label={t("chat.close")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: 7,
                border: "1px solid transparent",
                background: "transparent",
                color: "var(--text-dim)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Item list */}
        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? 10 : 12, display: "grid", gap: 8, alignContent: "start" }}>
          {items.map((item) => {
            const checked = selected.has(item.id);
            return (
              <button
                key={item.id}
                onClick={() => toggle(item.id)}
                aria-pressed={checked}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 11,
                  width: "100%",
                  padding: "9px 11px",
                  borderRadius: 8,
                  border: `1px solid ${checked ? "color-mix(in srgb, var(--accent) 50%, var(--border))" : "var(--border)"}`,
                  background: checked ? "color-mix(in srgb, var(--accent) 6%, var(--bg-panel))" : "var(--bg-panel)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "border-color 0.12s, background 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (!checked) e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!checked) e.currentTarget.style.background = "var(--bg-panel)";
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(item.id)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ marginTop: 3, accentColor: "var(--accent)", width: 15, height: 15, flexShrink: 0, cursor: "pointer" }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 650,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        padding: "2px 8px",
                        borderRadius: 999,
                        border: `1px solid ${item.kind === "steer" ? "color-mix(in srgb, var(--accent) 40%, transparent)" : "var(--border)"}`,
                        color: item.kind === "steer" ? "var(--accent)" : "var(--text-dim)",
                        background: item.kind === "steer" ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
                      }}
                    >
                      {item.kind === "steer" ? t("chat.queueRecoveryKindSteer") : t("chat.queueRecoveryKindFollowUp")}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                      {new Date(item.queuedAt).toLocaleString()}
                    </span>
                    {item.hasImages && (
                      <span style={{ fontSize: 11, color: "var(--text-dim)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        📎 {t("chat.queueRecoveryImages")}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      color: "var(--text)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: 110,
                      overflowY: "auto",
                      borderLeft: `2px solid ${checked ? "var(--accent)" : "var(--border)"}`,
                      paddingLeft: 9,
                    }}
                  >
                    {item.text || <span style={{ color: "var(--text-dim)", fontStyle: "italic" }}>{t("chat.queueRecoveryNoText")}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer actions — decision row only */}
        <div style={{ padding: "10px 14px 12px", borderTop: "1px solid var(--border)", display: "grid", gap: 9 }}>
          <div style={{
            display: "grid",
            gap: 8,
            ...(isMobile
              ? { gridTemplateColumns: "1fr 1fr" }
              : { gridTemplateColumns: "auto auto auto auto", justifyContent: "end", alignItems: "center" }),
          }}>
            <button
              style={{
                ...btnBase,
                color: "var(--text-muted)",
                background: "transparent",
                border: "none",
                padding: "6px 8px",
                ...(isMobile ? { justifySelf: "start" } : {}),
              }}
              onClick={onDismiss}
              disabled={busy}
              title={t("chat.queueRecoveryDismissTitle")}
            >
              {t("chat.queueRecoveryDismiss")}
            </button>
            <button
              style={{ ...dimButton(btnDanger), ...(isMobile ? { justifySelf: "end" } : {}) }}
              onClick={() => doDiscard()}
              disabled={disabled}
            >
              {t("chat.queueRecoveryDiscard")}
            </button>
            <button
              style={{ ...dimButton(btnPrimary), ...(isMobile ? {} : {}) }}
              onClick={() => doResolve(false)}
              disabled={disabled}
            >
              {t("chat.queueRecoveryRequeue")}
            </button>
            <button
              style={{ ...dimButton(btnPrimarySolid) }}
              onClick={() => doResolve(true)}
              disabled={disabled}
              title={t("chat.queueRecoveryRequeueContinueTitle")}
            >
              {t("chat.queueRecoveryRequeueContinue")}
            </button>
          </div>
          {status && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              padding: "5px 9px",
              borderRadius: 7,
              background: status.ok ? "color-mix(in srgb, #22c55e 9%, transparent)" : "color-mix(in srgb, #ef4444 9%, transparent)",
              color: status.ok ? "#16a34a" : "#ef4444",
              border: `1px solid ${status.ok ? "color-mix(in srgb, #22c55e 30%, transparent)" : "color-mix(in srgb, #ef4444 30%, transparent)"}`,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                {status.ok
                  ? <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>
                  : <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>}
              </svg>
              {status.text}
            </div>
          )}
        </div>
      </div>

      <input
        ref={importFileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void doImport(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
