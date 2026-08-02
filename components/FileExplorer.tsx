"use client";

import { forwardRef, Fragment, useState, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { getFileIcon, FolderIcon } from "./FileIcons";
import { InlineFileNameInput } from "./InlineFileNameInput";
import { FileContextMenu, type ContextMenuItem } from "./FileContextMenu";
import {
  encodeFilePathForApi,
  getFileDirectory,
  getFileName,
  getRelativeFilePath,
  joinFilePath,
  normalizeFilePathSlashes,
} from "@/lib/file-paths";
import type { GitFileStatus, GitFileStatusKind, GitStatusResponse } from "@/lib/git-types";
import { useI18n } from "@/hooks/useI18n";
type Translate = ReturnType<typeof useI18n>["t"];

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
}

interface FileNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean;
}

interface Props {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string, options?: OpenFileOptions) => void;
  refreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  onUploadBusyChange?: (busy: boolean) => void;
  changesCollapsed: boolean;
  onChangesCountChange?: (count: number) => void;
}

export interface FileExplorerHandle {
  openUploadPicker: () => void;
}

type UploadPhase = "idle" | "checking" | "uploading";
type UploadConflictStrategy = "error" | "overwrite" | "skip";

interface UploadError {
  name: string;
  error: string;
}

interface UploadResponse {
  uploaded?: string[];
  skipped?: string[];
  errors?: UploadError[];
  conflicts?: string[];
  nonReplaceable?: string[];
  error?: string;
}

interface UploadSummary {
  uploaded: string[];
  skipped: string[];
  errors: UploadError[];
}

interface PendingConflict {
  files: File[];
  conflicts: string[];
  nonReplaceable: string[];
}

