"use client";

import { createContext, forwardRef, useContext, useState, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { getFileIcon, FolderIcon } from "./FileIcons";
import { DownloadIcon, FolderOpenIcon, FolderPlusIcon, MentionIcon, MoreIcon, PencilIcon, TrashIcon } from "./SidebarIcons";
import { SidebarMenu, SidebarMenuQuestion, type SidebarMenuAnchor, type SidebarMenuItem } from "./SidebarMenu";
import {
  encodeFilePathForApi,
  getFileDirectory,
  getFileName,
  getRelativeFilePath,
  joinFilePath,
  normalizeFilePathSlashes,
} from "@/lib/file-paths";
import type { GitFileStatus, GitFileStatusKind, GitStatusResponse } from "@/lib/git-types";
import type { FileIndexEntry } from "@/lib/file-fuzzy";
import {
  collectDroppedItems,
  fileUploadItems,
  MAX_UPLOAD_TOTAL_BYTES,
  pickedFolderItems,
  summarizeNames,
  uploadFiles,
  uploadTopEntries,
  uploadTotalBytes,
  type CollectedUpload,
  type DroppedItem,
  type UploadConflictStrategy,
  type UploadItem,
  type UploadResponse,
} from "@/lib/file-upload-client";
import { formatImageBytes } from "@/lib/model-image-limits";
import { buildSearchTree, type SearchTreeNode } from "@/lib/search-tree";
import type { FileTreeHiddenReason } from "@/lib/file-tree-visibility";
import { createExpandedPathsMemory } from "@/lib/file-tree-expansion";
import { loadChangesViewMode, saveChangesViewMode, type ChangesViewMode } from "@/lib/sidebar-prefs";
import { droppedItems } from "@/hooks/useDragDrop";
import { useI18n } from "@/hooks/useI18n";
import type { Translate } from "@/lib/i18n/types";
import { errorMessage } from "@/lib/errors";
import { buildAtMentionText } from "@/lib/file-fuzzy";
import { createFolder, deleteFileEntry, FILE_ENTRY_DRAG_MIME, fileEntryDragData, moveFileEntry } from "@/lib/file-manage-client";
/** Why a listed entry is normally left out; only listings with `hidden=1` report it. */
type HiddenReason = Exclude<FileTreeHiddenReason, "always">;

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
  /** Where a directory link leads when that is outside the browsable roots. */
  outsideLinkTarget?: string;
  /** That target contains the project or the home folder. */
  outsideLinkEncloses?: boolean;
  hidden?: HiddenReason;
}

interface FileNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean;
  outsideLinkTarget?: string;
  outsideLinkEncloses?: boolean;
  hidden?: HiddenReason;
}

interface Props {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string, options?: OpenFileOptions) => void;
  refreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  /** Files and folders (an uploaded folder is mentioned as `folder/`). */
  onAtMentions?: (entries: Array<{ path: string; isDir: boolean }>) => void;
  onUploadBusyChange?: (busy: boolean) => void;
  changesCollapsed: boolean;
  onChangesCountChange?: (count: number) => void;
  fileSearchOpen?: boolean;
  onFileSearchOpenChange?: (open: boolean) => void;
  /** Also list what Git ignores, dimmed (the explorer bar's switch). */
  showHidden?: boolean;
  /** Phone layout (the sidebar's `isMobile`): ⋯ always shown, the menu a bottom sheet. */
  mobile?: boolean;
  /** Shows a notice in the sidebar's toast (the one session archive uses). */
  onToast?: (toast: FileExplorerToast) => void;
  /**
   * "Show in Finder" (Explorer, file manager) in a row's menu: the entry
   * selected in its folder. Absent where the server cannot raise a window for
   * this browser. `reveal` resolves the message of a failure, or null.
   */
  fileManager?: { label: string; reveal: (path: string) => Promise<string | null> };
  /** An entry moved or was renamed here, so open tabs of it can follow. */
  onEntryMoved?: (from: string, to: string) => void;
  onEntryDeleted?: (path: string) => void;
}

/** A notice for the sidebar's toast. */
export interface FileExplorerToast {
  message: string;
  actions?: { id: string; label: string; onClick: () => void }[];
  /** Stays until dismissed (failed uploads). */
  sticky?: boolean;
  /** Waits for an answer (an upload conflict's Replace or Skip): stays, and later notices wait behind it. */
  question?: boolean;
}

// React's types lack the folder picker's attribute.
const FOLDER_INPUT_PROPS = { webkitdirectory: "" } as React.InputHTMLAttributes<HTMLInputElement>;

export interface FileExplorerHandle {
  /** Files, or one folder with its subfolders. */
  openUploadPicker: (kind: "files" | "folder") => void;
  /** Starts naming a new folder at the top of the tree. */
  createFolder: () => void;
}

/** The explorer's create / rename / move / delete, shared with every row. */
interface FileManageApi {
  /** The row whose menu is open. */
  menuPath: string | null;
  /** A row's ⋯ (beside the button) or right-click (at the pointer); the shared sidebar menu. */
  openMenu: (node: FileNode, anchor: SidebarMenuAnchor, opener: HTMLElement | null) => void;
  /** Phone layout: ⋯ always shown and bigger, the menu a bottom sheet, no quick Mention. */
  mobile: boolean;
  renamingPath: string | null;
  creatingIn: string | null;
  startRename: (path: string) => void;
  startCreateFolder: (directory: string) => void;
  cancelEdit: () => void;
  submitRename: (node: FileNode, name: string) => void;
  submitCreateFolder: (directory: string, name: string) => void;
  draggingPath: string | null;
  startDrag: (path: string) => void;
  endDrag: () => void;
  /** Whether the dragged row may land in `directory` (not its own folder, not inside itself). */
  canDropInto: (directory: string) => boolean;
  moveInto: (directory: string) => void;
}

const FileManageContext = createContext<FileManageApi | null>(null);

// A folder hovered this long during a drag opens, so a deep target is reachable.
const DRAG_EXPAND_DELAY_MS = 600;

function elementAnchor(element: HTMLElement): SidebarMenuAnchor {
  const rect = element.getBoundingClientRect();
  return { kind: "rect", rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, align: "end" };
}

function isSameOrInside(target: string, ancestor: string): boolean {
  const a = normalizeFilePathSlashes(target);
  const b = normalizeFilePathSlashes(ancestor).replace(/\/$/, "");
  return a === b || a.startsWith(`${b}/`);
}

function InlineNameInput({
  initial,
  isDir,
  onSubmit,
  onCancel,
}: {
  initial: string;
  isDir: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // The name without its extension, as Finder and VS Code select it.
    const dot = isDir ? -1 : initial.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial, isDir]);
  const finish = (submit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const name = inputRef.current?.value.trim() ?? "";
    if (submit && name && name !== initial) onSubmit(name);
    else onCancel();
  };
  return (
    <input
      ref={inputRef}
      defaultValue={initial}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") { event.preventDefault(); finish(true); }
        if (event.key === "Escape") { event.preventDefault(); finish(false); }
      }}
      onBlur={() => finish(true)}
      spellCheck={false}
      className="file-tree-rename"
    />
  );
}

