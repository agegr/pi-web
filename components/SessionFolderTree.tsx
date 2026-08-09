"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import type { SessionFolder, SessionFolderStore } from "@/lib/session-folders";
import { useI18n } from "@/hooks/useI18n";
import { buildSessionTree, SessionTreeItem } from "./SessionTreeItem";

interface Props {
  sessions: SessionInfo[];
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
}

interface FolderTreeNode {
  folder: SessionFolder;
  children: FolderTreeNode[];
}

function buildFolderTree(folders: SessionFolder[]): FolderTreeNode[] {
  const byParent = new Map<string | null, SessionFolder[]>();
  for (const f of folders) {
    const list = byParent.get(f.parentId) ?? [];
    list.push(f);
    byParent.set(f.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);

  const build = (parentId: string | null): FolderTreeNode[] =>
    (byParent.get(parentId) ?? []).map((folder) => ({ folder, children: build(folder.id) }));
  return build(null);
}

function FolderIcon({ size = 13, open }: { size?: number; open?: boolean }) {
  return open ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v0H5.5a2 2 0 0 0-2 1.6L2 17V7Z" />
      <path d="m2 17 1.4-6.4A2 2 0 0 1 5.4 9H21l-1.6 6.4A2 2 0 0 1 17.4 17H2Z" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

/** Inline "type a name, Enter to confirm" row, used for both new folders and
 *  new subfolders — mirrors the worktree-creation input already in this sidebar. */
function InlineNameInput({
  placeholder,
  indent = 0,
  busy,
  onCancel,
  onSubmit,
}: {
  placeholder: string;
  indent?: number;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div style={{ padding: "4px 10px", paddingLeft: 14 + indent }}>
      <input
        ref={inputRef}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => { if (value.trim()) onSubmit(value); else onCancel(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); if (value.trim()) onSubmit(value); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        placeholder={placeholder}
        style={{
          width: "100%",
          fontSize: 12,
          padding: "5px 8px",
          border: "1px solid var(--accent)",
          borderRadius: 5,
          outline: "none",
          background: "var(--bg)",
          color: "var(--text)",
          height: 30,
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function FolderRowActionButton({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 26, height: 26, padding: 0, flexShrink: 0,
        background: "none", border: "none",
        color: "var(--text-dim)", cursor: "pointer",
        borderRadius: 5,
        transition: "color 0.12s, background 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = danger ? "#ef4444" : "var(--accent)";
        e.currentTarget.style.background = danger ? "rgba(239,68,68,0.08)" : "var(--bg-selected)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--text-dim)";
        e.currentTarget.style.background = "none";
      }}
    >
      {children}
    </button>
  );
}

function FolderNode({
  node,
  depth,
  sessionsByFolder,
  allFolders,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  assignments,
  onMoveSession,
  onCreateSubfolder,
  onRenameFolder,
  onDeleteFolder,
}: {
  node: FolderTreeNode;
  depth: number;
  sessionsByFolder: Map<string, SessionInfo[]>;
  allFolders: SessionFolder[];
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  assignments: Record<string, string>;
  onMoveSession: (sessionId: string, folderId: string | null) => void;
  onCreateSubfolder: (parentId: string, name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.folder.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingSubfolder, setAddingSubfolder] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) requestAnimationFrame(() => renameInputRef.current?.select());
  }, [renaming]);

  const indent = depth * 12;
  const sessionsHere = sessionsByFolder.get(node.folder.id) ?? [];
  const sessionTree = buildSessionTree(sessionsHere);

  const commitRename = useCallback(() => {
    setRenaming(false);
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== node.folder.name) onRenameFolder(node.folder.id, trimmed);
  }, [renameValue, node.folder.id, node.folder.name, onRenameFolder]);

  return (
    <div>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 34,
          paddingLeft: 14 + indent,
          paddingRight: 8,
          cursor: "pointer",
          background: confirmDelete ? "rgba(239,68,68,0.06)" : hovered ? "var(--bg-hover)" : "transparent",
        }}
        onClick={() => { if (!renaming && !confirmDelete) setCollapsed((v) => !v); }}
      >
        <svg
          width="9" height="9" viewBox="0 0 10 10" fill="none"
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          style={{ color: "var(--text-dim)", transform: collapsed ? "none" : "rotate(90deg)", transition: "transform 0.15s", flexShrink: 0 }}
        >
          <polyline points="3 2 7 5 3 8" />
        </svg>
        <span style={{ color: "var(--text-dim)", flexShrink: 0, display: "flex" }}>
          <FolderIcon open={!collapsed} />
        </span>
        {renaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            autoFocus
            style={{
              flex: 1, fontSize: 12, padding: "3px 6px",
              border: "1px solid var(--accent)", borderRadius: 5, outline: "none",
              background: "var(--bg)", color: "var(--text)", height: 24,
            }}
          />
        ) : confirmDelete ? (
          <>
            <span style={{ flex: 1, fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t("sidebar.folders.deleteConfirm", { name: node.folder.name })}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onDeleteFolder(node.folder.id); }}
              style={{ padding: "3px 9px", background: "#ef4444", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
            >
              {t("sidebar.delete")}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
              style={{ padding: "3px 9px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
            >
              {t("sidebar.cancel")}
            </button>
          </>
        ) : (
          <>
            <span style={{ flex: 1, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {node.folder.name}
            </span>
            {hovered && (
              <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                <FolderRowActionButton
                  title={t("sidebar.folders.newSubfolder")}
                  onClick={(e) => { e.stopPropagation(); setCollapsed(false); setAddingSubfolder(true); }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="6" y1="1" x2="6" y2="11" />
                    <line x1="1" y1="6" x2="11" y2="6" />
                  </svg>
                </FolderRowActionButton>
                <FolderRowActionButton
                  title={t("sidebar.rename")}
                  onClick={(e) => { e.stopPropagation(); setRenameValue(node.folder.name); setRenaming(true); }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                </FolderRowActionButton>
                <FolderRowActionButton
                  title={t("sidebar.delete")}
                  danger
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </FolderRowActionButton>
              </div>
            )}
          </>
        )}
      </div>

      {addingSubfolder && (
        <InlineNameInput
          indent={indent + 12}
          placeholder={t("sidebar.folders.namePlaceholder")}
          onCancel={() => setAddingSubfolder(false)}
          onSubmit={(name) => { onCreateSubfolder(node.folder.id, name); setAddingSubfolder(false); }}
        />
      )}

      {!collapsed && (
        <div>
          {node.children.map((child) => (
            <FolderNode
              key={child.folder.id}
              node={child}
              depth={depth + 1}
              sessionsByFolder={sessionsByFolder}
              allFolders={allFolders}
              selectedSessionId={selectedSessionId}
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              assignments={assignments}
              onMoveSession={onMoveSession}
              onCreateSubfolder={onCreateSubfolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
            />
          ))}
          {sessionTree.map((treeNode) => (
            <SessionTreeItem
              key={treeNode.session.id}
              node={treeNode}
              depth={0}
              indent={indent + 12}
              selectedSessionId={selectedSessionId}
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              folders={allFolders}
              assignments={assignments}
              onMoveToFolder={onMoveSession}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Groups the flat session list into folders for display. This is purely a
 * presentation layer on top of `~/.pi/agent/session-folders.json` — nothing
 * here ever reads or writes a session's .jsonl file. Deleting a folder only
 * removes the grouping (see the API route); a session is never deleted by
 * anything in this component.
 */
export function SessionFolderTree({
  sessions,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
}: Props) {
  const { t } = useI18n();
  const [folders, setFolders] = useState<SessionFolder[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/session-folders");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as SessionFolderStore;
      setFolders(data.folders ?? []);
      setAssignments(data.assignments ?? {});
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadedOnce(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createFolder = useCallback(async (name: string, parentId: string | null) => {
    try {
      const res = await fetch("/api/session-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [refresh]);

  const renameFolder = useCallback(async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/session-folders/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [refresh]);

  const deleteFolder = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/session-folders/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [refresh]);

  // Optimistic — the row moves immediately; a failed request is reconciled
  // by the next refresh() rather than blocking the click.
  const moveSession = useCallback((sessionId: string, folderId: string | null) => {
    setAssignments((prev) => {
      const next = { ...prev };
      if (folderId === null) delete next[sessionId];
      else next[sessionId] = folderId;
      return next;
    });
    fetch("/api/session-folders/assignments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, folderId }),
    }).catch(() => { /* best effort; reconciled on next refresh() */ });
  }, []);

  const folderIds = new Set(folders.map((f) => f.id));
  const sessionsByFolder = new Map<string, SessionInfo[]>();
  const unfiled: SessionInfo[] = [];
  for (const s of sessions) {
    const folderId = assignments[s.id];
    if (folderId && folderIds.has(folderId)) {
      const list = sessionsByFolder.get(folderId) ?? [];
      list.push(s);
      sessionsByFolder.set(folderId, list);
    } else {
      unfiled.push(s);
    }
  }
  const folderTree = buildFolderTree(folders);
  const unfiledTree = buildSessionTree(unfiled);

  if (loadedOnce && folders.length === 0 && sessions.length === 0 && !error) {
    return (
      <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
        {t("sidebar.noSessions")}
      </div>
    );
  }

  return (
    <div>
      <div style={{ padding: "4px 10px 2px" }}>
        {!newFolderOpen ? (
          <button
            onClick={() => setNewFolderOpen(true)}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 8px", background: "none", border: "none",
              color: "var(--text-dim)", cursor: "pointer", fontSize: 11,
              borderRadius: 5,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="1" x2="6" y2="11" />
              <line x1="1" y1="6" x2="11" y2="6" />
            </svg>
            {t("sidebar.folders.new")}
          </button>
        ) : (
          <InlineNameInput
            placeholder={t("sidebar.folders.namePlaceholder")}
            onCancel={() => setNewFolderOpen(false)}
            onSubmit={(name) => { void createFolder(name, null); setNewFolderOpen(false); }}
          />
        )}
      </div>

      {error && (
        <div style={{ padding: "4px 14px 8px", color: "#f87171", fontSize: 11 }}>{error}</div>
      )}

      {folderTree.map((node) => (
        <FolderNode
          key={node.folder.id}
          node={node}
          depth={0}
          sessionsByFolder={sessionsByFolder}
          allFolders={folders}
          selectedSessionId={selectedSessionId}
          runningSessionIds={runningSessionIds}
          unreadSessionIds={unreadSessionIds}
          onSelectSession={onSelectSession}
          onRenamed={onRenamed}
          onSessionDeleted={onSessionDeleted}
          assignments={assignments}
          onMoveSession={moveSession}
          onCreateSubfolder={(parentId, name) => void createFolder(name, parentId)}
          onRenameFolder={(id, name) => void renameFolder(id, name)}
          onDeleteFolder={(id) => void deleteFolder(id)}
        />
      ))}

      {unfiled.length > 0 && (
        <div>
          {folders.length > 0 && (
            <div style={{ padding: "10px 14px 4px", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-dim)" }}>
              {t("sidebar.folders.unfiled")}
            </div>
          )}
          {unfiledTree.map((treeNode) => (
            <SessionTreeItem
              key={treeNode.session.id}
              node={treeNode}
              depth={0}
              selectedSessionId={selectedSessionId}
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              folders={folders}
              assignments={assignments}
              onMoveToFolder={moveSession}
            />
          ))}
        </div>
      )}
    </div>
  );
}
