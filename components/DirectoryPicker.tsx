"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { encodeFilePathForApi } from "@/lib/file-paths";

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

/** One sidebar-list entry as the picker's manage panel needs it. */
export interface PickerManagedEntry {
  path: string;
  displayName?: string;
}

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

function DriveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 9h12" />
      <circle cx="11.5" cy="11" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function isWindowsDriveRoot(directory: string): boolean {
  return /^[a-zA-Z]:[\\/]?$/.test(directory);
}

/** Client-side single-segment join for the folder the dialog just created. */
function joinDirectoryPath(parent: string, name: string): string {
  const trimmed = parent.replace(/[\\/]+$/, "");
  if (isWindowsDriveRoot(parent)) return `${trimmed}\\${name}`;
  return `${trimmed}/${name}`;
}

interface Props {
  onCancel: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  busy?: boolean;
  error?: string | null;
  /**
   * Manage mode (optional): when `entries` is provided the dialog also shows
   * the sidebar's directory list with rename/remove affordances and a
   * "New folder" action. Absent, the dialog behaves exactly as before —
   * browse, select, cancel.
   */
  entries?: readonly PickerManagedEntry[];
  onRenameEntry?: (path: string, displayName: string | null) => void;
  onRemoveEntry?: (path: string) => void;
}

function ManagedEntryRow({
  entry,
  onRename,
  onRemove,
}: {
  entry: PickerManagedEntry;
  onRename: (path: string, displayName: string | null) => void;
  onRemove: (path: string) => void;
}) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(entry.displayName ?? "");

  const commitRename = () => {
    setRenaming(false);
    const name = renameValue.trim();
    if (name === (entry.displayName ?? "")) return;
    onRename(entry.path, name === "" ? null : name);
  };

  if (renaming) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px" }}>
        <input
          type="text"
          value={renameValue}
          autoFocus
          placeholder={t("directoryPicker.entryName")}
          onChange={(event) => setRenameValue(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename();
            if (event.key === "Escape") setRenaming(false);
          }}
          style={{ minWidth: 0, flex: 1, height: 26, padding: "0 8px", border: "1px solid var(--accent)", borderRadius: 5, outline: "none", background: "var(--bg-panel)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11 }}
        />
        <button type="button" onClick={commitRename} title={t("directoryPicker.renameEntry")} style={{ padding: "3px 8px", border: 0, borderRadius: 5, background: "var(--accent)", color: "var(--accent-contrast)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}>
          {t("directoryPicker.renameEntry")}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
      <span title={entry.path} style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: 11, color: entry.displayName ? "var(--text)" : "var(--text-muted)" }}>
        {entry.displayName ?? entry.path}
      </span>
      <button
        type="button"
        onClick={() => { setRenameValue(entry.displayName ?? ""); setRenaming(true); }}
        title={t("directoryPicker.renameEntry")}
        aria-label={t("directoryPicker.renameEntry")}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, border: 0, borderRadius: 5, background: "none", color: "var(--text-dim)", cursor: "pointer", flexShrink: 0 }}
      >
        <PencilIcon />
      </button>
      <button
        type="button"
        onClick={() => onRemove(entry.path)}
        title={t("directoryPicker.removeEntry")}
        aria-label={t("directoryPicker.removeEntry")}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, border: 0, borderRadius: 5, background: "none", color: "var(--text-dim)", cursor: "pointer", flexShrink: 0 }}
        onMouseEnter={(event) => { event.currentTarget.style.color = "#ef4444"; }}
        onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-dim)"; }}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