/** The row a new folder is named in, at the top of its parent's entries. */
function NewFolderRow({ directory, depth }: { directory: string; depth: number }) {
  const manage = useContext(FileManageContext);
  if (!manage || manage.creatingIn !== directory) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, paddingLeft: 8 + depth * 14, paddingRight: 8, height: "var(--row-height-compact)" }}>
      <span style={{ width: 10, flexShrink: 0 }} />
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}><FolderIcon size={14} open={false} /></span>
      <InlineNameInput
        initial=""
        isDir
        onSubmit={(name) => manage.submitCreateFolder(directory, name)}
        onCancel={manage.cancelEdit}
      />
    </div>
  );
}

type UploadPhase = "idle" | "checking" | "uploading";

// Each folder's open directories for the page's life, so moving to another
// project and back (a session picked in another group) does not fold the tree.
const expandedPathsByCwd = createExpandedPathsMemory();


async function responseError(res: Response, fallback: string): Promise<Error> {
  let message = `${fallback} (HTTP ${res.status})`;
  try {
    const data = await res.json() as { error?: string };
    if (data.error) message = data.error;
  } catch {
    // ignore non-JSON error bodies
  }
  return new Error(message);
}

async function fetchEntries(dirPath: string, showHidden = false): Promise<FileNode[]> {
  const encoded = encodeFilePathForApi(dirPath);
  const res = await fetch(`/api/files/${encoded}?type=list${showHidden ? "&hidden=1" : ""}`);
  if (!res.ok) throw await responseError(res, "Failed to load files");
  const data = await res.json() as { entries?: FileEntry[] };
  return (data.entries ?? []).map((e) => ({
    name: e.name,
    fullPath: joinFilePath(dirPath, e.name),
    isDir: e.isDir,
    size: e.size,
    children: e.isDir ? [] : undefined,
    loaded: !e.isDir,
    outsideLinkTarget: e.outsideLinkTarget,
    outsideLinkEncloses: e.outsideLinkEncloses,
    hidden: e.hidden,
  }));
}

