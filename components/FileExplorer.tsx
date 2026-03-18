"use client";

import { useState, useCallback, useEffect } from "react";
import { getFileIcon, FolderIcon } from "./FileIcons";

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
  onOpenFile: (filePath: string, fileName: string) => void;
  refreshKey?: number;
}



function TreeNode({
  node,
  depth,
  onOpenFile,
}: {
  node: FileNode;
  depth: number;
  onOpenFile: (filePath: string, fileName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);

  const loadChildren = useCallback(async () => {
    if (loaded) return;
    setLoading(true);
    try {
      const encoded = node.fullPath.split("/").filter(Boolean).join("/");
      const res = await fetch(`/api/files/${encoded}?type=list`);
      if (!res.ok) return;
      const data = await res.json() as { entries: FileEntry[] };
      setChildren(
        data.entries.map((e) => ({
          name: e.name,
          fullPath: node.fullPath.replace(/\/$/, "") + "/" + e.name,
          isDir: e.isDir,
          size: e.size,
          children: e.isDir ? [] : undefined,
          loaded: !e.isDir,
        }))
      );
      setLoaded(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [loaded, node.fullPath]);

  const handleClick = useCallback(() => {
    if (node.isDir) {
      if (!loaded && !open) loadChildren();
      setOpen((v) => !v);
    } else {
      onOpenFile(node.fullPath, node.name);
    }
  }, [node.isDir, node.fullPath, node.name, loaded, open, loadChildren, onOpenFile]);

  return (
    <div>
      <div
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          height: 24,
          cursor: "pointer",
          background: hovered ? "var(--bg-hover)" : "transparent",
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
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
          {node.isDir ? <FolderIcon size={14} open={open} /> : getFileIcon(node.name, 14)}
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
          title={node.fullPath}
        >
          {node.name}
        </span>
        {loading && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
          </svg>
        )}
      </div>
      {node.isDir && open && (
        <div>
          {children.map((child) => (
            <TreeNode key={child.fullPath} node={child} depth={depth + 1} onOpenFile={onOpenFile} />
          ))}
          {children.length === 0 && loaded && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14, fontSize: 11, color: "var(--text-dim)", height: 22, display: "flex", alignItems: "center" }}>
              empty
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FileExplorer({ cwd, onOpenFile, refreshKey }: Props) {
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [treeKey, setTreeKey] = useState(0);

  useEffect(() => {
    setTreeKey((k) => k + 1);
  }, [refreshKey]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const encoded = cwd.split("/").filter(Boolean).join("/");
    fetch(`/api/files/${encoded}?type=list`)
      .then((r) => r.json())
      .then((data: { entries?: FileEntry[]; error?: string }) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setRoots(
          (data.entries ?? []).map((e) => ({
            name: e.name,
            fullPath: cwd.replace(/\/$/, "") + "/" + e.name,
            isDir: e.isDir,
            size: e.size,
            children: e.isDir ? [] : undefined,
            loaded: !e.isDir,
          }))
        );
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [cwd, treeKey]);

  if (loading) {
    return (
      <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>
        Loading files...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "8px 12px", fontSize: 11, color: "#f87171" }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ padding: "2px 4px" }}>
      {roots.map((node) => (
        <TreeNode key={`${treeKey}:${node.fullPath}`} node={node} depth={0} onOpenFile={onOpenFile} />
      ))}
      {roots.length === 0 && (
        <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>
          No files found
        </div>
      )}
    </div>
  );
}