export function DirectoryPicker({ onCancel, onSelect, initialPath, busy = false, error, entries, onRenameEntry, onRemoveEntry }: Props) {
  const { t } = useI18n();
  const manage = entries !== undefined;
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [parentDirectory, setParentDirectory] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState(initialPath ?? "");
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [drives, setDrives] = useState<DirectoryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // New-folder creation (manage mode): inline name input + typed error state.
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [mkdirError, setMkdirError] = useState<string | null>(null);
  const [mkdirBusy, setMkdirBusy] = useState(false);

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
  const hasUncommittedPath = pathInput.trim() !== currentPath;
  const canSelect = Boolean(currentPath) && !hasUncommittedPath && !busy;
  const canNavigateUp = Boolean(parentDirectory) || isWindowsDriveRoot(currentPath);

  // "New folder": registers the currently browsed parent as an allowed file
  // root through the same /api/cwd/validate integration the sidebar's
  // custom-path commit uses, then creates exactly parent/name through the
  // files API mkdir branch and enters the created folder (which also
  // refreshes the listing).
  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name || !currentPath || mkdirBusy) return;
    setMkdirBusy(true);
    setMkdirError(null);
    try {
      const validate = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: currentPath }),
      });
      if (!validate.ok) {
        const data = await validate.json().catch(() => ({})) as { error?: string };
        setMkdirError(data.error ?? `HTTP ${validate.status}`);
        return;
      }
      const res = await fetch(`/api/files/${encodeFilePathForApi(currentPath)}?type=mkdir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          setMkdirError(t("directoryPicker.mkdirConflict"));
          return;
        }
        const data = await res.json().catch(() => ({})) as { error?: string };
        setMkdirError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setNewFolderOpen(false);
      setNewFolderName("");
      await navigateTo(joinDirectoryPath(currentPath, name));
    } catch (cause) {
      setMkdirError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMkdirBusy(false);
    }
  }, [newFolderName, currentPath, mkdirBusy, navigateTo, t]);

  if (!portalTarget) return null;

  return createPortal(
    <div
      className="directory-picker-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("directoryPicker.selectDirectory")}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onCancel();
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
            disabled={busy}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
            style={{ padding: "2px 6px", border: 0, background: "none", color: "var(--text-muted)", fontSize: 20, lineHeight: 1, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handlePathSubmit} style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <button className="directory-picker-back" type="button" onClick={() => void navigateTo(parentDirectory ?? undefined)} disabled={loading || !canNavigateUp} title={t("directoryPicker.goToParent")} aria-label={t("directoryPicker.goToParent")} style={{ width: 36, height: 36, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: canNavigateUp ? "pointer" : "default", opacity: canNavigateUp ? 1 : 0.45 }}>
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
            className="directory-picker-action"
            type="submit"
            disabled={loading || !pathInput.trim()}
            title={t("directoryPicker.goToDirectory")}
            style={{ minWidth: 58, height: 36, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: loading || !pathInput.trim() ? "default" : "pointer", opacity: loading || !pathInput.trim() ? 0.6 : 1 }}
          >
            {t("directoryPicker.go")}
          </button>
        </form>

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
              <button
                key={entry.path}
                className="directory-picker-entry"
                type="button"
                onClick={() => void navigateTo(entry.path)}
                title={entry.path}
                style={{ width: "100%", minHeight: 30, display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", border: 0, borderRadius: 5, background: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-mono)", fontSize: 11 }}
              >
                <FolderIcon />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
              </button>
            ))
          ) : (
            <div style={{ padding: 8, color: "var(--text-dim)", fontSize: 11 }}>{t("directoryPicker.noSubdirectories")}</div>
          )}
          {(loadError || error) && <div style={{ padding: "8px", color: "#dc2626", fontSize: 11 }}>{loadError ?? error}</div>}

          {/* Manage mode: the sidebar's directory list with rename/remove and
              folder creation. Absent `entries` keeps the dialog exactly as
              the plain browse/select consumer sees it. */}
          {manage && (
            <div className="directory-picker-manage" style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <div style={{ padding: "0 8px 6px", color: "var(--text-dim)", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                {t("directoryPicker.entriesTitle")}
              </div>
              {entries.length === 0 && (
                <div style={{ padding: "4px 8px 8px", color: "var(--text-dim)", fontSize: 11 }}>{t("directoryPicker.noEntries")}</div>
              )}
              {entries.map((entry) => (
                <ManagedEntryRow
                  key={entry.path}
                  entry={entry}
                  onRename={onRenameEntry ?? (() => {})}
                  onRemove={onRemoveEntry ?? (() => {})}
                />
              ))}

              {!newFolderOpen ? (
                <button
                  type="button"
                  onClick={() => {
                    setNewFolderOpen(true);
                    setMkdirError(null);
                  }}
                  title={t("directoryPicker.newFolder")}
                  style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "7px 8px", border: 0, borderRadius: 5, background: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 11 }}
                >
                  <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
                    <line x1="5" y1="1" x2="5" y2="9" />
                    <line x1="1" y1="5" x2="9" y2="5" />
                  </svg>
                  <span>{t("directoryPicker.newFolder")}</span>
                </button>
              ) : (
                <div style={{ padding: "4px 8px" }}>
                  <input
                    type="text"
                    value={newFolderName}
                    autoFocus
                    placeholder={t("directoryPicker.folderName")}
                    onChange={(event) => {
                      setNewFolderName(event.target.value);
                      setMkdirError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleCreateFolder();
                      }
                      if (event.key === "Escape") {
                        setNewFolderOpen(false);
                        setNewFolderName("");
                        setMkdirError(null);
                      }
                    }}
                    style={{ width: "100%", height: 28, padding: "0 8px", border: "1px solid var(--accent)", borderRadius: 5, outline: "none", background: "var(--bg-panel)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11, boxSizing: "border-box" }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => void handleCreateFolder()}
                      disabled={mkdirBusy || !newFolderName.trim()}
                      style={{ flex: 1, padding: "4px 0", border: 0, borderRadius: 5, background: "var(--accent)", color: "var(--accent-contrast)", fontSize: 11, fontWeight: 600, cursor: mkdirBusy || !newFolderName.trim() ? "not-allowed" : "pointer", opacity: mkdirBusy || !newFolderName.trim() ? 0.65 : 1 }}
                    >
                      {mkdirBusy ? t("i18n.checking") : t("directoryPicker.createFolder")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNewFolderOpen(false);
                        setNewFolderName("");
                        setMkdirError(null);
                      }}
                      style={{ flex: 1, padding: "4px 0", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-hover)", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}
                    >
                      {t("i18n.cancel")}
                    </button>
                  </div>
                  {mkdirError && (
                    <div style={{ marginTop: 6, color: "#dc2626", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                      {mkdirError}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="directory-picker-footer" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, flexShrink: 0, padding: "10px 18px", borderTop: "1px solid var(--border)" }}>
          <button className="directory-picker-action" type="button" onClick={onCancel} disabled={busy} style={{ padding: "6px 14px", border: "1px solid var(--border)", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: busy ? "default" : "pointer", fontSize: 13 }}>{t("i18n.cancel")}</button>
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
