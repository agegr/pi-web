"use client";

import { type CSSProperties, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import {
  DIRECTORY_PREVIEW_DELAY_MS,
  browsableInputValue,
  canSelectDirectory,
  createBrowseLane,
  inputMatchesBrowsed,
  isAbortError,
} from "@/lib/directory-picker-sync";

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
  success?: boolean;
  path?: string;
  error?: string;
}

const panelSurfaceStyle: CSSProperties = {
  overflow: "hidden",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
};

const textInputStyle: CSSProperties = {
  height: 36,
  padding: "0 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  outline: "none",
  background: "var(--bg-panel)",
  color: "var(--text)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
};

const actionButtonStyle: CSSProperties = {
  padding: "6px 16px",
  borderRadius: 6,
  fontSize: 13,
};

const primaryActionStyle: CSSProperties = {
  ...actionButtonStyle,
  border: 0,
  background: "var(--accent)",
  color: "var(--accent-contrast)",
  fontWeight: 600,
};

const secondaryActionStyle: CSSProperties = {
  ...actionButtonStyle,
  border: "1px solid var(--border)",
  background: "none",
  color: "var(--text-muted)",
};

async function loadDirectories(directory?: string, signal?: AbortSignal): Promise<BrowseResponse> {
  const query = directory ? `?path=${encodeURIComponent(directory)}` : "";
  const response = await fetch(`/api/cwd/browse${query}`, { signal });
  const data = await response.json() as BrowseResponse;
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

async function createDirectory(parentPath: string, name: string): Promise<string> {
  const response = await fetch("/api/cwd/browse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: parentPath, name }),
  });
  const data = await response.json() as CreateDirectoryResponse;
  if (!response.ok || data.error || !data.path) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return data.path;
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
  // The trimmed text that produced the list below: it may be a path the browser
  // cannot canonicalise itself (/tmp, ~/work, a trailing slash), so it is never
  // compared with the resolved directory.
  const [browsedInput, setBrowsedInput] = useState("");
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [drives, setDrives] = useState<DirectoryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The text a live browse could not open: the list keeps the last folder it did.
  const [unresolvedInput, setUnresolvedInput] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [directoryName, setDirectoryName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const backdropPressRef = useRef(false);
  const createBackdropPressRef = useRef(false);

  const browseLaneRef = useRef(createBrowseLane());
  const requestRef = useRef<{ controller: AbortController; preview: boolean } | null>(null);
  // The field's live text: a response may only rewrite a field the user has not
  // touched since the request left, or a slow first load eats what was typed.
  const inputTextRef = useRef(initialPath ?? "");

  const applyPathInput = useCallback((value: string) => {
    inputTextRef.current = value;
    setPathInput(value);
  }, []);

  const browse = useCallback(async (
    text: string,
    { commitInput = false, preview = false }: { commitInput?: boolean; preview?: boolean } = {},
  ) => {
    const sequence = browseLaneRef.current.begin();
    requestRef.current?.controller.abort();
    const controller = new AbortController();
    requestRef.current = { controller, preview };

    if (preview) {
      setPreviewing(true);
    } else {
      setLoading(true);
      setLoadError(null);
      setUnresolvedInput(null);
    }

    try {
      const data = await loadDirectories(text || undefined, controller.signal);
      if (!browseLaneRef.current.isCurrent(sequence)) return;
      if (commitInput && browsableInputValue(inputTextRef.current) !== browsableInputValue(text)) return;
      const nextPath = data.path ?? text;
      setCurrentPath(nextPath);
      setParentDirectory(data.parentPath ?? null);
      setDirectories(data.directories ?? []);
      setDrives(data.drives ?? null);
      // Only an explicit move rewrites the field: rewriting it while the user
      // types would move the caret. A commit lands on the resolved directory.
      setBrowsedInput(commitInput ? nextPath : text);
      if (commitInput) applyPathInput(nextPath);
      setLoadError(null);
      setUnresolvedInput(null);
    } catch (cause) {
      if (!browseLaneRef.current.isCurrent(sequence) || isAbortError(cause)) return;
      // A live browse only flags the path: the last folder it could open stays
      // listed, so a half-typed path does not empty the picker.
      if (preview) setUnresolvedInput(text);
      else setLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (browseLaneRef.current.isCurrent(sequence)) {
        if (preview) setPreviewing(false);
        else setLoading(false);
      }
    }
  }, [applyPathInput]);

  useEffect(() => {
    setPortalTarget(document.body);
    void browse(initialPath ?? "", { commitInput: true });
  }, [initialPath, browse]);

  useEffect(() => {
    // An explicit browse already loads this text; its own response would be
    // aborted by the duplicate request a preview starts.
    if (loading) return;
    const text = browsableInputValue(pathInput);
    if (!text || text === browsedInput) return;
    const timer = setTimeout(() => {
      void browse(text, { preview: true });
    }, DIRECTORY_PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      // A newer keystroke invalidates a preview still in flight.
      if (requestRef.current?.preview) requestRef.current.controller.abort();
    };
  }, [loading, pathInput, browsedInput, browse]);

  useEffect(() => () => {
    requestRef.current?.controller.abort();
  }, []);

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = browsableInputValue(pathInput);
    if (candidate) void browse(candidate, { commitInput: true });
  };

  const closeCreateDialog = () => {
    if (creating) return;
    setCreateOpen(false);
    setDirectoryName("");
    setCreateError(null);
  };

  // Open the new directory rather than selecting it, so "Select this folder" stays the
  // picker's only commit point and nested folders can be created the same way.
  const handleCreateDirectory = async () => {
    const name = directoryName.trim();
    if (!currentPath || !name || creating) return;

    setCreating(true);
    setCreateError(null);
    try {
      const createdPath = await createDirectory(currentPath, name);
      setCreateOpen(false);
      setDirectoryName("");
      await browse(createdPath, { commitInput: true });
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };

  const listMatchesInput = inputMatchesBrowsed(pathInput, browsedInput);
  const canSelect = canSelectDirectory({
    currentPath,
    input: pathInput,
    browsedInput,
    busy,
    loading,
    previewing,
    unresolved: unresolvedInput !== null,
  });
  const canNavigateUp = Boolean(parentDirectory) || isWindowsDriveRoot(currentPath);

  if (!portalTarget) return null;

  return createPortal(
    <div
      className="directory-picker-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("directoryPicker.selectDirectory")}
      onPointerDown={(event) => {
        backdropPressRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // A click's target is the common ancestor of where the press started and
        // ended, so selecting text in the path input and releasing on the backdrop
        // dispatches a backdrop click. Only a press that began on the backdrop
        // dismisses the picker.
        const pressedBackdrop = backdropPressRef.current;
        backdropPressRef.current = false;
        if (pressedBackdrop && event.target === event.currentTarget && !busy) onCancel();
      }}
      onPointerCancel={() => {
        backdropPressRef.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onCancel();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}
    >
      <div className="directory-picker-panel" style={{ ...panelSurfaceStyle, position: "relative", width: 520, maxWidth: "calc(100vw - 16px)", height: "min(620px, calc(100dvh - 16px))", maxHeight: "calc(100dvh - 16px)", display: "flex", flexDirection: "column" }}>
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
          <button className="directory-picker-back" type="button" onClick={() => void browse(parentDirectory ?? "", { commitInput: true })} disabled={loading || !canNavigateUp} title={t("directoryPicker.goToParent")} aria-label={t("directoryPicker.goToParent")} style={{ width: 36, height: 36, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: canNavigateUp ? "pointer" : "default", opacity: canNavigateUp ? 1 : 0.45 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
          <label htmlFor="directory-path" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
            {t("directoryPicker.directoryPath")}
          </label>
          <input
            className={`directory-picker-path${unresolvedInput !== null ? " is-unresolved" : ""}`}
            id="directory-path"
            type="text"
            value={pathInput}
            placeholder="/path/to/project or ~/project"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              applyPathInput(event.target.value);
              setLoadError(null);
              setUnresolvedInput(null);
            }}
            style={{ ...textInputStyle, minWidth: 0, flex: 1 }}
          />
          <button
            className="directory-picker-action"
            type="submit"
            disabled={loading || !browsableInputValue(pathInput)}
            title={t("directoryPicker.goToDirectory")}
            style={{ minWidth: 58, height: 36, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: loading || !browsableInputValue(pathInput) ? "default" : "pointer", opacity: loading || !browsableInputValue(pathInput) ? 0.6 : 1 }}
          >
            {t("directoryPicker.go")}
          </button>
        </form>

        <div
          className={`directory-picker-list${unresolvedInput !== null ? " is-stale" : ""}`}
          aria-busy={previewing || undefined}
          style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px 10px" }}
        >
          {loading ? (
            <div style={{ padding: 8, color: "var(--text-dim)", fontSize: 11 }}>{t("directoryPicker.loadingDirectories")}</div>
          ) : (
            <>
              {unresolvedInput !== null && (
                <div className="directory-picker-hint">
                  {t("directoryPicker.unresolvedPath", { path: unresolvedInput })}
                  {currentPath ? ` · ${t("directoryPicker.staleListHint", { path: currentPath })}` : ""}
                </div>
              )}
              {drives !== null ? (
                <>
                  {drives.length > 0 ? (
                    drives.map((drive) => (
                      <button
                        key={drive.path}
                        className="directory-picker-entry"
                        type="button"
                        onClick={() => void browse(drive.path, { commitInput: true })}
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
                    onClick={() => void browse(entry.path, { commitInput: true })}
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
            </>
          )}
          {(loadError || error) && <div style={{ padding: "8px", color: "#dc2626", fontSize: 11 }}>{loadError ?? error}</div>}
        </div>

        <div className="directory-picker-footer" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, flexShrink: 0, padding: "10px 18px", borderTop: "1px solid var(--border)" }}>
          <button
            className="directory-picker-action"
            type="button"
            onClick={() => {
              setCreateOpen(true);
              setCreateError(null);
            }}
            disabled={!canSelect}
            style={{ ...secondaryActionStyle, marginRight: "auto", opacity: canSelect ? 1 : 0.6, cursor: canSelect ? "pointer" : "default" }}
          >
            {t("directoryPicker.newDirectory")}
          </button>
          <button className="directory-picker-action" type="button" onClick={onCancel} disabled={busy} style={{ ...secondaryActionStyle, cursor: busy ? "default" : "pointer" }}>{t("i18n.cancel")}</button>
          <button
            className="directory-picker-action"
            type="button"
            onClick={() => onSelect(currentPath)}
            disabled={!canSelect}
            title={listMatchesInput ? t("directoryPicker.selectCurrentDirectory") : t("directoryPicker.openBeforeSelecting")}
            style={{ ...primaryActionStyle, opacity: canSelect ? 1 : 0.6, cursor: canSelect ? "pointer" : "default" }}
          >
            {busy ? t("i18n.checking") : t("directoryPicker.selectThisFolder")}
          </button>
        </div>

        {createOpen && (
          <div
            style={{ position: "absolute", inset: 0, zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, background: "rgba(0,0,0,0.35)" }}
            onPointerDown={(event) => {
              createBackdropPressRef.current = event.target === event.currentTarget;
            }}
            onClick={(event) => {
              const pressedBackdrop = createBackdropPressRef.current;
              createBackdropPressRef.current = false;
              if (pressedBackdrop && event.target === event.currentTarget) closeCreateDialog();
            }}
            onPointerCancel={() => {
              createBackdropPressRef.current = false;
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") closeCreateDialog();
            }}
          >
            <form
              role="dialog"
              aria-modal="true"
              aria-label={t("directoryPicker.createDirectory")}
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateDirectory();
              }}
              style={{ ...panelSurfaceStyle, width: 400, maxWidth: "100%" }}
            >
              <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", color: "var(--text)", fontSize: 15, fontWeight: 700 }}>
                {t("directoryPicker.createDirectory")}
              </div>
              <div style={{ padding: "12px 18px" }}>
                <label htmlFor="new-directory-name" style={{ display: "block", marginBottom: 6, color: "var(--text-muted)", fontSize: 11 }}>
                  {t("directoryPicker.directoryName")}
                </label>
                <input
                  id="new-directory-name"
                  value={directoryName}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t("directoryPicker.directoryNamePlaceholder")}
                  onChange={(event) => {
                    setDirectoryName(event.target.value);
                    setCreateError(null);
                  }}
                  disabled={creating}
                  className="directory-picker-path"
                  style={{ ...textInputStyle, width: "100%", boxSizing: "border-box" }}
                />
                {createError && <div style={{ marginTop: 7, color: "#dc2626", fontSize: 11, lineHeight: 1.35 }}>{createError}</div>}
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button
                    className="directory-picker-action"
                    type="submit"
                    disabled={creating || !directoryName.trim()}
                    style={{ ...primaryActionStyle, flex: 1, opacity: creating ? 0.65 : 1, cursor: creating || !directoryName.trim() ? "default" : "pointer" }}
                  >
                    {creating ? t("directoryPicker.creating") : t("directoryPicker.create")}
                  </button>
                  <button
                    className="directory-picker-action"
                    type="button"
                    onClick={closeCreateDialog}
                    disabled={creating}
                    style={{ ...secondaryActionStyle, flex: 1, cursor: creating ? "default" : "pointer" }}
                  >
                    {t("i18n.cancel")}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>,
    portalTarget,
  );
}
