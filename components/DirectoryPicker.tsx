"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronUp, Folder, FolderPlus, HardDrive } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { DialogShell } from "./DialogShell";

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

interface CreateDirectoryResponse {
  path?: string;
  error?: string;
}

async function loadDirectories(directory?: string): Promise<BrowseResponse> {
  const query = directory ? `?path=${encodeURIComponent(directory)}` : "";
  const response = await fetch(`/api/cwd/browse${query}`);
  const data = await response.json() as BrowseResponse;
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

function FolderIcon() {
  return <Folder size={14} strokeWidth={1.7} aria-hidden="true" />;
}

function NewFolderIcon() {
  return <FolderPlus size={16} strokeWidth={1.8} aria-hidden="true" />;
}

function DriveIcon() {
  return <HardDrive size={14} strokeWidth={1.7} aria-hidden="true" />;
}

function isWindowsDriveRoot(directory: string): boolean {
  return /^[a-zA-Z]:[\\/]?$/.test(directory);
}

interface Props {
  onCancel: () => void;
  onSelect: (path: string) => void;
  busy?: boolean;
  error?: string | null;
}

export function DirectoryPicker({ onCancel, onSelect, busy = false, error }: Props) {
  const { t } = useI18n();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [parentDirectory, setParentDirectory] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [drives, setDrives] = useState<DirectoryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

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
    void navigateTo();
  }, [navigateTo]);

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = pathInput.trim();
    if (candidate) void navigateTo(candidate);
  };

  const handleCreateFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!currentPath || !name || creatingFolder) return;

    setCreatingFolder(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/cwd/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentPath: currentPath, name }),
      });
      const data = await response.json() as CreateDirectoryResponse;
      if (!response.ok || !data.path) {
        if (response.status === 409) throw new Error(t("directoryPicker.folderExists"));
        if (response.status === 400) throw new Error(t("directoryPicker.invalidFolderName"));
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setNewFolderOpen(false);
      setNewFolderName("");
      await navigateTo(data.path);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreatingFolder(false);
    }
  };
  const hasUncommittedPath = pathInput.trim() !== currentPath;
  const canSelect = Boolean(currentPath) && !hasUncommittedPath && !busy;
  const canNavigateUp = Boolean(parentDirectory) || isWindowsDriveRoot(currentPath);

  if (!portalTarget) return null;

  return createPortal(
    <DialogShell
      size="tool"
      title={t("directoryPicker.selectDirectory")}
      ariaLabel={t("i18n.close")}
      onClose={onCancel}
      dismissible={!busy}
      showClose
      bodyClassName="codex-dialog-tool-body directory-picker-panel"
      footer={(
        <div className="directory-picker-footer">
          <button className="codex-dialog-button directory-picker-action" type="button" onClick={onCancel} disabled={busy}>{t("i18n.cancel")}</button>
          <button
            className="codex-dialog-button directory-picker-action"
            data-variant="primary"
            type="button"
            onClick={() => onSelect(currentPath)}
            disabled={!canSelect}
            title={hasUncommittedPath ? t("directoryPicker.openBeforeSelecting") : t("directoryPicker.selectCurrentDirectory")}
          >
            {busy ? t("i18n.checking") : t("directoryPicker.selectThisFolder")}
          </button>
        </div>
      )}
    >
        <form onSubmit={handlePathSubmit} style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <button className="directory-picker-back" type="button" onClick={() => void navigateTo(parentDirectory ?? undefined)} disabled={loading || !canNavigateUp} title={t("directoryPicker.goToParent")} aria-label={t("directoryPicker.goToParent")} style={{ width: 36, height: 36, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: canNavigateUp ? "pointer" : "default", opacity: canNavigateUp ? 1 : 0.45 }}>
            <ChevronUp size={16} strokeWidth={1.8} aria-hidden="true" />
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
            style={{ minWidth: 0, flex: 1, height: 36, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, outline: "none", background: "var(--bg-panel)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: "var(--text-ui)" }}
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
          <button
            className="directory-picker-action"
            type="button"
            disabled={loading || hasUncommittedPath || !currentPath || drives !== null}
            onClick={() => {
              setNewFolderOpen(true);
              setNewFolderName("");
              setLoadError(null);
            }}
            title={t("directoryPicker.newFolder")}
            aria-label={t("directoryPicker.newFolder")}
            style={{ width: 36, height: 36, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: loading || hasUncommittedPath || !currentPath || drives !== null ? "default" : "pointer", opacity: loading || hasUncommittedPath || !currentPath || drives !== null ? 0.5 : 1 }}
          >
            <NewFolderIcon />
          </button>
        </form>

        {newFolderOpen && (
          <form
            className="directory-picker-new-folder"
            onSubmit={(event) => void handleCreateFolder(event)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              if (creatingFolder) return;
              setNewFolderOpen(false);
              setNewFolderName("");
              setLoadError(null);
            }}
            style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, padding: "8px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}
          >
            <FolderIcon />
            <label htmlFor="directory-new-folder" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
              {t("directoryPicker.folderName")}
            </label>
            <input
              className="directory-picker-path"
              id="directory-new-folder"
              value={newFolderName}
              placeholder={t("directoryPicker.folderName")}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              disabled={creatingFolder}
              onChange={(event) => {
                setNewFolderName(event.target.value);
                setLoadError(null);
              }}
              style={{ minWidth: 0, flex: 1, height: 34, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, outline: "none", background: "var(--bg)", color: "var(--text)", fontSize: "var(--text-ui)" }}
            />
            <button className="directory-picker-action" type="button" disabled={creatingFolder} onClick={() => { setNewFolderOpen(false); setNewFolderName(""); setLoadError(null); }} style={{ height: 34, padding: "0 11px", border: "1px solid var(--border)", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: creatingFolder ? "default" : "pointer" }}>
              {t("i18n.cancel")}
            </button>
            <button className="directory-picker-action" type="submit" disabled={creatingFolder || !newFolderName.trim()} style={{ height: 34, padding: "0 12px", border: 0, borderRadius: 6, background: "var(--accent)", color: "#fff", fontWeight: 600, opacity: creatingFolder || !newFolderName.trim() ? 0.6 : 1, cursor: creatingFolder || !newFolderName.trim() ? "default" : "pointer" }}>
              {creatingFolder ? t("directoryPicker.creatingFolder") : t("directoryPicker.createFolder")}
            </button>
          </form>
        )}

        <div className="directory-picker-list" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px 10px" }}>
          {loading ? (
            <div style={{ padding: 8, color: "var(--text-dim)", fontSize: "var(--text-meta)" }}>{t("directoryPicker.loadingDirectories")}</div>
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
                    style={{ width: "100%", minHeight: 34, display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", border: 0, borderRadius: 5, background: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-mono)", fontSize: "var(--text-meta)" }}
                  >
                    <DriveIcon />
                    <span>{drive.name}</span>
                  </button>
                ))
              ) : (
                <div style={{ padding: 8, color: "var(--text-dim)", fontSize: "var(--text-meta)" }}>{t("directoryPicker.noDrives")}</div>
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
                style={{ width: "100%", minHeight: 30, display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", border: 0, borderRadius: 5, background: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-mono)", fontSize: "var(--text-meta)" }}
              >
                <FolderIcon />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
              </button>
            ))
          ) : (
            <div style={{ padding: 8, color: "var(--text-dim)", fontSize: "var(--text-meta)" }}>{t("directoryPicker.noSubdirectories")}</div>
          )}
          {(loadError || error) && <div role="alert" style={{ padding: "8px", color: "#dc2626", fontSize: "var(--text-meta)" }}>{loadError ?? error}</div>}
        </div>
    </DialogShell>,
    portalTarget,
  );
}