// Sends the target the operator was shown, so a link pointed elsewhere since
// the listing is refused instead of granting a directory nobody looked at.
async function allowOutsideLink(linkPath: string, target: string): Promise<void> {
  const res = await fetch(`/api/files/${encodeFilePathForApi(linkPath)}?type=allow-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  if (!res.ok) throw await responseError(res, "Failed to allow the linked folder");
}

async function fetchGitStatus(cwd: string, signal: AbortSignal): Promise<GitStatusResponse> {
  const params = new URLSearchParams({ cwd });
  const res = await fetch(`/api/git/status?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`Failed to load Git status (HTTP ${res.status})`);
  return res.json() as Promise<GitStatusResponse>;
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

function OutsideLinkIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

// Listed only while the explorer shows ignored files: dimmed like VS Code's
// ignored entries, the reason in the name's tooltip.
const HIDDEN_ENTRY_OPACITY = 0.55;
const HIDDEN_REASON_KEYS = {
  ignored: "files.hiddenIgnored",
  excluded: "files.hiddenExcluded",
} as const satisfies Record<HiddenReason, string>;

export function TreeNode({
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
  showHidden = false,
  parentHidden,
  dropTargetPath,
  onDropFiles,
  onDropTargetChange,
  t,
}: {
  node: FileNode;
  depth: number;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string, options?: OpenFileOptions) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (fullPath: string, open: boolean) => void;
  refreshToken?: string;
  highlightedPaths: Set<string>;
  gitStatusByPath: Map<string, GitFileStatus>;
  changedDirectoryPaths: Set<string>;
  showHidden?: boolean;
  /** Set inside a hidden directory: Git has no answer there, so its entries inherit the reason. */
  parentHidden?: HiddenReason;
  dropTargetPath?: string | null;
  onDropFiles?: (directory: string, items: DroppedItem[]) => void;
  onDropTargetChange?: (path: string | null) => void;
  t: Translate;
}) {
  const manage = useContext(FileManageContext);
  const renaming = manage?.renamingPath === node.fullPath;
  const open = expandedPaths.has(node.fullPath);
  const hidden = node.hidden ?? parentHidden;
  const isDropTarget = node.isDir && dropTargetPath === node.fullPath;
  const highlighted = highlightedPaths.has(node.fullPath);
  const normalizedPath = normalizeFilePathSlashes(node.fullPath);
  const gitStatus = gitStatusByPath.get(normalizedPath);
  const containsGitChanges = node.isDir && (
    gitStatus !== undefined || changedDirectoryPaths.has(normalizedPath)
  );
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [allowedLinkTarget, setAllowedLinkTarget] = useState<string | null>(null);
  const [allowingLink, setAllowingLink] = useState(false);
  const [allowLinkError, setAllowLinkError] = useState<string | null>(null);
  // A link leading outside the project is refused until the operator allows
  // its target, so it asks for that instead of listing (#748).
  const pendingLinkTarget = node.outsideLinkTarget && node.outsideLinkTarget !== allowedLinkTarget
    ? node.outsideLinkTarget
    : null;

  // A listing that reports the link again (a server restart forgets allowed
  // targets, or the link was pointed elsewhere) needs a new decision.
  useEffect(() => {
    setAllowedLinkTarget(null);
    setAllowLinkError(null);
  }, [node.outsideLinkTarget]);

  const loadChildren = useCallback(async (force = false) => {
    if (loaded && !force) return;
    setLoading(true);
    setLoadError(null);
    try {
      const entries = await fetchEntries(node.fullPath, showHidden);
      setChildren(entries);
      setLoaded(true);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [loaded, node.fullPath, showHidden]);

  // The switch changes what every listing holds: reload an open directory now
  // and a collapsed one when it next opens.
  const listedShowHiddenRef = useRef(showHidden);
  useEffect(() => {
    if (listedShowHiddenRef.current === showHidden) return;
    listedShowHiddenRef.current = showHidden;
    if (!loaded) return;
    if (open && !pendingLinkTarget) loadChildren(true);
    else setLoaded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  // A folder opened from anywhere lists itself: mounted open (a restored set,
  // a hidden folder left expanded), opened by a drag hovering it, or by the
  // menu's New folder.
  useEffect(() => {
    if (node.isDir && open && !loaded && !loading && !pendingLinkTarget) loadChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-fetch children when the tree refreshes: an open directory now, a
  // collapsed one when it next opens (a file dropped onto its row).
  useEffect(() => {
    if (refreshToken === undefined || !loaded || pendingLinkTarget) return;
    if (open) loadChildren(true);
    else setLoaded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const handleClick = useCallback(() => {
    if (node.isDir) {
      const next = !open;
      onToggleExpanded(node.fullPath, next);
      if (next && !loaded && !pendingLinkTarget) loadChildren();
    } else {
      onOpenFile(node.fullPath, node.name);
    }
  }, [node.isDir, node.fullPath, node.name, loaded, open, pendingLinkTarget, loadChildren, onOpenFile, onToggleExpanded]);

  // A dragged row hovering a closed folder opens it after a moment.
  const dragging = manage?.draggingPath != null;
  useEffect(() => {
    if (!isDropTarget || !dragging || open || pendingLinkTarget) return;
    const timer = setTimeout(() => onToggleExpanded(node.fullPath, true), DRAG_EXPAND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isDropTarget, dragging, open, pendingLinkTarget, node.fullPath, onToggleExpanded]);

  // Where a dragged row dropped here lands: this folder, or a file's own folder.
  const moveTargetDirectory = node.isDir ? node.fullPath : getFileDirectory(node.fullPath);

  const handleAllowLink = useCallback(async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!pendingLinkTarget) return;
    // A link to `/`, `~` or a parent of the project opens far more than a
    // sibling folder, and a cloned repository can contain one.
    if (node.outsideLinkEncloses && !window.confirm(t("files.allowEnclosingLinkConfirm", { target: pendingLinkTarget }))) {
      return;
    }
    setAllowingLink(true);
    setAllowLinkError(null);
    try {
      await allowOutsideLink(node.fullPath, pendingLinkTarget);
      setAllowedLinkTarget(pendingLinkTarget);
      await loadChildren(true);
    } catch (error) {
      setAllowLinkError(errorMessage(error));
    } finally {
      setAllowingLink(false);
    }
  }, [node.fullPath, node.outsideLinkEncloses, pendingLinkTarget, loadChildren, t]);

  return (
    <div>
      <div
        className={`file-tree-row${manage?.menuPath === node.fullPath ? " is-menu-open" : ""}`}
        onClick={handleClick}
        onContextMenu={manage && !renaming ? (event) => {
          event.preventDefault();
          event.stopPropagation();
          const row = event.currentTarget;
          // The keyboard's context-menu key reports no pointer position.
          const anchor: SidebarMenuAnchor = event.clientX === 0 && event.clientY === 0
            ? elementAnchor(row)
            : { kind: "point", x: event.clientX, y: event.clientY };
          manage.openMenu(node, anchor, null);
        } : undefined}
        draggable={Boolean(manage) && !renaming}
        onDragStart={manage ? (event) => {
          // Dropped onto the composer, it becomes an @ mention (useDragDrop).
          const mention = buildAtMentionText(getRelativeFilePath(node.fullPath, cwd), node.isDir);
          event.dataTransfer.setData(FILE_ENTRY_DRAG_MIME, fileEntryDragData(node.fullPath, mention));
          event.dataTransfer.setData("text/plain", mention);
          event.dataTransfer.effectAllowed = "copyMove";
          manage.startDrag(node.fullPath);
        } : undefined}
        onDragEnd={manage ? () => manage.endDrag() : undefined}
        onDragOver={(event) => {
          if (manage?.draggingPath && event.dataTransfer.types.includes(FILE_ENTRY_DRAG_MIME)) {
            event.stopPropagation();
            if (!manage.canDropInto(moveTargetDirectory)) {
              event.dataTransfer.dropEffect = "none";
              onDropTargetChange?.(null);
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            onDropTargetChange?.(moveTargetDirectory);
            return;
          }
          if (!node.isDir || !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
          onDropTargetChange?.(node.fullPath);
        }}
        onDrop={(event) => {
          if (manage?.draggingPath && event.dataTransfer.types.includes(FILE_ENTRY_DRAG_MIME)) {
            event.preventDefault();
            event.stopPropagation();
            onDropTargetChange?.(null);
            if (manage.canDropInto(moveTargetDirectory)) manage.moveInto(moveTargetDirectory);
            else manage.endDrag();
            return;
          }
          if (!node.isDir || !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.stopPropagation();
          onDropTargetChange?.(null);
          onDropFiles?.(node.fullPath, droppedItems(event.dataTransfer));
        }}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          height: "var(--row-height-compact)",
          cursor: "pointer",
          opacity: manage?.draggingPath === node.fullPath ? 0.5 : 1,
          // The hover's fill is the stylesheet's (.file-tree-row:hover).
          background: isDropTarget ? "color-mix(in srgb, var(--accent) 16%, transparent)" : undefined,
          outline: isDropTarget ? "1px dashed var(--accent)" : "none",
          outlineOffset: -1,
          borderRadius: 4,
          userSelect: "none",
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
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center", opacity: hidden ? HIDDEN_ENTRY_OPACITY : 1 }}>
          {node.isDir ? <FolderIcon size={14} open={open} /> : getFileIcon(node.name, 14)}
        </span>
        {renaming && manage ? (
          <InlineNameInput
            initial={node.name}
            isDir={node.isDir}
            onSubmit={(name) => manage.submitRename(node, name)}
            onCancel={manage.cancelEdit}
          />
        ) : (
        <span
          data-hidden-reason={hidden}
          style={{
            fontSize: 12,
            color: hidden ? "var(--text-muted)" : "var(--text)",
            opacity: hidden ? HIDDEN_ENTRY_OPACITY : 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={hidden ? `${node.fullPath}\n${t(HIDDEN_REASON_KEYS[hidden])}` : node.fullPath}
        >
          {node.name}
        </span>
        )}
        <span className="file-tree-meta">
        {pendingLinkTarget && (
          <span
            title={t("files.outsideLink", { target: pendingLinkTarget })}
            aria-label={t("files.outsideLink", { target: pendingLinkTarget })}
            style={{ width: 14, height: 14, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)" }}
          >
            <OutsideLinkIcon />
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
        {!node.isDir && gitStatus && (
          <GitStatusBadge status={gitStatus} t={t} />
        )}
        {containsGitChanges && (
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
        </span>
        {loading && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
          </svg>
        )}
        {/* As a session row's: hidden until hovered (CSS); on a phone or a
            screen without hover ⋯ stays, and Mention is in the menu. */}
        {!renaming && (onAtMention || manage) && (
          <span className="file-tree-actions">
            {onAtMention && !manage?.mobile && (
              <button
                type="button"
                className="file-tree-action file-tree-quick-action"
                onClick={(e) => {
                  e.stopPropagation();
                  onAtMention(getRelativeFilePath(node.fullPath, cwd), node.isDir);
                }}
                title={t("files.insertPath")}
                aria-label={t("files.insertPath")}
              >
                <MentionIcon size={13} />
              </button>
            )}
            {manage && (
              <button
                type="button"
                className={`file-tree-action file-tree-more-action${manage.menuPath === node.fullPath ? " is-active" : ""}`}
                aria-haspopup="menu"
                aria-expanded={manage.menuPath === node.fullPath}
                onClick={(e) => {
                  e.stopPropagation();
                  manage.openMenu(node, elementAnchor(e.currentTarget), e.currentTarget);
                }}
                title={t("files.more")}
                aria-label={t("files.more")}
              >
                <MoreIcon size={14} />
              </button>
            )}
          </span>
        )}
      </div>
      {node.isDir && open && pendingLinkTarget && (
        <div
          style={{
            paddingLeft: 8 + (depth + 1) * 14,
            paddingRight: 8,
            paddingTop: 3,
            paddingBottom: 5,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 4,
            fontSize: 11,
            color: "var(--text-dim)",
          }}
        >
          <span style={{ wordBreak: "break-all" }}>{t("files.outsideLink", { target: pendingLinkTarget })}</span>
          {node.outsideLinkEncloses && (
            <span style={{ color: "#f59e0b" }}>{t("files.outsideLinkEncloses")}</span>
          )}
          <button
            type="button"
            onClick={handleAllowLink}
            disabled={allowingLink}
            title={t("files.allowOutsideLinkTitle", { target: pendingLinkTarget })}
            style={{
              height: "var(--row-button-compact)",
              padding: "0 8px",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--accent)",
              cursor: allowingLink ? "default" : "pointer",
              opacity: allowingLink ? 0.6 : 1,
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {t("files.allowOutsideLink")}
          </button>
          {allowLinkError && (
            <span role="alert" style={{ color: "#f87171", wordBreak: "break-word" }}>{allowLinkError}</span>
          )}
        </div>
      )}
      {node.isDir && open && !pendingLinkTarget && (
        <div>
          <NewFolderRow directory={node.fullPath} depth={depth + 1} />
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
              showHidden={showHidden}
              parentHidden={hidden}
              dropTargetPath={dropTargetPath}
              onDropFiles={onDropFiles}
              onDropTargetChange={onDropTargetChange}
              t={t}
            />
          ))}
          {children.length === 0 && loaded && !loadError && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14, fontSize: 11, color: "var(--text-dim)", height: "var(--row-height-compact)", display: "flex", alignItems: "center" }}>
              empty
            </div>
          )}
          {loadError && (
            <div role="alert" style={{ paddingLeft: 8 + (depth + 1) * 14, paddingRight: 8, paddingTop: 3, paddingBottom: 3, fontSize: 11, color: "#f87171", wordBreak: "break-word" }}>
              {loadError}
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
  onAtMention,
  t,
  depth = 0,
  treeMode = false,
}: {
  status: GitFileStatus;
  cwd: string;
  onOpenFile: OpenFileHandler;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  t: Translate;
  depth?: number;
  treeMode?: boolean;
}) {
  const name = getFileName(status.filePath);
  const rel = getRelativeFilePath(status.filePath, cwd);
  // Split the path so the directory part ellipsizes while the file name stays fully visible
  const lastSlash = rel.lastIndexOf("/");
  const dirPart = !treeMode && lastSlash >= 0 ? rel.slice(0, lastSlash + 1) : "";
  const baseName = treeMode ? name : (lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel);
  return (
    <div
      className="file-tree-row"
      onClick={() => onOpenFile(status.filePath, name, { modeHint: "diff" })}
      title={status.filePath}
      style={{
        display: "flex",
        alignItems: "center",
        gap: treeMode ? 4 : 6,
        paddingLeft: treeMode ? 8 + depth * 14 : 10,
        paddingRight: 8,
        height: "var(--row-height-compact)",
        cursor: "pointer",
        borderRadius: 4,
        userSelect: "none",
        position: "relative",
      }}
    >
      <GitStatusBadge status={status} t={t} />
      {treeMode && <span style={{ width: 10, flexShrink: 0 }} />}
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", opacity: 0.85 }}>
        {getFileIcon(name, 13)}
      </span>
      <span
        title={status.filePath}
        style={{
          fontSize: 12,
          color: "var(--text)",
          display: "flex",
          alignItems: "center",
          minWidth: 0,
          flex: 1,
        }}
      >
        {dirPart && (
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: "0 1 auto",
              minWidth: 0,
              color: "var(--text-dim)",
            }}
          >
            {dirPart}
          </span>
        )}
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flexShrink: treeMode ? 1 : 0,
            maxWidth: "100%",
          }}
        >
          {baseName}
        </span>
      </span>
      {onAtMention && (
        <button
          type="button"
          // Its only action: shown without hover too, where there is none.
          className="file-tree-action file-tree-change-mention"
          onClick={(e) => {
            e.stopPropagation();
            onAtMention(rel, false);
          }}
          title={t("files.insertPath")}
          aria-label={t("files.insertPath")}
        >
          <MentionIcon size={13} />
        </button>
      )}
    </div>
  );
}

function ChangesFolderRow({
  node,
  depth,
  open,
  onToggle,
}: {
  node: SearchTreeNode;
  depth: number;
  open: boolean;
  onToggle: (path: string, open: boolean) => void;
}) {
  return (
    <div
      className="file-tree-row"
      onClick={() => onToggle(node.path, !open)}
      title={node.path}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        paddingLeft: 8 + depth * 14,
        paddingRight: 8,
        height: "var(--row-height-compact)",
        cursor: "pointer",
        borderRadius: 4,
        userSelect: "none",
      }}
    >
      <svg
        width="10" height="10" viewBox="0 0 10 10" fill="none"
        stroke="var(--text-dim)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.1s" }}
        aria-hidden="true"
      >
        <polyline points="3 2 7 5 3 8" />
      </svg>
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
        <FolderIcon size={14} open={open} />
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
        {node.name}
      </span>
    </div>
  );
}

function ChangesTreeRows({
  nodes,
  depth,
  cwd,
  statusByPath,
  collapsedPaths,
  onToggleExpanded,
  onOpenFile,
  onAtMention,
  t,
}: {
  nodes: SearchTreeNode[];
  depth: number;
  cwd: string;
  statusByPath: Map<string, GitFileStatus>;
  collapsedPaths: Set<string>;
  onToggleExpanded: (path: string, open: boolean) => void;
  onOpenFile: OpenFileHandler;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  t: Translate;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.isDir) {
          const open = !collapsedPaths.has(node.path);
          return (
            <div key={`dir:${node.path}`}>
              <ChangesFolderRow
                node={node}
                depth={depth}
                open={open}
                onToggle={onToggleExpanded}
              />
              {open && (
                <ChangesTreeRows
                  nodes={node.children}
                  depth={depth + 1}
                  cwd={cwd}
                  statusByPath={statusByPath}
                  collapsedPaths={collapsedPaths}
                  onToggleExpanded={onToggleExpanded}
                  onOpenFile={onOpenFile}
                  onAtMention={onAtMention}
                  t={t}
                />
              )}
            </div>
          );
        }
        const status = statusByPath.get(node.path);
        if (!status) return null;
        return (
          <ChangeRow
            key={status.filePath}
            status={status}
            cwd={cwd}
            onOpenFile={onOpenFile}
            onAtMention={onAtMention}
            t={t}
            depth={depth}
            treeMode
          />
        );
      })}
    </>
  );
}

function ChangesViewToggleIcon({ mode }: { mode: ChangesViewMode }) {
  if (mode === "tree") {
    // List icon: switching back to the flat list
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" />
        <path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" />
      </svg>
    );
  }
  // Tree icon: switching to the folder tree
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3v12" /><path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M9 12h6" /><path d="M12 12v3" />
    </svg>
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
  fileSearchOpen = false,
  onFileSearchOpenChange,
  showHidden = false,
  onEntryMoved,
  onEntryDeleted,
  onToast,
  fileManager,
  mobile = false,
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
  const [changesViewMode, setChangesViewMode] = useState<ChangesViewMode>("list");
  // Folders stay open unless collapsed here, so a refresh or a newly changed folder never folds them.
  const [collapsedChangeDirs, setCollapsedChangeDirs] = useState<Set<string>>(() => new Set());
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPaths, setSearchPaths] = useState<string[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const fileDragDepthRef = useRef(0);
  // The row whose menu is open; `askDelete` swaps its items for the question.
  const [menu, setMenu] = useState<{ node: FileNode; anchor: SidebarMenuAnchor; opener: HTMLElement | null; askDelete?: boolean } | null>(null);
  const menuPath = menu?.node.fullPath ?? null;
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const toastRef = useRef(onToast);
  toastRef.current = onToast;
  const notify = useCallback((toast: FileExplorerToast) => toastRef.current?.(toast), []);
  const prevCwdRef = useRef<string | null>(null);
  const expandedPathsRef = useRef(expandedPaths);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadFolderInputRef = useRef<HTMLInputElement>(null);
  const refreshToken = `${refreshKey ?? 0}:${treeRefreshKey}`;
  const uploadBusy = uploadPhase !== "idle";
  const hasSearchQuery = searchQuery.trim().length > 0;

  // Reuse the cached, bounded file index used by @ mentions.
  useEffect(() => {
    if (!fileSearchOpen) return;
    const query = searchQuery.trim();
    if (!query) {
      setSearchPaths([]);
      setSearchLoading(false);
      setSearchError(false);
      return;
    }
    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError(false);
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<{ matches?: FileIndexEntry[] }> : Promise.reject(new Error("Search failed")))
        .then((data) => setSearchPaths((data.matches ?? []).filter((entry) => !entry.isDir).map((entry) => entry.path)))
        .catch(() => {
          if (!controller.signal.aborted) {
            setSearchPaths([]);
            setSearchError(true);
          }
        })
        .finally(() => { if (!controller.signal.aborted) setSearchLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [cwd, fileSearchOpen, searchQuery]);

  // Focus the search input whenever the search panel opens.
  useEffect(() => {
    if (fileSearchOpen) searchInputRef.current?.focus();
  }, [fileSearchOpen]);

  // Results render as a tree; keep every directory that contains a match
  // expanded, while preserving the user's manual collapses as they type.
  useEffect(() => {
    if (searchPaths.length === 0) return;
    const dirs = new Set<string>();
    for (const relative of searchPaths) {
      const parts = relative.split("/");
      let path = "";
      for (let i = 0; i < parts.length - 1; i++) {
        path = path ? `${path}/${parts[i]}` : parts[i];
        dirs.add(joinFilePath(cwd, path));
      }
    }
    setSearchExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const dir of dirs) {
        if (!next.has(dir)) { next.add(dir); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [cwd, searchPaths]);

  const searchRoots = useMemo(() => {
    const toFileNode = (node: SearchTreeNode): FileNode => ({
      name: node.name,
      fullPath: joinFilePath(cwd, node.path),
      isDir: node.isDir,
      size: 0,
      children: node.children.map(toFileNode),
      loaded: true,
    });
    return buildSearchTree(searchPaths).map(toFileNode);
  }, [cwd, searchPaths]);

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

  const changesByRelativePath = useMemo(() => new Map(gitFiles.map((status) => [
    normalizeFilePathSlashes(getRelativeFilePath(status.filePath, cwd)).replace(/^\/+/, ""),
    status,
  ])), [cwd, gitFiles]);
  const changesTree = useMemo(() => buildSearchTree([...changesByRelativePath.keys()]), [changesByRelativePath]);

  const handleToggleExpanded = useCallback((fullPath: string, open: boolean) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(fullPath); else next.delete(fullPath);
      return next;
    });
  }, []);

  // The result: counts, each failed file with its reason, and notes from
  // reading a dropped folder. A failure stays until dismissed; a plain success
  // goes like Undo does (its files stay highlighted, each with Mention in its
  // menu). An uploaded folder is highlighted and mentioned, not each file in it.
  const applyUploadResult = useCallback((data: UploadResponse, directory: string, notes: string[]) => {
    const uploaded = data.uploaded ?? [];
    const skipped = data.skipped ?? [];
    const errors = data.errors ?? [];
    const parts: string[] = [];
    if (uploaded.length > 0) parts.push(t("files.uploadedCount", { count: uploaded.length }));
    if (skipped.length > 0) parts.push(t("files.skippedCount", { count: skipped.length }));
    if (errors.length > 0) {
      const failures = summarizeNames(
        errors.map((item) => (item.error ? `${item.name} (${item.error})` : item.name)),
        (count) => t("files.moreNames", { count }),
      );
      parts.push(`${t("files.failedCount", { count: errors.length })}: ${failures}`);
    }
    parts.push(...notes);
    const added = uploadTopEntries(uploaded);
    const mentionAction = added.length > 0 && onAtMentions ? [{
      id: "mention",
      label: t("files.mention"),
      onClick: () => onAtMentions(added.map((entry) => ({ ...entry, path: getRelativeFilePath(joinFilePath(directory, entry.path), cwd) }))),
    }] : [];
    if (parts.length > 0) notify({ message: parts.join(" · "), actions: mentionAction, sticky: errors.length > 0 || notes.length > 0 });

    if (uploaded.length > 0) {
      setHighlightedPaths(new Set(added.map((entry) => joinFilePath(directory, entry.path))));
      setTreeRefreshKey((key) => key + 1);
    }
  }, [cwd, notify, onAtMentions, t]);

  // Replace or skip: dismissing the toast cancels the upload.
  const askConflictRef = useRef<(conflict: { directory: string; items: UploadItem[]; conflicts: string[]; nonReplaceable: string[]; notes: string[] }) => void>(() => {});

  const performUpload = useCallback(async (
    items: UploadItem[],
    strategy: UploadConflictStrategy,
    directory: string,
    notes: string[],
  ) => {
    setUploadProgress(0);
    setUploadPhase("uploading");

    try {
      const { status, data } = await uploadFiles(directory, items, strategy, setUploadProgress);
      if (status === 409 && data.conflicts?.length) {
        askConflictRef.current({ directory, items, conflicts: data.conflicts, nonReplaceable: data.nonReplaceable ?? [], notes });
        return;
      }
      if (status < 200 || status >= 300) {
        throw new Error(data.error ?? `Upload failed (HTTP ${status})`);
      }
      setUploadProgress(100);
      applyUploadResult(data, directory, notes);
    } catch (uploadFailure) {
      notify({ message: errorMessage(uploadFailure) });
    } finally {
      setUploadPhase("idle");
    }
  }, [applyUploadResult, notify]);

  askConflictRef.current = ({ directory, items, conflicts, nonReplaceable, notes }) => {
    const names = (list: string[]) => summarizeNames(list, (count) => t("files.moreNames", { count }));
    const message = [
      t("files.conflictSummary", { count: conflicts.length, countSuffix: conflicts.length === 1 ? "" : "s", files: names(conflicts) }),
      ...(nonReplaceable.length > 0 ? [t("files.cannotReplace", { files: names(nonReplaceable) })] : []),
    ].join(" · ");
    notify({
      message,
      question: true,
      actions: [
        { id: "replace", label: t("files.replace"), onClick: () => void performUpload(items, "overwrite", directory, notes) },
        { id: "skip", label: t("files.skipExisting"), onClick: () => void performUpload(items, "skip", directory, notes) },
      ],
    });
  };

  // A dropped folder is read here, while the tree shows "checking".
  const prepareUpload = useCallback(async (collect: () => Promise<CollectedUpload>, directory: string) => {
    if (uploadBusy) return;
    setHighlightedPaths(new Set());
    setUploadProgress(0);
    setUploadPhase("checking");

    try {
      const { items, empty, failed } = await collect();
      const notes = [
        ...(empty.length > 0 ? [t("files.folderEmpty", { names: empty.join(", ") })] : []),
        ...failed.map((item) => `${item.name}: ${item.error}`),
      ];
      if (items.length === 0) {
        if (notes.length > 0) notify({ message: notes.join(" · ") });
        return;
      }
      const total = uploadTotalBytes(items);
      if (total > MAX_UPLOAD_TOTAL_BYTES) {
        notify({
          message: t("files.uploadTooLarge", { size: formatImageBytes(total), limit: formatImageBytes(MAX_UPLOAD_TOTAL_BYTES) }),
          sticky: true,
        });
        return;
      }

      const res = await fetch(
        `/api/files/${encodeFilePathForApi(directory)}?type=upload-check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths: items.map((item) => item.path) }),
        },
      );
      const data = await res.json().catch(() => ({})) as UploadResponse;
      if (!res.ok) throw new Error(data.error ?? `Upload check failed (HTTP ${res.status})`);

      if (data.conflicts?.length) {
        askConflictRef.current({ directory, items, conflicts: data.conflicts, nonReplaceable: data.nonReplaceable ?? [], notes });
        return;
      }

      await performUpload(items, "error", directory, notes);
    } catch (uploadFailure) {
      notify({ message: errorMessage(uploadFailure) });
    } finally {
      setUploadPhase("idle");
    }
  }, [notify, performUpload, t, uploadBusy]);

  const handleUploadInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const folder = event.target === uploadFolderInputRef.current;
    event.target.value = "";
    if (files.length === 0) return;
    const items = folder ? pickedFolderItems(files) : fileUploadItems(files);
    // Every file of a chosen folder may be a dot entry: it is named as an empty folder.
    const empty = folder && items.length === 0 ? [files[0].webkitRelativePath.split("/")[0]] : [];
    void prepareUpload(async () => ({ items, empty, failed: [] }), cwd);
  }, [cwd, prepareUpload]);

  useImperativeHandle(ref, () => ({
    openUploadPicker(kind) {
      if (uploadBusy) return;
      (kind === "folder" ? uploadFolderInputRef : uploadInputRef).current?.click();
    },
    createFolder() {
      // The tree shows only without a search query; its row is at the top.
      setSearchQuery("");
      setRenamingPath(null);
      setCreatingIn(cwd);
    },
  }), [cwd, uploadBusy]);

  // A moved or renamed folder stays open under its new path.
  const remapExpanded = useCallback((from: string, to: string) => {
    setExpandedPaths((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const p of prev) {
        if (isSameOrInside(p, from)) {
          next.add(to + p.slice(from.length));
          changed = true;
        } else {
          next.add(p);
        }
      }
      return changed ? next : prev;
    });
  }, []);

  // Paths stay the explorer's own (lexical) ones: the server answers with real
  // paths, which differ under a linked cwd (`/tmp` → `/private/tmp`).
  const performMove = useCallback(async (from: string, directory: string, name: string, renamed: boolean, undo = false) => {
    const to = joinFilePath(directory, name);
    try {
      await moveFileEntry(from, directory, name);
      remapExpanded(from, to);
      onEntryMoved?.(from, to);
      setTreeRefreshKey((key) => key + 1);
      if (undo) return;
      notify({
        message: renamed
          ? t("files.renamedTo", { name })
          : t("files.movedTo", { name, directory: getRelativeFilePath(directory, cwd) || getFileName(cwd) || cwd }),
        actions: [{
          id: "undo",
          label: t("files.undo"),
          onClick: () => void performMoveRef.current(to, getFileDirectory(from), getFileName(from), renamed, true),
        }],
      });
    } catch (failure) {
      notify({ message: errorMessage(failure) });
    }
  }, [cwd, notify, onEntryMoved, remapExpanded, t]);
  const performMoveRef = useRef(performMove);
  performMoveRef.current = performMove;

  const manageApi = useMemo<FileManageApi>(() => ({
    menuPath,
    openMenu: (node, anchor, opener) => setMenu({ node, anchor, opener }),
    mobile,
    renamingPath,
    creatingIn,
    startRename: (path) => { setCreatingIn(null); setRenamingPath(path); },
    startCreateFolder: (directory) => { setRenamingPath(null); setCreatingIn(directory); },
    cancelEdit: () => { setRenamingPath(null); setCreatingIn(null); },
    submitRename: (node, name) => {
      setRenamingPath(null);
      void performMove(node.fullPath, getFileDirectory(node.fullPath), name, true);
    },
    submitCreateFolder: (directory, name) => {
      setCreatingIn(null);
      createFolder(directory, name)
        .then(() => {
          if (directory !== cwd) handleToggleExpanded(directory, true);
          setTreeRefreshKey((key) => key + 1);
        })
        .catch((failure) => notify({ message: errorMessage(failure) }));
    },
    draggingPath,
    startDrag: (path) => { setMenu(null); setDraggingPath(path); },
    endDrag: () => {
      setDraggingPath(null);
      fileDragDepthRef.current = 0;
      setFileDragActive(false);
      setDropTargetPath(null);
    },
    canDropInto: (directory) => draggingPath !== null
      && !isSameOrInside(directory, draggingPath)
      && normalizeFilePathSlashes(directory) !== normalizeFilePathSlashes(getFileDirectory(draggingPath)),
    moveInto: (directory) => {
      const from = draggingPath;
      setDraggingPath(null);
      fileDragDepthRef.current = 0;
      setFileDragActive(false);
      setDropTargetPath(null);
      if (from) void performMove(from, directory, getFileName(from), false);
    },
  }), [creatingIn, cwd, draggingPath, handleToggleExpanded, menuPath, mobile, notify, performMove, renamingPath]);

  const deleteNode = useCallback((node: FileNode) => {
    deleteFileEntry(node.fullPath)
      .then(() => {
        onEntryDeleted?.(node.fullPath);
        setTreeRefreshKey((key) => key + 1);
        notify({ message: t("files.deletedEntry", { name: node.name }) });
      })
      .catch((failure) => notify({ message: errorMessage(failure) }));
  }, [notify, onEntryDeleted, t]);

  // The session rows' menu, with a file's actions: what is done to the entry
  // first, then where it is and what it is called, Delete last in red.
  const menuItems = useMemo<SidebarMenuItem[] | undefined>(() => {
    if (!menu) return undefined;
    const { node } = menu;
    const items: SidebarMenuItem[] = [];
    if (onAtMention) {
      items.push({
        type: "item",
        id: "mention",
        label: t("files.insertPath"),
        icon: <MentionIcon size={14} />,
        onSelect: () => onAtMention(getRelativeFilePath(node.fullPath, cwd), node.isDir),
      });
    }
    if (!node.isDir) {
      items.push({
        type: "item",
        id: "download",
        label: t("files.downloadItem"),
        icon: <DownloadIcon />,
        onSelect: () => {
          const link = document.createElement("a");
          link.href = `/api/files/${encodeFilePathForApi(node.fullPath)}?type=download`;
          link.download = node.name;
          link.click();
        },
      });
    }
    if (fileManager) {
      items.push({
        type: "item",
        id: "reveal",
        label: fileManager.label,
        icon: <FolderOpenIcon />,
        onSelect: () => {
          void fileManager.reveal(node.fullPath).then((failure) => {
            if (failure) notify({ message: failure });
          });
        },
      });
    }
    if (items.length > 0) items.push({ type: "separator", id: "separator-edit" });
    items.push({
      type: "item",
      id: "rename",
      label: t("files.rename"),
      icon: <PencilIcon />,
      shortcut: "R",
      onSelect: () => { setCreatingIn(null); setRenamingPath(node.fullPath); },
    });
    if (node.isDir) {
      items.push({
        type: "item",
        id: "new-folder",
        label: t("files.newFolder"),
        icon: <FolderPlusIcon />,
        shortcut: "N",
        onSelect: () => {
          handleToggleExpanded(node.fullPath, true);
          setRenamingPath(null);
          setCreatingIn(node.fullPath);
        },
      });
    }
    items.push({ type: "separator", id: "separator-delete" });
    items.push({
      type: "item",
      id: "delete",
      label: `${t("files.delete")}…`,
      icon: <TrashIcon />,
      shortcut: "D",
      danger: true,
      // As a session's Delete: Shift skips the question.
      onSelect: ({ shiftKey, keepOpen }) => {
        if (shiftKey) {
          deleteNode(node);
          return;
        }
        keepOpen();
        setMenu((current) => (current ? { ...current, askDelete: true } : current));
      },
    });
    return items;
  }, [cwd, deleteNode, fileManager, handleToggleExpanded, menu, notify, onAtMention, t]);


  const resetFileDrag = useCallback(() => {
    fileDragDepthRef.current = 0;
    setFileDragActive(false);
    setDropTargetPath(null);
  }, []);

  const handleExplorerDragEnter = useCallback((event: React.DragEvent) => {
    if (draggingPath !== null && event.dataTransfer.types.includes(FILE_ENTRY_DRAG_MIME)) {
      event.preventDefault();
      fileDragDepthRef.current += 1;
      setFileDragActive(true);
      return;
    }
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    fileDragDepthRef.current += 1;
    setFileDragActive(true);
  }, [draggingPath]);

  const handleExplorerDragOver = useCallback((event: React.DragEvent) => {
    if (draggingPath !== null && event.dataTransfer.types.includes(FILE_ENTRY_DRAG_MIME)) {
      // Below the rows: the project folder.
      setDropTargetPath((prev) => (prev === null ? prev : null));
      if (!manageApi.canDropInto(cwd)) {
        event.dataTransfer.dropEffect = "none";
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      return;
    }
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    // Directory rows stop dragover propagation, so this handler only runs
    // while hovering the panel background: those uploads target the cwd.
    setDropTargetPath((prev) => (prev === null ? prev : null));
  }, [cwd, draggingPath, manageApi]);

  const handleExplorerDragLeave = useCallback(() => {
    if (fileDragDepthRef.current <= 0) return;
    fileDragDepthRef.current -= 1;
    if (fileDragDepthRef.current === 0) {
      fileDragDepthRef.current = 0;
      setFileDragActive(false);
      setDropTargetPath(null);
    }
  }, []);

  // A dropped folder uploads with its subfolders; its entries were taken
  // during the drop event and are read now.
  const handleDropFiles = useCallback((directory: string, items: DroppedItem[]) => {
    resetFileDrag();
    if (items.length === 0) return;
    void prepareUpload(() => collectDroppedItems(items), directory);
  }, [prepareUpload, resetFileDrag]);

  const handleExplorerDrop = useCallback((event: React.DragEvent) => {
    if (draggingPath !== null && event.dataTransfer.types.includes(FILE_ENTRY_DRAG_MIME)) {
      event.preventDefault();
      const target = dropTargetPath ?? cwd;
      if (manageApi.canDropInto(target)) manageApi.moveInto(target);
      else manageApi.endDrag();
      return;
    }
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    handleDropFiles(dropTargetPath ?? cwd, droppedItems(event.dataTransfer));
  }, [cwd, draggingPath, dropTargetPath, handleDropFiles, manageApi]);

  const handleDropTargetChange = useCallback((path: string | null) => {
    setDropTargetPath((prev) => (prev === path ? prev : path));
  }, []);

  useEffect(() => {
    onUploadBusyChange?.(uploadBusy);
  }, [onUploadBusyChange, uploadBusy]);

  useEffect(() => () => onUploadBusyChange?.(false), [onUploadBusyChange]);

  // Declared before the cwd effect, so that one saves the set the user last saw.
  useEffect(() => {
    expandedPathsRef.current = expandedPaths;
  }, [expandedPaths]);

  // An explorer that unmounts (its cwd gone, then back) saves its folder's set too, so it comes back open.
  useEffect(() => () => {
    if (prevCwdRef.current !== null) expandedPathsByCwd.save(prevCwdRef.current, expandedPathsRef.current);
  }, []);

  useEffect(() => {
    const previousCwd = prevCwdRef.current;
    const cwdChanged = previousCwd !== cwd;
    prevCwdRef.current = cwd;

    // Swap the open directories only when cwd changes, not on refreshKey bumps.
    // The roots unmount while the new cwd loads, so each restored directory
    // mounts open and lists itself; one that is gone is never listed to look.
    if (cwdChanged) {
      if (previousCwd !== null) expandedPathsByCwd.save(previousCwd, expandedPathsRef.current);
      const restored = expandedPathsByCwd.restore(cwd);
      expandedPathsRef.current = restored;
      setExpandedPaths(restored);
      setHighlightedPaths(new Set());
      setRenamingPath(null);
      setCreatingIn(null);
      setMenu(null);
    }

    setLoading(cwdChanged);
    setError(null);
    let cancelled = false;
    fetchEntries(cwd, showHidden)
      .then((entries) => { if (!cancelled) setRoots(entries); })
      .catch((e) => { if (!cancelled) setError(errorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, refreshKey, treeRefreshKey, showHidden]);

  // Files changed outside pi-web (an editor, a terminal) show up once the
  // window is back in front (#1144).
  useEffect(() => {
    const refresh = () => setTreeRefreshKey((key) => key + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Aborting a replaced request also stops its scan on the server (#1584).
    const controller = new AbortController();
    fetchGitStatus(cwd, controller.signal)
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
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cwd, refreshKey, treeRefreshKey]);

  useEffect(() => {
    onChangesCountChange?.(gitFiles.length);
  }, [gitFiles, onChangesCountChange]);

  useEffect(() => {
    setChangesViewMode(loadChangesViewMode());
  }, []);

  const handleToggleChangesExpanded = useCallback((path: string, open: boolean) => {
    setCollapsedChangeDirs((prev) => {
      const next = new Set(prev);
      if (open) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const handleChangesViewModeToggle = useCallback(() => {
    setChangesViewMode((prev) => {
      const next: ChangesViewMode = prev === "list" ? "tree" : "list";
      saveChangesViewMode(next);
      return next;
    });
  }, []);



  return (
    <FileManageContext.Provider value={manageApi}>
    <div
      className={`file-tree${mobile ? " is-mobile" : ""}`}
      // A column at least the panel's height, so the drop hint's auto margin
      // can push it to the panel's bottom while the tree is shorter.
      style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}
      onDragEnter={handleExplorerDragEnter}
      onDragOver={handleExplorerDragOver}
      onDragLeave={handleExplorerDragLeave}
      onDrop={handleExplorerDrop}
    >
      <input ref={uploadInputRef} type="file" multiple hidden onChange={handleUploadInput} />
      <input ref={uploadFolderInputRef} type="file" hidden onChange={handleUploadInput} {...FOLDER_INPUT_PROPS} />
      {uploadBusy && (
        <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
        {(
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

        </div>
      )}

      {fileSearchOpen && (
      <div style={{ padding: "2px 8px 6px" }}>
        <div style={{ position: "relative" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)", pointerEvents: "none" }}>
            <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
          </svg>
          <input
            ref={searchInputRef}
            id="file-search-input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              // Handled here: the debug panel and other document listeners leave this Escape alone.
              event.preventDefault();
              onFileSearchOpenChange?.(false);
            }}
            placeholder={t("sidebar.searchFilesPlaceholder")}
            aria-label={t("sidebar.searchFiles")}
            style={{ width: "100%", boxSizing: "border-box", padding: "6px 24px", border: "1px solid var(--border)", borderRadius: 8, outline: "none", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11 }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              title={t("sidebar.clearSearch")}
              aria-label={t("sidebar.clearSearch")}
              style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, padding: 0, border: "none", borderRadius: 4, background: "none", color: "var(--text-dim)", cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          )}
        </div>
        {hasSearchQuery && (
          <div style={{ paddingTop: 3 }}>
            {searchLoading && <div role="status" style={{ padding: "6px 2px", fontSize: 10, color: "var(--text-dim)" }}>{t("sidebar.searchingFiles")}</div>}
            {!searchLoading && searchError && <div role="alert" style={{ padding: "6px 2px", fontSize: 10, color: "#f87171" }}>{t("i18n.networkError")}</div>}
            {!searchLoading && !searchError && searchPaths.length === 0 && <div style={{ padding: "6px 2px", fontSize: 10, color: "var(--text-dim)" }}>{t("sidebar.noMatchingFiles")}</div>}
            {!searchLoading && !searchError && searchPaths.length > 0 && (
              <div>
                {searchRoots.map((node) => (
                  <TreeNode
                    key={`${searchQuery}:${node.fullPath}`}
                    node={node}
                    depth={0}
                    cwd={cwd}
                    onOpenFile={onOpenFile}
                    onAtMention={onAtMention}
                    expandedPaths={searchExpanded}
                    onToggleExpanded={(fullPath, open) => {
                      setSearchExpanded((prev) => {
                        const next = new Set(prev);
                        if (open) next.add(fullPath); else next.delete(fullPath);
                        return next;
                      });
                    }}
                    highlightedPaths={highlightedPaths}
                    gitStatusByPath={gitStatusByPath}
                    changedDirectoryPaths={changedDirectoryPaths}
                    dropTargetPath={dropTargetPath}
                    onDropFiles={handleDropFiles}
                    onDropTargetChange={handleDropTargetChange}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
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
            style={{ display: "flex", alignItems: "center", gap: 6, height: "var(--row-height-compact)", padding: "0 8px 0 10px", fontSize: 12 }}
          >
            <span style={{ color: "var(--text-dim)" }}>
              {t("files.changedCount", { count: gitFiles.length })}
            </span>
            <span style={{ color: GIT_STATUS_COLORS.added, fontFamily: "var(--font-mono)" }}>+{gitLineStats.additions}</span>
            <span style={{ color: GIT_STATUS_COLORS.deleted, fontFamily: "var(--font-mono)" }}>-{gitLineStats.deletions}</span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={handleChangesViewModeToggle}
              title={changesViewMode === "list" ? t("files.viewAsTree") : t("files.viewAsList")}
              aria-label={changesViewMode === "list" ? t("files.viewAsTree") : t("files.viewAsList")}
              aria-pressed={changesViewMode === "tree"}
              className="file-tree-view-toggle"
            >
              <ChangesViewToggleIcon mode={changesViewMode} />
            </button>
          </div>
          {changesViewMode === "tree" ? (
            <ChangesTreeRows
              nodes={changesTree}
              depth={0}
              cwd={cwd}
              statusByPath={changesByRelativePath}
              collapsedPaths={collapsedChangeDirs}
              onToggleExpanded={handleToggleChangesExpanded}
              onOpenFile={onOpenFile}
              onAtMention={onAtMention}
              t={t}
            />
          ) : (
            gitFiles.map((status) => (
              <ChangeRow
                key={status.filePath}
                status={status}
                cwd={cwd}
                onOpenFile={onOpenFile}
                onAtMention={onAtMention}
                t={t}
              />
            ))
          )}
        </div>
      )}

      {(changesCollapsed || gitFiles.length === 0) && (!fileSearchOpen || !hasSearchQuery) && (
        <div style={{ padding: "2px 4px" }}>
          {loading ? (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>{t("files.loading")}</div>
          ) : error ? (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "#f87171" }}>{error}</div>
          ) : (
            <NewFolderRow directory={cwd} depth={0} />
          )}
          {!loading && !error && (
            roots.map((node) => (
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
                showHidden={showHidden}
                dropTargetPath={dropTargetPath}
                onDropFiles={handleDropFiles}
                onDropTargetChange={handleDropTargetChange}
                t={t}
              />
            ))
          )}
          {!loading && !error && roots.length === 0 && (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>
              {t("files.noFiles")}
            </div>
          )}
        </div>
      )}
      {/* Last, pinned to the panel's bottom: at the top it pushed every row
          down as a drag came in, so the row under the pointer changed. The
          auto margin keeps it there below a short tree (sticky alone left it
          right under the last row, moving down as hovered folders opened);
          sticky keeps it in view below a long one. Drags pass through it to
          the row it covers. */}
      {fileDragActive && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "sticky",
            bottom: 0,
            zIndex: 1,
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 8px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
            fontSize: 11,
            color: "var(--accent)",
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <path d="M12 16V4" />
            <path d="m7 9 5-5 5 5" />
            <path d="M5 20h14" />
          </svg>
          {t(draggingPath ? "files.dropToMove" : "files.dropToUpload", {
            directory: dropTargetPath
              ? (getRelativeFilePath(dropTargetPath, cwd) || dropTargetPath)
              : (getFileName(cwd) || cwd),
          })}
        </div>
      )}
      <SidebarMenu
        open={menu !== null}
        anchor={menu?.anchor ?? null}
        sheet={mobile}
        ariaLabel={t("sidebar.fileActions")}
        title={menu?.node.name}
        items={menu?.askDelete ? undefined : menuItems}
        cancelLabel={t("sidebar.cancel")}
        focusCancel={Boolean(menu?.askDelete)}
        focusKey={menu?.askDelete ? "ask-delete" : "items"}
        onClose={() => setMenu(null)}
        returnFocusTo={menu?.opener ?? null}
      >
        {menu?.askDelete && (
          <SidebarMenuQuestion
            heading={t("files.deleteHeading", { name: menu.node.name })}
            headingTitle={menu.node.fullPath}
            notes={[t(menu.node.isDir ? "files.deleteFolderNote" : "files.deleteNote")]}
            confirmLabel={t("files.delete")}
            cancelLabel={t("sidebar.cancel")}
            sheet={mobile}
            onConfirm={() => {
              const { node } = menu;
              setMenu(null);
              deleteNode(node);
            }}
            onCancel={() => setMenu((current) => (current ? { ...current, askDelete: false } : current))}
          />
        )}
      </SidebarMenu>
    </div>
    </FileManageContext.Provider>
  );
});
