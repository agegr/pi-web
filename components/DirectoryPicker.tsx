"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";

interface DirectoryEntry {
  name: string;
  path: string;
}

interface BrowseResponse {
  path?: string;
  parentPath?: string | null;
  directories?: DirectoryEntry[];
  drives?: DirectoryEntry[];
  error?: string;
}

type DirectoryOperation =
  | { kind: "create"; name: string }
  | { kind: "rename"; path: string; name: string };

async function loadDirectories(directory?: string): Promise<BrowseResponse> {
  const query = directory ? `?path=${encodeURIComponent(directory)}` : "";
  const response = await fetch(`/api/cwd/browse${query}`);
  const data = await response.json() as BrowseResponse;
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M1.5 3h4l1.5 2h7.5v7.5h-13z" />
    </svg>
  );
}

function NewFolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.75 4h5l1.5 2h8v8.25a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" />
      <path d="M12.25 8.25v4M10.25 10.25h4" />
    </svg>
  );
}

function RenameIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m11.8 3.1 3.1 3.1M3 15l2.9-.6L14.4 5.9a1.5 1.5 0 0 0-2.1-2.1L3.8 12.1z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function DriveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 9h12" />
      <circle cx="11.5" cy="11" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function isWindowsDriveRoot(directory: string): boolean {
  return /^[a-zA-Z]:[\\/]?$/.test(directory);
}

interface Props {
  onCancel: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  busy?: boolean;
  error?: string | null;
}