async function fetchEntries(dirPath: string): Promise<FileNode[]> {
  const encoded = encodeFilePathForApi(dirPath);
  const res = await fetch(`/api/files/${encoded}?type=list`);
  if (!res.ok) {
    let message = `Failed to load files (HTTP ${res.status})`;
    try {
      const data = await res.json() as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(message);
  }
  const data = await res.json() as { entries?: FileEntry[] };
  return (data.entries ?? []).map((e) => ({
    name: e.name,
    fullPath: joinFilePath(dirPath, e.name),
    isDir: e.isDir,
    size: e.size,
    children: e.isDir ? [] : undefined,
    loaded: !e.isDir,
  }));
}

async function fetchGitStatus(cwd: string): Promise<GitStatusResponse> {
  const params = new URLSearchParams({ cwd });
  const res = await fetch(`/api/git/status?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to load Git status (HTTP ${res.status})`);
  return res.json() as Promise<GitStatusResponse>;
}

interface FileOpErrorResponse {
  error?: string;
  exists?: boolean;
}

/** Rename or move a file/folder to a new absolute path. Rejects overwrite. */
async function renameOrMovePath(from: string, to: string): Promise<void> {
  const res = await fetch(`/api/files/${encodeFilePathForApi(from)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as FileOpErrorResponse;
    const error = new Error(data.error ?? `HTTP ${res.status}`);
    (error as Error & { exists?: boolean }).exists = data.exists;
    throw error;
  }
}

/** Move a file/folder to the system trash. */
async function deletePath(targetPath: string): Promise<void> {
  const res = await fetch(`/api/files/${encodeFilePathForApi(targetPath)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as FileOpErrorResponse;
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
}

/** Create an empty file or folder inside a directory. */
async function createPath(parentDir: string, name: string, isDir: boolean): Promise<void> {
  const res = await fetch(`/api/files/${encodeFilePathForApi(parentDir)}?type=create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, isDir }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as FileOpErrorResponse;
    const error = new Error(data.error ?? `HTTP ${res.status}`);
    (error as Error & { exists?: boolean }).exists = data.exists;
    throw error;
  }
}

/** True when {@link name} is a non-empty single path component. */
function isValidFileName(name: string): boolean {
  return Boolean(name) && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\") && !name.includes("\0");
}

const GIT_STATUS_KEYS: Record<GitFileStatusKind, string> = {
  modified: "files.modified",
  added: "files.added",
  deleted: "files.deleted",
  renamed: "files.renamed",
  untracked: "files.untracked",
  conflict: "files.conflict",
};

const GIT_STATUS_COLORS: Record<GitFileStatusKind, string> = {
  modified: "#d6a84b",
  added: "#4ade80",
  deleted: "#f87171",
  renamed: "#60a5fa",
  untracked: "#4ade80",
  conflict: "#f87171",
};

function GitStatusBadge({ status, t }: { status: GitFileStatus; t: Translate }) {
  return (
    <span
      title={t(GIT_STATUS_KEYS[status.status])}
      aria-label={t(GIT_STATUS_KEYS[status.status])}
      style={{
        width: 14,
        height: 14,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: GIT_STATUS_COLORS[status.status],
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {status.code}
    </span>
  );
}

function uploadFiles(
  targetDirectory: string,
  files: File[],
  strategy: UploadConflictStrategy,
  onProgress: (progress: number) => void,
): Promise<{ status: number; data: UploadResponse }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file, file.name));

    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `/api/files/${encodeFilePathForApi(targetDirectory)}?type=upload&conflict=${strategy}`,
    );
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading files"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.onload = () => {
      let data: UploadResponse = {};
      try {
        data = JSON.parse(xhr.responseText) as UploadResponse;
      } catch {
        if (xhr.responseText) data.error = xhr.responseText;
      }
      resolve({ status: xhr.status, data });
    };
    xhr.send(formData);
  });
}

function MentionIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  );
}

function DismissButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{ width: 24, height: 24, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "none", borderRadius: 4, background: "none", color: "var(--text-dim)", cursor: "pointer" }}
      onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text-muted)"; event.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-dim)"; event.currentTarget.style.background = "none"; }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="m6 6 12 12" />
        <path d="m18 6-12 12" />
      </svg>
    </button>
  );
}

interface EditingState {
  kind: "rename" | "newfile" | "newdir";
  parentPath: string;
  /** Set for rename: the entry being renamed. */
  fullPath?: string;
}

/** A phantom top-of-list row that creates a new file or folder on commit. */
function CreatingRow({
  depth,
  isDir,
  onCommit,
  onCancel,
}: {
  depth: number;
  isDir: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        paddingLeft: 8 + depth * 14,
        paddingRight: 8,
        height: 24,
      }}
    >
      {isDir ? (
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          stroke="var(--text-dim)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <polyline points="3 2 7 5 3 8" />
        </svg>
      ) : (
        <span style={{ width: 10, flexShrink: 0 }} />
      )}
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
        {isDir ? <FolderIcon size={14} open={false} /> : getFileIcon("new.txt", 14)}
      </span>
      <InlineFileNameInput
        initialValue=""
        selectNameWithoutExtension={false}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>
  );
}

function DeleteConfirmDialog({
  name,
  isDir,
  busy,
  error,
  onCancel,
  onConfirm,
  t,
}: {
  name: string;
  isDir: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  t: Translate;
}) {
  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.4)",
      }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-delete-title"
        style={{
          width: 400,
          maxWidth: "100%",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg-panel)",
          boxShadow: "0 12px 36px rgba(0,0,0,0.24)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", gap: 12, padding: "18px 18px 14px" }}>
          <svg
            width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{ flexShrink: 0, marginTop: 1 }}
          >
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          <div style={{ minWidth: 0 }}>
            <div id="file-delete-title" style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {t("files.moveToTrash")}
            </div>
            <div style={{ marginTop: 7, fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)" }}>
              {isDir
                ? t("files.deleteFolderWarning", { name })
                : t("files.deleteFileWarning", { name })}
            </div>
            {error && (
              <div role="alert" style={{ marginTop: 10, color: "#f87171", fontSize: 12, lineHeight: 1.5, overflowWrap: "anywhere" }}>
                {error}
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              height: 32,
              padding: "0 12px",
              border: "1px solid var(--border)",
              borderRadius: 5,
              background: "transparent",
              color: "var(--text-muted)",
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: 12,
            }}
          >
            {t("files.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            style={{
              height: 32,
              padding: "0 12px",
              border: "1px solid #ef4444",
              borderRadius: 5,
              background: "transparent",
              color: "#ef4444",
              cursor: busy ? "wait" : "pointer",
              opacity: busy ? 0.7 : 1,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {busy ? t("files.deleting") : t("files.moveToTrash")}
          </button>
        </div>
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  cwd,
  onOpenFile,
  onAtMention,
  expandedPaths,
  onToggleExpanded,
  refreshToken,
  highlightedPaths,
  gitStatusByPath,
  changedDirectoryPaths,
  t,
  onContextMenu,
  editing,
  onRenameCommit,
  onCreateCommit,
  onCancelEdit,
  onDragStartNode,
  onDropOnNode,
  getDraggedPath,
}: {
  node: FileNode;
  depth: number;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string, options?: OpenFileOptions) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (fullPath: string, open: boolean) => void;
  refreshToken: string;
  highlightedPaths: Set<string>;
  gitStatusByPath: Map<string, GitFileStatus>;
  changedDirectoryPaths: Set<string>;
  t: Translate;
  onContextMenu: (node: FileNode, event: React.MouseEvent) => void;
  editing: EditingState | null;
  onRenameCommit: (node: FileNode, name: string) => void;
  onCreateCommit: (parentPath: string, name: string, isDir: boolean) => void;
  onCancelEdit: () => void;
  onDragStartNode: (node: FileNode, event: React.DragEvent) => void;
  onDropOnNode: (node: FileNode, event: React.DragEvent) => void;
  getDraggedPath: () => string | null;
}) {
  const open = expandedPaths.has(node.fullPath);
  const highlighted = highlightedPaths.has(node.fullPath);
  const normalizedPath = normalizeFilePathSlashes(node.fullPath);
  const gitStatus = gitStatusByPath.get(normalizedPath);
  const containsGitChanges = node.isDir && (
    gitStatus !== undefined || changedDirectoryPaths.has(normalizedPath)
  );
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);

  const isRenaming = editing?.kind === "rename" && editing.fullPath === node.fullPath;
  const creatingHere =
    editing && (editing.kind === "newfile" || editing.kind === "newdir") && editing.parentPath === node.fullPath
      ? editing
      : null;

  // Only folders accept drops, and never onto the dragged item itself or one
  // of its descendants (would move a folder into itself).
  const canAcceptDrop = useCallback(() => {
    if (!node.isDir) return false;
    const source = getDraggedPath();
    if (!source) return false;
    const src = normalizeFilePathSlashes(source).replace(/\/$/, "");
    if (normalizedPath === src || normalizedPath.startsWith(`${src}/`)) return false;
    return true;
  }, [node.isDir, normalizedPath, getDraggedPath]);

  const loadChildren = useCallback(async (force = false) => {
    if (loaded && !force) return;
    setLoading(true);
    try {
      const entries = await fetchEntries(node.fullPath);
      setChildren(entries);
      setLoaded(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [loaded, node.fullPath]);

  // Re-fetch children when the tree refreshes and the directory is open.
  useEffect(() => {
    if (open && loaded) {
      loadChildren(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const handleClick = useCallback(() => {
    if (node.isDir) {
      const next = !open;
      onToggleExpanded(node.fullPath, next);
      if (next && !loaded) loadChildren();
    } else {
      onOpenFile(node.fullPath, node.name);
    }
  }, [node.isDir, node.fullPath, node.name, loaded, open, loadChildren, onOpenFile, onToggleExpanded]);

  return (
    <div>
      <div
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(node, event);
        }}
        draggable={!isRenaming}
        onDragStart={(event) => onDragStartNode(node, event)}
        onDragOver={(event) => {
          if (!canAcceptDrop()) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropTarget(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDropTarget(false);
          }
        }}
        onDrop={(event) => {
          if (!canAcceptDrop()) return;
          event.preventDefault();
          event.stopPropagation();
          setDropTarget(false);
          onDropOnNode(node, event);
        }}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          height: 24,
          cursor: isRenaming ? "default" : "pointer",
          background: dropTarget
            ? "var(--bg-selected)"
            : hovered ? "var(--bg-hover)" : "transparent",
          borderRadius: 4,
          userSelect: "none",
          outline: dropTarget ? "1px solid var(--accent)" : "none",
        }}
      >
        {node.isDir && (
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            stroke="var(--text-dim)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.1s" }}
          >
            <polyline points="3 2 7 5 3 8" />
          </svg>
        )}
        {!node.isDir && <span style={{ width: 10, flexShrink: 0 }} />}
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
          {node.isDir ? <FolderIcon size={14} open={open} /> : getFileIcon(node.name, 14)}
        </span>
        {isRenaming ? (
          <InlineFileNameInput
            initialValue={node.name}
            selectNameWithoutExtension
            onCommit={(name) => onRenameCommit(node, name)}
            onCancel={onCancelEdit}
          />
        ) : (
          <span
            style={{
              fontSize: 12,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
            title={node.fullPath}
          >
            {node.name}
          </span>
        )}
        {highlighted && (
          <span
            title={t("files.newlyUploaded")}
            aria-label={t("files.newlyUploaded")}
            style={{ width: 14, height: 14, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3b82f6" }} />
          </span>
        )}
        {!hovered && !node.isDir && gitStatus && (
          <GitStatusBadge status={gitStatus} t={t} />
        )}
        {!hovered && containsGitChanges && (
          <span
            title={t("files.containsChangedFiles")}
            aria-label={t("files.containsChangedFiles")}
            style={{
              width: 14,
              height: 14,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#d6a84b" }} />
          </span>
        )}
        {loading && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
          </svg>
        )}
        {onAtMention && hovered && !isRenaming && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAtMention(getRelativeFilePath(node.fullPath, cwd), node.isDir);
            }}
            title={t("files.insertPath")}
            style={{
              position: "absolute",
              right: !node.isDir ? 28 : 4,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "0 8px",
              height: 20,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            <MentionIcon />
            {t("files.mention")}
          </button>
        )}
        {hovered && !node.isDir && !isRenaming && (
          <a
            href={`/api/files/${encodeFilePathForApi(node.fullPath)}?type=download`}
            download
            onClick={(e) => e.stopPropagation()}
            title={t("files.download")}
            style={{
              position: "absolute",
              right: 4,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "0 5px",
              height: 20,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
              textDecoration: "none",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </a>
        )}
      </div>
      {node.isDir && open && (
        <div>
          {creatingHere && (
            <CreatingRow
              depth={depth + 1}
              isDir={creatingHere.kind === "newdir"}
              onCommit={(name) => onCreateCommit(node.fullPath, name, creatingHere.kind === "newdir")}
              onCancel={onCancelEdit}
            />
          )}
          {children.map((child) => (
            <TreeNode
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              cwd={cwd}
              onOpenFile={onOpenFile}
              onAtMention={onAtMention}
              expandedPaths={expandedPaths}
              onToggleExpanded={onToggleExpanded}
              refreshToken={refreshToken}
              highlightedPaths={highlightedPaths}
              gitStatusByPath={gitStatusByPath}
              changedDirectoryPaths={changedDirectoryPaths}
              t={t}
              onContextMenu={onContextMenu}
              editing={editing}
              onRenameCommit={onRenameCommit}
              onCreateCommit={onCreateCommit}
              onCancelEdit={onCancelEdit}
              onDragStartNode={onDragStartNode}
              onDropOnNode={onDropOnNode}
              getDraggedPath={getDraggedPath}
            />
          ))}
          {children.length === 0 && loaded && !creatingHere && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14, fontSize: 11, color: "var(--text-dim)", height: 22, display: "flex", alignItems: "center" }}>
              empty
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type OpenFileOptions = { sourceSessionId?: string | null; modeHint?: "diff" };

type OpenFileHandler = (filePath: string, fileName: string, options?: OpenFileOptions) => void;

function ChangeRow({
  status,
  cwd,
  onOpenFile,
  t,
}: {
  status: GitFileStatus;
  cwd: string;
  onOpenFile: OpenFileHandler;
  t: Translate;
}) {
  const [hovered, setHovered] = useState(false);
  const name = getFileName(status.filePath);
  const rel = getRelativeFilePath(status.filePath, cwd);
  return (
    <div
      onClick={() => onOpenFile(status.filePath, name, { modeHint: "diff" })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={status.filePath}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        paddingLeft: 10,
        paddingRight: 8,
        height: 24,
        cursor: "pointer",
        background: hovered ? "var(--bg-hover)" : "transparent",
        borderRadius: 4,
        userSelect: "none",
      }}
    >
      <GitStatusBadge status={status} t={t} />
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", opacity: 0.85 }}>
        {getFileIcon(name, 13)}
      </span>
      <span
        style={{
          fontSize: 12,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {rel}
      </span>
    </div>
  );
}

export const FileExplorer = forwardRef<FileExplorerHandle, Props>(function FileExplorer({
  cwd,
  onOpenFile,
  refreshKey,
  onAtMention,
  onAtMentions,
  onUploadBusyChange,
  changesCollapsed,
  onChangesCountChange,
}, ref) {
  const { t } = useI18n();
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [highlightedPaths, setHighlightedPaths] = useState<Set<string>>(new Set());
  const [gitFiles, setGitFiles] = useState<GitFileStatus[]>([]);
  const [gitLineStats, setGitLineStats] = useState({ additions: 0, deletions: 0 });
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);
  const prevCwdRef = useRef<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const refreshToken = `${refreshKey ?? 0}:${treeRefreshKey}`;
  const uploadBusy = uploadPhase !== "idle";

  // Right-click context menu, inline rename/new-file editing, delete dialog,
  // and transient file-operation feedback.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode | null } | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [deleting, setDeleting] = useState<{ node: FileNode; busy: boolean; error: string | null } | null>(null);
  const [fileOpError, setFileOpError] = useState<string | null>(null);
  const [fileOpNotice, setFileOpNotice] = useState<string | null>(null);
  // The path being dragged. dataTransfer is unreadable during dragover, so the
  // source path is carried in a ref instead (same-page DnD only).
  const draggedPathRef = useRef<string | null>(null);

  const gitStatusByPath = useMemo(() => new Map(
    gitFiles.map((status) => [normalizeFilePathSlashes(status.filePath), status]),
  ), [gitFiles]);

  const changedDirectoryPaths = useMemo(() => {
    const directories = new Set<string>();
    const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
    for (const status of gitFiles) {
      let directory = getFileDirectory(normalizeFilePathSlashes(status.filePath));
      while (directory === normalizedCwd || directory.startsWith(`${normalizedCwd}/`)) {
        directories.add(directory);
        if (directory === normalizedCwd) break;
        const parent = getFileDirectory(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
    return directories;
  }, [cwd, gitFiles]);

  const handleToggleExpanded = useCallback((fullPath: string, open: boolean) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(fullPath); else next.delete(fullPath);
      return next;
    });
  }, []);

  const bumpRefresh = useCallback(() => setTreeRefreshKey((key) => key + 1), []);

  // After a folder is renamed/moved, repoint any expanded entries that lived
  // under its old path so the subtree stays open under the new path.
  const remapExpandedPaths = useCallback((oldPrefix: string, newPrefix: string) => {
    setExpandedPaths((prev) => {
      const next = new Set<string>();
      for (const p of prev) {
        if (p === oldPrefix) next.add(newPrefix);
        else if (p.startsWith(`${oldPrefix}/`)) next.add(newPrefix + p.slice(oldPrefix.length));
        else next.add(p);
      }
      return next;
    });
  }, []);

  const removeExpandedUnder = useCallback((deletedPrefix: string) => {
    setExpandedPaths((prev) => {
      const next = new Set<string>();
      for (const p of prev) {
        if (p === deletedPrefix || p.startsWith(`${deletedPrefix}/`)) continue;
        next.add(p);
      }
      return next;
    });
  }, []);

  const cancelEditing = useCallback(() => setEditing(null), []);

  const startRename = useCallback((node: FileNode) => {
    setEditing({ kind: "rename", parentPath: getFileDirectory(node.fullPath), fullPath: node.fullPath });
  }, []);

  const startCreate = useCallback((parentPath: string, isDir: boolean) => {
    // Expand the target folder so the new-item row is visible inside it.
    if (parentPath !== cwd) handleToggleExpanded(parentPath, true);
    setEditing({ kind: isDir ? "newdir" : "newfile", parentPath });
  }, [cwd, handleToggleExpanded]);

  const startDelete = useCallback((node: FileNode) => {
    setDeleting({ node, busy: false, error: null });
  }, []);

  const reportError = useCallback((err: unknown, existsKey: string, fallbackKey: string) => {
    const e = err as Error & { exists?: boolean };
    setFileOpError(e.exists ? t(existsKey) : (e.message || t(fallbackKey)));
  }, [t]);

  const commitRename = useCallback(async (node: FileNode, name: string) => {
    setEditing(null);
    const trimmed = name.trim();
    if (!trimmed || trimmed === node.name) return;
    if (!isValidFileName(trimmed)) {
      setFileOpError(t("files.invalidName"));
      return;
    }
    const newPath = joinFilePath(getFileDirectory(node.fullPath), trimmed);
    try {
      await renameOrMovePath(node.fullPath, newPath);
      if (node.isDir) remapExpandedPaths(node.fullPath, newPath);
      bumpRefresh();
    } catch (err) {
      reportError(err, "files.nameExists", "files.renameError");
    }
  }, [t, remapExpandedPaths, bumpRefresh, reportError]);

  const commitCreate = useCallback(async (parentPath: string, name: string, isDir: boolean) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setEditing(null);
      return;
    }
    if (!isValidFileName(trimmed)) {
      setFileOpError(t("files.invalidName"));
      setEditing(null);
      return;
    }
    try {
      await createPath(parentPath, trimmed, isDir);
      setEditing(null);
      setHighlightedPaths(new Set([joinFilePath(parentPath, trimmed)]));
      bumpRefresh();
    } catch (err) {
      reportError(err, "files.nameExists", "files.createError");
      setEditing(null);
    }
  }, [t, bumpRefresh, reportError]);

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    const target = deleting.node;
    setDeleting((prev) => prev ? { ...prev, busy: true, error: null } : prev);
    try {
      await deletePath(target.fullPath);
      removeExpandedUnder(target.fullPath);
      setDeleting(null);
      bumpRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDeleting((prev) => prev ? { ...prev, busy: false, error: message } : prev);
    }
  }, [deleting, removeExpandedUnder, bumpRefresh]);

  const cancelDelete = useCallback(() => {
    if (deleting?.busy) return;
    setDeleting(null);
  }, [deleting]);

  const copyPath = useCallback(async (node: FileNode) => {
    const rel = getRelativeFilePath(node.fullPath, cwd);
    try {
      await navigator.clipboard.writeText(rel);
      setFileOpNotice(t("files.pathCopied"));
    } catch {
      setFileOpError(t("files.copyFailed"));
    }
  }, [cwd, t]);

  const handleDragStartNode = useCallback((node: FileNode, event: React.DragEvent) => {
    draggedPathRef.current = node.fullPath;
    event.dataTransfer.setData("application/x-pi-file-path", node.fullPath);
    event.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDropOnNode = useCallback(async (folder: FileNode) => {
    const source = draggedPathRef.current;
    draggedPathRef.current = null;
    if (!source) return;
    const newPath = joinFilePath(folder.fullPath, getFileName(source));
    if (newPath === source) return; // dropped into its current folder
    try {
      await renameOrMovePath(source, newPath);
      remapExpandedPaths(source, newPath);
      bumpRefresh();
    } catch (err) {
      reportError(err, "files.nameExists", "files.moveError");
    }
  }, [remapExpandedPaths, bumpRefresh, reportError]);

  const getDraggedPath = useCallback(() => draggedPathRef.current, []);

  const handleContextMenu = useCallback((node: FileNode, event: React.MouseEvent) => {
    setContextMenu({ x: event.clientX, y: event.clientY, node });
  }, []);

  const handleBlankContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, node: null });
  }, []);

  useEffect(() => {
    if (!fileOpNotice) return;
    const id = setTimeout(() => setFileOpNotice(null), 1500);
    return () => clearTimeout(id);
  }, [fileOpNotice]);

  const applyUploadResult = useCallback((data: UploadResponse) => {
    const uploaded = data.uploaded ?? [];
    const skipped = data.skipped ?? [];
    const errors = data.errors ?? [];
    setUploadSummary({ uploaded, skipped, errors });

    if (uploaded.length > 0) {
      setHighlightedPaths(new Set(uploaded.map((name) => joinFilePath(cwd, name))));
      setTreeRefreshKey((key) => key + 1);
    }
  }, [cwd]);

  const performUpload = useCallback(async (
    files: File[],
    strategy: UploadConflictStrategy,
  ) => {
    setPendingConflict(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploadPhase("uploading");

    try {
      const { status, data } = await uploadFiles(cwd, files, strategy, setUploadProgress);
      if (status === 409 && data.conflicts?.length) {
        setPendingConflict({
          files,
          conflicts: data.conflicts,
          nonReplaceable: data.nonReplaceable ?? [],
        });
        return;
      }
      if (status < 200 || status >= 300) {
        throw new Error(data.error ?? `Upload failed (HTTP ${status})`);
      }
      setUploadProgress(100);
      applyUploadResult(data);
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : String(uploadFailure));
    } finally {
      setUploadPhase("idle");
    }
  }, [applyUploadResult, cwd]);

  const prepareUpload = useCallback(async (files: File[]) => {
    if (files.length === 0 || uploadBusy) return;
    setUploadSummary(null);
    setHighlightedPaths(new Set());
    setPendingConflict(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploadPhase("checking");

    try {
      const res = await fetch(
        `/api/files/${encodeFilePathForApi(cwd)}?type=upload-check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileNames: files.map((file) => file.name) }),
        },
      );
      const data = await res.json().catch(() => ({})) as UploadResponse;
      if (!res.ok) throw new Error(data.error ?? `Upload check failed (HTTP ${res.status})`);

      if (data.conflicts?.length) {
        setPendingConflict({
          files,
          conflicts: data.conflicts,
          nonReplaceable: data.nonReplaceable ?? [],
        });
        return;
      }

      await performUpload(files, "error");
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : String(uploadFailure));
    } finally {
      setUploadPhase("idle");
    }
  }, [cwd, performUpload, uploadBusy]);

  const handleUploadInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void prepareUpload(files);
  }, [prepareUpload]);

  useImperativeHandle(ref, () => ({
    openUploadPicker() {
      if (!uploadBusy) uploadInputRef.current?.click();
    },
  }), [uploadBusy]);

  useEffect(() => {
    onUploadBusyChange?.(uploadBusy);
  }, [onUploadBusyChange, uploadBusy]);

  useEffect(() => () => onUploadBusyChange?.(false), [onUploadBusyChange]);

  useEffect(() => {
    const cwdChanged = prevCwdRef.current !== cwd;
    prevCwdRef.current = cwd;

    // Reset expanded state only when cwd changes, not on refreshKey bumps
    if (cwdChanged) {
      setExpandedPaths(new Set());
      setHighlightedPaths(new Set());
      setUploadSummary(null);
      setPendingConflict(null);
      setUploadError(null);
      setContextMenu(null);
      setEditing(null);
      setDeleting(null);
      setFileOpError(null);
      setFileOpNotice(null);
    }

    setLoading(cwdChanged);
    setError(null);
    let cancelled = false;
    fetchEntries(cwd)
      .then((entries) => { if (!cancelled) setRoots(entries); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, refreshKey, treeRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    fetchGitStatus(cwd)
      .then((status) => {
        if (!cancelled) {
          setGitFiles(status.isGitRepository ? status.files : []);
          setGitLineStats(status.isGitRepository
            ? { additions: status.additions, deletions: status.deletions }
            : { additions: 0, deletions: 0 });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGitFiles([]);
          setGitLineStats({ additions: 0, deletions: 0 });
        }
      });
    return () => { cancelled = true; };
  }, [cwd, refreshKey, treeRefreshKey]);

  useEffect(() => {
    onChangesCountChange?.(gitFiles.length);
  }, [gitFiles, onChangesCountChange]);

  const showUploadFeedback = uploadBusy || pendingConflict !== null || uploadError !== null || uploadSummary !== null;

  const addUploadedFilesToChat = useCallback(() => {
    if (!uploadSummary || uploadSummary.uploaded.length === 0) return;
    onAtMentions?.(
      uploadSummary.uploaded.map((name) => getRelativeFilePath(joinFilePath(cwd, name), cwd)),
    );
  }, [cwd, onAtMentions, uploadSummary]);

  const buildContextMenuItems = useCallback(
    (node: FileNode | null): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];
      if (node) {
        items.push({ key: "rename", label: t("files.rename"), onClick: () => startRename(node) });
        items.push({
          key: "delete",
          label: t("files.moveToTrash"),
          onClick: () => startDelete(node),
          danger: true,
          separatorAfter: true,
        });
        if (node.isDir) {
          items.push({ key: "newfile", label: t("files.newFile"), onClick: () => startCreate(node.fullPath, false) });
          items.push({ key: "newfolder", label: t("files.newFolder"), onClick: () => startCreate(node.fullPath, true), separatorAfter: true });
        }
        if (!node.isDir) {
          items.push({
            key: "download",
            label: t("files.download"),
            onClick: () => window.open(`/api/files/${encodeFilePathForApi(node.fullPath)}?type=download`, "_blank"),
          });
        }
        items.push({ key: "copyPath", label: t("files.copyPath"), onClick: () => void copyPath(node) });
      } else {
        items.push({ key: "newfile", label: t("files.newFile"), onClick: () => startCreate(cwd, false) });
        items.push({ key: "newfolder", label: t("files.newFolder"), onClick: () => startCreate(cwd, true) });
      }
      return items;
    },
    [t, startRename, startDelete, startCreate, copyPath, cwd],
  );

  // Root-level phantom row: only when creating at cwd (the root list itself).
  const rootCreating =
    editing && (editing.kind === "newfile" || editing.kind === "newdir") && editing.parentPath === cwd
      ? editing
      : null;

  return (
    <div style={{ minHeight: "100%" }}>
      <input ref={uploadInputRef} type="file" multiple hidden onChange={handleUploadInput} />
      {showUploadFeedback && (
        <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
        {uploadBusy && (
          <div role="status" aria-live="polite" aria-label={uploadPhase === "checking" ? t("files.checking") : t("files.uploading", { progress: uploadProgress })}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 14, color: "var(--text-muted)" }}>
              {uploadPhase === "checking" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ animation: "spin 0.8s linear infinite" }} aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-5.7-8.4" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 16V4" />
                  <path d="m7 9 5-5 5 5" />
                  <path d="M5 20h14" />
                </svg>
              )}
              {uploadPhase === "uploading" && <span style={{ fontSize: 10 }}>{uploadProgress}%</span>}
            </div>
            {uploadPhase === "uploading" && (
              <div style={{ height: 3, marginTop: 4, overflow: "hidden", borderRadius: 2, background: "var(--border)" }}>
                <div style={{ width: `${uploadProgress}%`, height: "100%", background: "var(--text-muted)", transition: "width 120ms ease" }} />
              </div>
            )}
          </div>
        )}

        {pendingConflict && (
          <div role="alert" style={{ padding: 7, border: "1px solid color-mix(in srgb, #f59e0b 55%, var(--border))", borderRadius: 4, background: "color-mix(in srgb, #f59e0b 9%, var(--bg-panel))" }}>
            <div style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.35, overflowWrap: "anywhere" }}>
              {t("files.conflictSummary", { count: pendingConflict.conflicts.length, countSuffix: pendingConflict.conflicts.length === 1 ? "" : "s", files: pendingConflict.conflicts.join(", ") })}
            </div>
            {pendingConflict.nonReplaceable.length > 0 && (
              <div style={{ marginTop: 3, fontSize: 10, color: "#f59e0b", lineHeight: 1.35, overflowWrap: "anywhere" }}>
                {t("files.cannotReplace", { files: pendingConflict.nonReplaceable.join(", ") })}
              </div>
            )}
            <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
              <button type="button" onClick={() => void performUpload(pendingConflict.files, "overwrite")} style={{ height: 22, padding: "0 7px", border: "1px solid #ef4444", borderRadius: 4, background: "transparent", color: "#ef4444", cursor: "pointer", fontSize: 10 }}>
                {t("files.replace")}
              </button>
              <button type="button" onClick={() => void performUpload(pendingConflict.files, "skip")} style={{ height: 22, padding: "0 7px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", fontSize: 10 }}>
                {t("files.skipExisting")}
              </button>
              <button type="button" onClick={() => setPendingConflict(null)} style={{ height: 22, padding: "0 7px", border: "none", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 10 }}>
                {t("files.cancel")}
              </button>
            </div>
          </div>
        )}

        {uploadError && (
          <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, lineHeight: 1.35, color: "#f87171" }}>
            <span style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>{uploadError}</span>
            <DismissButton onClick={() => setUploadError(null)} title={t("files.dismissError")} />
          </div>
        )}

        {uploadSummary && (
          <div aria-live="polite">
            <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 22, fontSize: 11 }}>
              <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                {uploadSummary.uploaded.length > 0 && (
                  <span title={`${uploadSummary.uploaded.length} uploaded`} aria-label={`${uploadSummary.uploaded.length} uploaded`} style={{ display: "flex", alignItems: "center", gap: 3, color: "#22c55e" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                    <span>{uploadSummary.uploaded.length}</span>
                  </span>
                )}
                {uploadSummary.skipped.length > 0 && (
                  <span title={`${uploadSummary.skipped.length} skipped`} aria-label={`${uploadSummary.skipped.length} skipped`} style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--text-dim)" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M8 12h8" />
                    </svg>
                    <span>{uploadSummary.skipped.length}</span>
                  </span>
                )}
                {uploadSummary.errors.length > 0 && (
                  <span title={`${uploadSummary.errors.length} failed`} aria-label={`${uploadSummary.errors.length} failed`} style={{ display: "flex", alignItems: "center", gap: 3, color: "#f87171" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 3 2.5 20h19L12 3Z" />
                      <path d="M12 9v4" />
                      <path d="M12 17h.01" />
                    </svg>
                    <span>{uploadSummary.errors.length}</span>
                  </span>
                )}
              </div>
              {uploadSummary.uploaded.length > 0 && onAtMentions && (
                <button
                  type="button"
                  onClick={addUploadedFilesToChat}
                  title={uploadSummary.uploaded.length === 1 ? t("files.addUploadedFile") : t("files.addAllUploadedFiles")}
                  aria-label={uploadSummary.uploaded.length === 1 ? t("files.addUploadedFile") : t("files.addAllUploadedFiles")}
                  style={{ height: 22, padding: "0 7px", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-panel)", color: "var(--accent)", cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}
                >
                  <MentionIcon />
                  {t("files.mention")}
                </button>
              )}
              <DismissButton onClick={() => setUploadSummary(null)} title={t("files.dismissUploadResults")} />
            </div>
            {uploadSummary.errors.map((item) => (
              <div key={item.name} title={item.error} style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, minWidth: 0, fontSize: 10, color: "#f87171" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5" />
                  <path d="M12 17h.01" />
                </svg>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
              </div>
            ))}
          </div>
        )}
        </div>
      )}

      {(fileOpError || fileOpNotice) && (
        <div style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
          {fileOpError && (
            <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, lineHeight: 1.35, color: "#f87171" }}>
              <span style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>{fileOpError}</span>
              <DismissButton onClick={() => setFileOpError(null)} title={t("files.dismissError")} />
            </div>
          )}
          {fileOpNotice && (
            <div role="status" style={{ fontSize: 11, color: "var(--text-muted)" }}>{fileOpNotice}</div>
          )}
        </div>
      )}

      {!changesCollapsed && gitFiles.length > 0 && (
        <div style={{ padding: "0 4px 2px" }}>
          <div
            aria-label={t("files.changeStats", {
              count: gitFiles.length,
              additions: gitLineStats.additions,
              deletions: gitLineStats.deletions,
            })}
            style={{ display: "flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", fontSize: 12 }}
          >
            <span style={{ color: "var(--text-dim)" }}>
              {t("files.changedCount", { count: gitFiles.length })}
            </span>
            <span style={{ color: GIT_STATUS_COLORS.added, fontFamily: "var(--font-mono)" }}>+{gitLineStats.additions}</span>
            <span style={{ color: GIT_STATUS_COLORS.deleted, fontFamily: "var(--font-mono)" }}>-{gitLineStats.deletions}</span>
          </div>
          {gitFiles.map((status) => (
            <ChangeRow key={status.filePath} status={status} cwd={cwd} onOpenFile={onOpenFile} t={t} />
          ))}
        </div>
      )}

      {(changesCollapsed || gitFiles.length === 0) && (
        <div
          style={{ padding: "2px 4px" }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleBlankContextMenu(event);
          }}
        >
          {loading ? (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>Loading files...</div>
          ) : error ? (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "#f87171" }}>{error}</div>
          ) : (
            <>
              {rootCreating && (
                <CreatingRow
                  depth={0}
                  isDir={rootCreating.kind === "newdir"}
                  onCommit={(name) => void commitCreate(cwd, name, rootCreating.kind === "newdir")}
                  onCancel={cancelEditing}
                />
              )}
              {roots.map((node) => (
                <TreeNode
                  key={node.fullPath}
                  node={node}
                  depth={0}
                  cwd={cwd}
                  onOpenFile={onOpenFile}
                  onAtMention={onAtMention}
                  expandedPaths={expandedPaths}
                  onToggleExpanded={handleToggleExpanded}
                  refreshToken={refreshToken}
                  highlightedPaths={highlightedPaths}
                  gitStatusByPath={gitStatusByPath}
                  changedDirectoryPaths={changedDirectoryPaths}
                  t={t}
                  onContextMenu={handleContextMenu}
                  editing={editing}
                  onRenameCommit={commitRename}
                  onCreateCommit={commitCreate}
                  onCancelEdit={cancelEditing}
                  onDragStartNode={handleDragStartNode}
                  onDropOnNode={(folder) => void handleDropOnNode(folder)}
                  getDraggedPath={getDraggedPath}
                />
              ))}
            </>
          )}
          {!loading && !error && roots.length === 0 && (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>
              {t("files.noFiles")}
            </div>
          )}
        </div>
      )}

      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextMenuItems(contextMenu.node)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {deleting && (
        <DeleteConfirmDialog
          name={deleting.node.name}
          isDir={deleting.node.isDir}
          busy={deleting.busy}
          error={deleting.error}
          onCancel={cancelDelete}
          onConfirm={() => void confirmDelete()}
          t={t}
        />
      )}
    </div>
  );
});
