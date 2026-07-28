"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  error?: string;
}

async function loadDirectories(directory?: string): Promise<BrowseResponse> {
  const query = directory ? `?path=${encodeURIComponent(directory)}` : "";
  const response = await fetch(`/api/cwd/browse${query}`);
  const data = (await response.json()) as BrowseResponse;
  if (!response.ok || data.error)
    throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

function FolderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <path d="M1.5 3h4l1.5 2h7.5v7.5h-13z" />
    </svg>
  );
}

// ─── PickerMode state machine ───────────────────────────────────────
type PickerMode =
  | "browse"
  | "create-folder"
  | "clone-repo"
  | "cloning"
  | "search";

interface Props {
  onCancel: () => void;
  onSelect: (path: string) => void;
  busy?: boolean;
  error?: string | null;
}

export function DirectoryPicker({
  onCancel,
  onSelect,
  busy = false,
  error,
}: Props) {
  const { t } = useI18n();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [parentDirectory, setParentDirectory] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ─── PickerMode state ──────────────────────────────────────
  const [mode, setMode] = useState<PickerMode>("browse");
  const [createName, setCreateName] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneElapsed, setCloneElapsed] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionRunning, setActionRunning] = useState(false);
  const cloneTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Navigate ──────────────────────────────────────────────
  const navigateTo = useCallback(async (directory?: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await loadDirectories(directory);
      const nextPath = data.path ?? directory ?? "/";
      setCurrentPath(nextPath);
      setParentDirectory(data.parentPath ?? null);
      setPathInput(nextPath === "/" ? "/" : nextPath + "/");
      setDirectories(data.directories ?? []);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Create folder ─────────────────────────────────────────
  const doCreate = useCallback(async () => {
    const trimmed = createName.trim();
    if (!trimmed || actionRunning) return;
    if (trimmed.startsWith(".")) {
      setActionError(t("directoryPicker.folderNameNoDot"));
      return;
    }
    setActionRunning(true);
    setActionError(null);
    try {
      const res = await fetch("/api/cwd/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent: currentPath, name: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { path: string };
      setMode("browse");
      setCreateName("");
      setActionRunning(false);
      await navigateTo(data.path);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
      setActionRunning(false);
    }
  }, [createName, actionRunning, currentPath, navigateTo, t]);

  // ─── Clone repo ────────────────────────────────────────────
  const doClone = useCallback(async () => {
    const trimmed = cloneUrl.trim();
    if (!trimmed || mode !== "clone-repo") return;
    setMode("cloning");
    setActionError(null);
    setCloneElapsed(0);
    cloneTimer.current = setInterval(
      () => setCloneElapsed((prev) => prev + 1),
      1000,
    );
    try {
      const res = await fetch("/api/cwd/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent: currentPath, url: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { path: string };
      if (cloneTimer.current) {
        clearInterval(cloneTimer.current);
        cloneTimer.current = null;
      }
      setMode("browse");
      setCloneUrl("");
      await navigateTo(data.path);
    } catch (cause) {
      if (cloneTimer.current) {
        clearInterval(cloneTimer.current);
        cloneTimer.current = null;
      }
      setMode("clone-repo");
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [cloneUrl, mode, currentPath, navigateTo]);

  // Clean up clone timer on unmount
  useEffect(() => {
    return () => {
      if (cloneTimer.current) clearInterval(cloneTimer.current);
    };
  }, []);

  // ─── Init ──────────────────────────────────────────────────
  useEffect(() => {
    setPortalTarget(document.body);
    void navigateTo();
  }, [navigateTo]);

  // ─── Cancel any action mode ────────────────────────────────
  const cancelAction = useCallback(() => {
    setMode("browse");
    setCreateName("");
    setCloneUrl("");
    setActionError(null);
    setActionRunning(false);
  }, []);

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMode("browse");
    const candidate = pathInput.trim();
    if (candidate) void navigateTo(candidate);
  };

  const hasUncommittedPath =
    pathInput.trim().replace(/\/$/, "") !== currentPath;
  const canSelect = Boolean(currentPath) && !hasUncommittedPath && !busy;
  const isCloning = mode === "cloning";
  const inAction =
    mode === "create-folder" || mode === "clone-repo" || mode === "cloning";
  const showCreateInput = mode === "create-folder";
  const showCloneInput = mode === "clone-repo";

  // ─── Fuzzy search ──────────────────────────────────────────
  const filteredDirs = useMemo(() => {
    if (mode !== "search") return directories;
    const raw = pathInput.trim();
    if (!raw) return directories;
    // Extract only the search suffix, not the full path
    const query = raw.startsWith(currentPath)
      ? raw
          .slice(currentPath.length)
          .replace(/^[\/\\]+/, "")
          .toLowerCase()
      : (raw.split("/").pop()?.toLowerCase() ?? raw.toLowerCase());
    if (!query) return directories;
    const scored = directories
      .map((entry) => {
        const name = entry.name.toLowerCase();
        let s = 0;
        if (name === query) s = 3;
        else if (name.startsWith(query)) s = 2;
        else if (name.includes(query)) s = 1;
        return { entry, score: s };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((item) => item.entry);
    return scored;
  }, [mode, pathInput, currentPath, directories]);

  const showDropDown =
    mode === "search" && filteredDirs.length > 0 && pathInput.trim().length > 0;

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
        if (event.key === "Escape") {
          if (isCloning) return;
          if (inAction) {
            cancelAction();
            return;
          }
          if (!busy) onCancel();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.35)",
      }}
    >
      <div
        className="directory-picker-panel"
        style={{
          width: 520,
          maxWidth: "calc(100vw - 16px)",
          height: "min(620px, calc(100dvh - 16px))",
          maxHeight: "calc(100dvh - 16px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{ color: "var(--text)", fontWeight: 700, fontSize: 15 }}
            >
              {t("directoryPicker.selectDirectory")}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy || isCloning}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
            style={{
              padding: "2px 6px",
              border: 0,
              background: "none",
              color: "var(--text-muted)",
              fontSize: 20,
              lineHeight: 1,
              cursor: busy || isCloning ? "default" : "pointer",
              opacity: busy || isCloning ? 0.5 : 1,
            }}
          >
            ×
          </button>
        </div>

        {/* ── Path input ── */}
        <form
          onSubmit={handlePathSubmit}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <button
            className="directory-picker-back"
            type="button"
            onClick={() => parentDirectory && void navigateTo(parentDirectory)}
            disabled={loading || !parentDirectory || isCloning}
            title={t("directoryPicker.goToParent")}
            aria-label={t("directoryPicker.goToParent")}
            style={{
              width: 36,
              height: 36,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg-hover)",
              color: "var(--text-muted)",
              cursor: parentDirectory && !isCloning ? "pointer" : "default",
              opacity: parentDirectory && !isCloning ? 1 : 0.45,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
          <label
            htmlFor="directory-path"
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: "hidden",
              clip: "rect(0, 0, 0, 0)",
              whiteSpace: "nowrap",
              border: 0,
            }}
          >
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
              const v = event.target.value;
              setPathInput(v);
              setLoadError(null);
              if (v.trim() && v.trim() !== currentPath) {
                setMode("search");
              } else if (!v.trim() || v.trim() === currentPath) {
                setMode("browse");
              }
            }}
            style={{
              minWidth: 0,
              flex: 1,
              height: 36,
              padding: "0 10px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              outline: "none",
              background: "var(--bg-panel)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          />
          <button
            className="directory-picker-action"
            type="submit"
            disabled={loading || !pathInput.trim() || isCloning}
            title={t("directoryPicker.goToDirectory")}
            style={{
              minWidth: 58,
              height: 36,
              padding: "0 12px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg-hover)",
              color: "var(--text-muted)",
              cursor:
                loading || !pathInput.trim() || isCloning
                  ? "default"
                  : "pointer",
              opacity: loading || !pathInput.trim() || isCloning ? 0.6 : 1,
            }}
          >
            {t("directoryPicker.go")}
          </button>
        </form>

        {/* ── Directory list / search results ── */}
        <div
          className="directory-picker-list"
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "8px 10px",
          }}
        >
          {loading ? (
            <div style={{ padding: 8, color: "var(--text-dim)", fontSize: 11 }}>
              {t("directoryPicker.loadingDirectories")}
            </div>
          ) : showCreateInput ? null : showCloneInput ? null : directories.length >
            0 ? (
            showDropDown ? (
              <>
                <div
                  style={{
                    padding: "4px 8px",
                    color: "var(--text-dim)",
                    fontSize: 10,
                  }}
                >
                  {t("directoryPicker.matchingFolders")}
                </div>
                {filteredDirs.map((entry) => (
                  <button
                    key={entry.path}
                    className="directory-picker-entry"
                    type="button"
                    onClick={() => {
                      setMode("browse");
                      void navigateTo(entry.path);
                    }}
                    title={entry.path}
                    style={{
                      width: "100%",
                      minHeight: 30,
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "5px 8px",
                      border: 0,
                      borderRadius: 5,
                      background: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                    }}
                  >
                    <FolderIcon />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.name}
                    </span>
                  </button>
                ))}
              </>
            ) : (
              directories.map((entry) => (
                <button
                  key={entry.path}
                  className="directory-picker-entry"
                  type="button"
                  onClick={() => void navigateTo(entry.path)}
                  title={entry.path}
                  style={{
                    width: "100%",
                    minHeight: 30,
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "5px 8px",
                    border: 0,
                    borderRadius: 5,
                    background: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                  }}
                >
                  <FolderIcon />
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.name}
                  </span>
                </button>
              ))
            )
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                flex: 1,
                gap: 8,
                padding: 20,
              }}
            >
              <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
                {t("directoryPicker.noFoldersYet")}
              </div>
              <button
                type="button"
                onClick={() => {
                  setMode("create-folder");
                  setActionError(null);
                }}
                style={{
                  padding: "6px 16px",
                  border: "1px dashed var(--border)",
                  borderRadius: 6,
                  background: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {t("directoryPicker.createFolder")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("clone-repo");
                  setActionError(null);
                }}
                style={{
                  padding: "6px 16px",
                  border: "1px dashed var(--border)",
                  borderRadius: 6,
                  background: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {t("directoryPicker.cloneRepo")}
              </button>
            </div>
          )}
          {(loadError || error) && !showCreateInput && !showCloneInput && (
            <div style={{ padding: "8px", color: "#dc2626", fontSize: 11 }}>
              {loadError ?? error}
            </div>
          )}
        </div>

        {/* ── Create folder input ── */}
        {showCreateInput && (
          <>
            <div
              style={{
                display: "flex",
                gap: 6,
                padding: "6px 10px",
                alignItems: "center",
                borderTop: "1px solid var(--border)",
              }}
            >
              <FolderIcon />
              <input
                autoFocus
                value={createName}
                onChange={(e) => {
                  setCreateName(e.target.value);
                  setActionError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    doCreate();
                  }
                  if (e.key === "Escape") {
                    cancelAction();
                  }
                }}
                placeholder={t("directoryPicker.createFolderPlaceholder")}
                disabled={actionRunning}
                style={{
                  minWidth: 0,
                  flex: 1,
                  height: 30,
                  padding: "0 8px",
                  border: `1px solid ${actionError ? "#dc2626" : "var(--border)"}`,
                  borderRadius: 5,
                  outline: "none",
                  background: "var(--bg-panel)",
                  color: "var(--text)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                }}
              />
              <button
                onClick={doCreate}
                disabled={actionRunning || !createName.trim()}
                style={{
                  width: 26,
                  height: 26,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  background: "none",
                  color: "var(--accent)",
                  cursor:
                    actionRunning || !createName.trim() ? "default" : "pointer",
                  opacity: actionRunning || !createName.trim() ? 0.4 : 1,
                  fontSize: 14,
                }}
              >
                ✓
              </button>
              <button
                onClick={cancelAction}
                disabled={actionRunning}
                style={{
                  width: 26,
                  height: 26,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  background: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                ✕
              </button>
            </div>
            {actionError && (
              <div
                style={{
                  padding: "2px 10px 4px",
                  color: "#dc2626",
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {actionError}
              </div>
            )}
          </>
        )}

        {/* ── Clone repo input ── */}
        {showCloneInput && (
          <>
            <div
              style={{
                display: "flex",
                gap: 6,
                padding: "6px 10px",
                alignItems: "center",
                borderTop: "1px solid var(--border)",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                aria-hidden="true"
              >
                <circle cx="5" cy="5" r="3" />
                <path d="M11 11l3 3M8 5v6M5 8h6" />
              </svg>
              <input
                autoFocus
                value={cloneUrl}
                onChange={(e) => {
                  setCloneUrl(e.target.value);
                  setActionError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    doClone();
                  }
                  if (e.key === "Escape") {
                    cancelAction();
                  }
                }}
                placeholder={t("directoryPicker.cloneRepoPlaceholder")}
                disabled={false}
                style={{
                  minWidth: 0,
                  flex: 1,
                  height: 30,
                  padding: "0 8px",
                  border: `1px solid ${actionError ? "#dc2626" : "var(--border)"}`,
                  borderRadius: 5,
                  outline: "none",
                  background: "var(--bg-panel)",
                  color: "var(--text)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                }}
              />
              <button
                onClick={doClone}
                disabled={!cloneUrl.trim()}
                style={{
                  minWidth: 46,
                  height: 26,
                  padding: "0 8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  background: "none",
                  color: "var(--accent)",
                  cursor: cloneUrl.trim() ? "pointer" : "default",
                  opacity: cloneUrl.trim() ? 1 : 0.4,
                  fontSize: 12,
                }}
              >
                {t("directoryPicker.cloneButton")}
              </button>
              <button
                onClick={cancelAction}
                style={{
                  width: 26,
                  height: 26,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  background: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                ✕
              </button>
            </div>
            {actionError && (
              <div
                style={{
                  padding: "2px 10px 4px",
                  color: "#dc2626",
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {actionError}
              </div>
            )}
          </>
        )}

        {/* ── Cloning progress ── */}
        {isCloning && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              borderTop: "1px solid var(--border)",
              color: "var(--text-muted)",
              fontSize: 12,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 14,
                height: 14,
                border: "2px solid var(--border)",
                borderTopColor: "var(--accent)",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <span>
              {t("directoryPicker.cloning", { elapsed: `${cloneElapsed}s` })}
            </span>
            <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
          </div>
        )}

        {/* ── Footer ── */}
        <div
          className="directory-picker-footer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <div
            style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}
          >
            <button
              type="button"
              onClick={() => {
                setMode("create-folder");
                setCreateName("");
                setActionError(null);
              }}
              disabled={busy || inAction}
              title={t("directoryPicker.createNewFolder")}
              style={{
                padding: "6px 12px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "none",
                color: "var(--text-muted)",
                cursor: busy || inAction ? "default" : "pointer",
                opacity: busy || inAction ? 0.5 : 1,
                fontSize: 13,
              }}
            >
              {t("directoryPicker.newFolder")}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("clone-repo");
                setCloneUrl("");
                setActionError(null);
              }}
              disabled={busy || inAction}
              title={t("directoryPicker.cloneGitRepo")}
              style={{
                padding: "6px 12px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "none",
                color: "var(--text-muted)",
                cursor: busy || inAction ? "default" : "pointer",
                opacity: busy || inAction ? 0.5 : 1,
                fontSize: 13,
              }}
            >
              {t("directoryPicker.cloneRepo")}
            </button>
          </div>
          <button
            className="directory-picker-action"
            type="button"
            onClick={onCancel}
            disabled={busy || isCloning}
            style={{
              padding: "6px 14px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "none",
              color: "var(--text-muted)",
              cursor: busy || isCloning ? "default" : "pointer",
              fontSize: 13,
            }}
          >
            {t("i18n.cancel")}
          </button>
          <button
            className="directory-picker-action"
            type="button"
            onClick={() => onSelect(currentPath)}
            disabled={!canSelect || isCloning}
            title={
              hasUncommittedPath
                ? t("directoryPicker.openBeforeSelecting")
                : t("directoryPicker.selectCurrentDirectory")
            }
            style={{
              padding: "6px 16px",
              border: 0,
              borderRadius: 6,
              background: "var(--accent)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              opacity: canSelect && !isCloning ? 1 : 0.6,
              cursor: canSelect && !isCloning ? "pointer" : "default",
            }}
          >
            {busy ? t("i18n.checking") : t("directoryPicker.selectThisFolder")}
          </button>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