export function DirectoryPicker({ onCancel, onSelect, initialPath, busy = false, error }: Props) {
  const { t } = useI18n();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [parentDirectory, setParentDirectory] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState(initialPath ?? "");
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [drives, setDrives] = useState<DirectoryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operation, setOperation] = useState<DirectoryOperation | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [hoveredDirectoryPath, setHoveredDirectoryPath] = useState<string | null>(null);
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const operationBusyRef = useRef(false);
  const deleteBusyRef = useRef(false);
  const skipRenameBlurRef = useRef(false);
  const [loading, setLoading] = useState(true);

  const navigateTo = useCallback(async (directory?: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await loadDirectories(directory);
      const nextPath = data.path ?? directory ?? "/";
      setCurrentPath(nextPath);
      setParentDirectory(data.parentPath ?? null);
      setPathInput(nextPath);
      setDirectories(data.directories ?? []);
      setDrives(data.drives ?? null);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPortalTarget(document.body);
    void navigateTo(initialPath || undefined);
  }, [initialPath, navigateTo]);

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = pathInput.trim();
    if (candidate) void navigateTo(candidate);
  };

  const beginCreate = () => {
    if (loading || busy || operationBusy || !currentPath) return;
    setOperation({ kind: "create", name: "" });
    setOperationError(null);
  };

  const beginRename = (entry: DirectoryEntry) => {
    if (loading || busy || operationBusy) return;
    setConfirmDeletePath(null);
    setDeleteError(null);
    setOperation({ kind: "rename", path: entry.path, name: entry.name });
    setOperationError(null);
  };

  const beginDelete = (entry: DirectoryEntry) => {
    if (loading || busy || operationBusy || deleteBusy) return;
    setOperation(null);
    setOperationError(null);
    setConfirmDeletePath(entry.path);
    setDeleteError(null);
  };

  const submitOperation = useCallback(async (activeOperation: DirectoryOperation) => {
    if (busy || operationBusyRef.current) return;
    const name = activeOperation.name.trim();
    if (!name) {
      setOperationError(t("directoryPicker.folderNameRequired"));
      return;
    }

    operationBusyRef.current = true;
    setOperationBusy(true);
    setOperationError(null);
    try {
      const isRename = activeOperation.kind === "rename";
      const response = await fetch("/api/cwd/directories", {
        method: isRename ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isRename
          ? { path: activeOperation.path, name }
          : { parentPath: currentPath, name }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);

      setOperation(null);
      await navigateTo(currentPath);
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      operationBusyRef.current = false;
      setOperationBusy(false);
    }
  }, [busy, currentPath, navigateTo, t]);

  const handleOperationSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!operation || operation.kind !== "create" || busy || operationBusy) return;
    await submitOperation(operation);
  };

  const performDelete = useCallback(async (entry: DirectoryEntry) => {
    if (busy || deleteBusyRef.current || confirmDeletePath !== entry.path) return;

    deleteBusyRef.current = true;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const response = await fetch("/api/cwd/directories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: entry.path }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);

      setConfirmDeletePath(null);
      await navigateTo(currentPath);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      deleteBusyRef.current = false;
      setDeleteBusy(false);
    }
  }, [busy, confirmDeletePath, currentPath, navigateTo]);

  const renamingPath = operation?.kind === "rename" ? operation.path : null;

  useEffect(() => {
    if (!renamingPath) return;
    const id = requestAnimationFrame(() => renameInputRef.current?.select());
    return () => cancelAnimationFrame(id);
  }, [renamingPath]);

  const hasUncommittedPath = pathInput.trim() !== currentPath;
  const pickerBusy = busy || operationBusy || deleteBusy;
  const canSelect = Boolean(currentPath) && !hasUncommittedPath && !pickerBusy;
  const canNavigateUp = Boolean(parentDirectory) || isWindowsDriveRoot(currentPath);

  if (!portalTarget) return null;

  return createPortal(
    <div
      className="directory-picker-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("directoryPicker.selectDirectory")}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pickerBusy) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pickerBusy) onCancel();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}
    >
      <div className="directory-picker-panel" style={{ width: 520, maxWidth: "calc(100vw - 16px)", height: "min(620px, calc(100dvh - 16px))", maxHeight: "calc(100dvh - 16px)", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, padding: "12px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 15 }}>{t("directoryPicker.selectDirectory")}</div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={pickerBusy}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
            style={{ padding: "2px 6px", border: 0, background: "none", color: "var(--text-muted)", fontSize: 20, lineHeight: 1, cursor: pickerBusy ? "default" : "pointer", opacity: pickerBusy ? 0.5 : 1 }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handlePathSubmit} style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <button className="directory-picker-back" type="button" onClick={() => void navigateTo(parentDirectory ?? undefined)} disabled={loading || pickerBusy || !canNavigateUp} title={t("directoryPicker.goToParent")} aria-label={t("directoryPicker.goToParent")} style={{ width: 36, height: 36, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: canNavigateUp ? "pointer" : "default", opacity: canNavigateUp && !pickerBusy ? 1 : 0.45 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
          <label htmlFor="directory-path" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
            {t("directoryPicker.directoryPath")}
          </label>
          <input
            className="directory-picker-path"
            id="directory-path"
            type="text"
            value={pathInput}
            placeholder="/path/to/project or ~/project"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setPathInput(event.target.value);
              setLoadError(null);
            }}
            style={{ minWidth: 0, flex: 1, height: 36, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, outline: "none", background: "var(--bg-panel)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
          <button
            className="directory-picker-new"
            type="button"
            onClick={beginCreate}
            disabled={loading || pickerBusy || !currentPath}
            title={t("directoryPicker.newFolder")}
            aria-label={t("directoryPicker.newFolder")}
            style={{ width: 36, height: 36, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: loading || pickerBusy || !currentPath ? "default" : "pointer", opacity: loading || pickerBusy || !currentPath ? 0.45 : 1 }}
          >
            <NewFolderIcon />
          </button>
          <button
            className="directory-picker-action"
            type="submit"
            disabled={loading || pickerBusy || !pathInput.trim()}
            title={t("directoryPicker.goToDirectory")}
            style={{ minWidth: 58, height: 36, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: loading || pickerBusy || !pathInput.trim() ? "default" : "pointer", opacity: loading || pickerBusy || !pathInput.trim() ? 0.6 : 1 }}
          >
            {t("directoryPicker.go")}
          </button>
        </form>

        {operation?.kind === "create" && (
          <form onSubmit={handleOperationSubmit} style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, padding: "8px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
            <label htmlFor="directory-operation-name" style={{ flexShrink: 0, color: "var(--text-muted)", fontSize: 11 }}>{t("directoryPicker.newFolder")}</label>
            <input
              id="directory-operation-name"
              type="text"
              value={operation.name}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setOperation((current) => current ? { ...current, name: event.target.value } : current);
                setOperationError(null);
              }}
              style={{ minWidth: 0, flex: 1, height: 32, padding: "0 9px", border: "1px solid var(--border)", borderRadius: 6, outline: "none", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12 }}
            />
            <button className="directory-picker-action" type="button" onClick={() => { setOperation(null); setOperationError(null); }} disabled={operationBusy} style={{ height: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: operationBusy ? "default" : "pointer", fontSize: 12 }}>{t("i18n.cancel")}</button>
            <button className="directory-picker-action" type="submit" disabled={operationBusy || !operation.name.trim()} style={{ height: 32, padding: "0 10px", border: 0, borderRadius: 6, background: "var(--accent)", color: "var(--accent-contrast)", cursor: operationBusy || !operation.name.trim() ? "default" : "pointer", opacity: operationBusy || !operation.name.trim() ? 0.6 : 1, fontSize: 12, fontWeight: 600 }}>{operationBusy ? t("i18n.saving") : t("directoryPicker.create")}</button>
          </form>
        )}

        <div className="directory-picker-list" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px 10px" }}>
          {loading ? (
            <div style={{ padding: 8, color: "var(--text-dim)", fontSize: 11 }}>{t("directoryPicker.loadingDirectories")}</div>
          ) : drives !== null ? (
            <>
              {drives.length > 0 ? (
                drives.map((drive) => (
                  <button
                    key={drive.path}
                    className="directory-picker-entry"
                    type="button"
                    onClick={() => void navigateTo(drive.path)}
                    disabled={pickerBusy}
                    title={drive.path}
                    style={{ width: "100%", minHeight: 34, display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", border: 0, borderRadius: 5, background: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-mono)", fontSize: 11 }}
                  >
                    <DriveIcon />
                    <span>{drive.name}</span>
                  </button>
                ))
              ) : (
                <div style={{ padding: 8, color: "var(--text-dim)", fontSize: 11 }}>{t("directoryPicker.noDrives")}</div>
              )}
            </>
          ) : directories.length > 0 ? (
            directories.map((entry) => (
              (() => {
                const isRenaming = operation?.kind === "rename" && operation.path === entry.path;
                const isConfirmingDelete = confirmDeletePath === entry.path;
                const isHovered = hoveredDirectoryPath === entry.path;
                return (
                  <div
                    key={entry.path}
                    onMouseEnter={() => setHoveredDirectoryPath(entry.path)}
                    onMouseLeave={() => setHoveredDirectoryPath(null)}
                    style={{ minHeight: 30, display: "flex", alignItems: "center", gap: 4, paddingLeft: isConfirmingDelete ? 6 : 0, borderRadius: 5, background: isConfirmingDelete ? "rgba(239,68,68,0.06)" : isHovered && !isRenaming ? "var(--bg-hover)" : "transparent", borderLeft: isConfirmingDelete ? "2px solid #ef4444" : "2px solid transparent", transition: "background 0.1s", overflow: "hidden" }}
                  >
                    {isConfirmingDelete ? (
                      <>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t("directoryPicker.confirmDeleteFolder", { name: entry.name.slice(0, 22) + (entry.name.length > 22 ? "…" : "") })}
                        </div>
                        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={() => void performDelete(entry)}
                            disabled={deleteBusy}
                            title={t("directoryPicker.deleteFolder")}
                            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, height: 30, padding: "0 11px", background: "#ef4444", border: "none", borderRadius: 6, color: "#fff", cursor: deleteBusy ? "default" : "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", opacity: deleteBusy ? 0.6 : 1 }}
                          >
                            <DeleteIcon />
                            {t("sidebar.delete")}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setConfirmDeletePath(null); setDeleteError(null); }}
                            disabled={deleteBusy}
                            style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 30, padding: "0 11px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: deleteBusy ? "default" : "pointer", fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", opacity: deleteBusy ? 0.6 : 1 }}
                          >
                            {t("sidebar.cancel")}
                          </button>
                        </div>
                      </>
                    ) : isRenaming ? (
                      <input
                        ref={renameInputRef}
                        value={operation.name}
                        onChange={(event) => {
                          setOperation((current) => current?.kind === "rename" ? { ...current, name: event.target.value } : current);
                          setOperationError(null);
                        }}
                        onBlur={() => {
                          if (skipRenameBlurRef.current) {
                            skipRenameBlurRef.current = false;
                            return;
                          }
                          const activeOperation = operation;
                          if (activeOperation?.kind === "rename" && activeOperation.path === entry.path) void submitOperation(activeOperation);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            const activeOperation = operation;
                            if (activeOperation?.kind === "rename" && activeOperation.path === entry.path) void submitOperation(activeOperation);
                          }
                          if (event.key === "Escape") {
                            event.stopPropagation();
                            skipRenameBlurRef.current = true;
                            setOperation(null);
                            setOperationError(null);
                          }
                        }}
                        autoFocus
                        aria-label={`${t("i18n.rename")}: ${entry.name}`}
                        style={{ flex: 1, minWidth: 0, fontSize: 11, padding: "5px 8px", border: "1px solid var(--accent)", borderRadius: 5, outline: "none", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-mono)", height: 30 }}
                      />
                    ) : (
                      <>
                        <button
                          className="directory-picker-entry"
                          type="button"
                          onClick={() => void navigateTo(entry.path)}
                          disabled={pickerBusy}
                          title={entry.path}
                          style={{ flex: 1, minWidth: 0, minHeight: 30, display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", border: 0, borderRadius: 5, background: "none", color: "var(--text-muted)", cursor: pickerBusy ? "default" : "pointer", textAlign: "left", fontFamily: "var(--font-mono)", fontSize: 11, opacity: pickerBusy ? 0.6 : 1 }}
                        >
                          <FolderIcon />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
                        </button>
                        {isHovered && !pickerBusy && (
                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                            <button
                              className="directory-picker-rename"
                              type="button"
                              onClick={() => beginRename(entry)}
                              title={`${t("i18n.rename")}: ${entry.name}`}
                              aria-label={`${t("i18n.rename")}: ${entry.name}`}
                              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, padding: 0, flexShrink: 0, background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", cursor: "pointer", transition: "background 0.12s, color 0.12s, border-color 0.12s" }}
                              onMouseEnter={(event) => {
                                event.currentTarget.style.background = "var(--bg-selected)";
                                event.currentTarget.style.color = "var(--accent)";
                                event.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
                              }}
                              onMouseLeave={(event) => {
                                event.currentTarget.style.background = "var(--bg-hover)";
                                event.currentTarget.style.color = "var(--text-muted)";
                                event.currentTarget.style.borderColor = "var(--border)";
                              }}
                            >
                              <RenameIcon />
                            </button>
                            <button
                              type="button"
                              onClick={() => beginDelete(entry)}
                              title={t("directoryPicker.deleteFolder")}
                              aria-label={`${t("directoryPicker.deleteFolder")}: ${entry.name}`}
                              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, padding: 0, flexShrink: 0, background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", cursor: "pointer", transition: "background 0.12s, color 0.12s, border-color 0.12s" }}
                              onMouseEnter={(event) => {
                                event.currentTarget.style.background = "rgba(239,68,68,0.1)";
                                event.currentTarget.style.color = "#ef4444";
                                event.currentTarget.style.borderColor = "rgba(239,68,68,0.35)";
                              }}
                              onMouseLeave={(event) => {
                                event.currentTarget.style.background = "var(--bg-hover)";
                                event.currentTarget.style.color = "var(--text-muted)";
                                event.currentTarget.style.borderColor = "var(--border)";
                              }}
                            >
                              <DeleteIcon />
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })()
            ))
          ) : (
            <div style={{ padding: 8, color: "var(--text-dim)", fontSize: 11 }}>{t("directoryPicker.noSubdirectories")}</div>
          )}
          {(loadError || error || operationError || deleteError) && <div style={{ padding: "8px", color: "#dc2626", fontSize: 11 }}>{loadError ?? error ?? operationError ?? deleteError}</div>}
        </div>

        <div className="directory-picker-footer" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, flexShrink: 0, padding: "10px 18px", borderTop: "1px solid var(--border)" }}>
          <button className="directory-picker-action" type="button" onClick={onCancel} disabled={pickerBusy} style={{ padding: "6px 14px", border: "1px solid var(--border)", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: pickerBusy ? "default" : "pointer", fontSize: 13 }}>{t("i18n.cancel")}</button>
          <button
            className="directory-picker-action"
            type="button"
            onClick={() => onSelect(currentPath)}
            disabled={!canSelect}
            title={hasUncommittedPath ? t("directoryPicker.openBeforeSelecting") : t("directoryPicker.selectCurrentDirectory")}
            style={{ padding: "6px 16px", border: 0, borderRadius: 6, background: "var(--accent)", color: "var(--accent-contrast)", fontSize: 13, fontWeight: 600, opacity: canSelect ? 1 : 0.6, cursor: canSelect ? "pointer" : "default" }}
          >
            {busy ? t("i18n.checking") : t("directoryPicker.selectThisFolder")}
          </button>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
