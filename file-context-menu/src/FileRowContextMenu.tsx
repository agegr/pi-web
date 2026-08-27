"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { parseOpenWithConfig, resolveOpenWithTargets, openWithUrl, type OpenWithTarget } from "./open-with";

export interface FileNodeLite {
  name: string;
  fullPath: string;
  isDir: boolean;
}

export interface FileContextMenuAdapter {
  /** Launch external ("open in app"): reveal in the OS file manager, or open a
   *  URL scheme (vscode://, cursor://, zed://, custom editors). Optional: when
   *  absent the menu hides the "open in app" entry. */
  launchExternal?(payload: { action: "reveal"; path: string } | { action: "url"; url: string }): void;
  /** Copy text to the clipboard (defaults to navigator.clipboard). */
  copy?(text: string): void;
  /** Menu labels (the host supplies localized strings). */
  labels: {
    open: string;
    openInApp: string;
    copyRelative: string;
    copyAbsolute: string;
    download: string;
    /** Label by open-with target id (explorer / vscode / cursor / zed / custom:<id>). */
    openWith: Record<string, string>;
  };
}

function launchTarget(target: OpenWithTarget, path: string, adapter: FileContextMenuAdapter): void {
  if (target.kind === "reveal") {
    adapter.launchExternal?.({ action: "reveal", path });
  } else {
    const url = openWithUrl(target, path, parseOpenWithConfig(undefined));
    if (url !== undefined) adapter.launchExternal?.({ action: "url", url });
  }
}

/** Right-click context menu for a file/directory row (host-agnostic): open,
 *  open in app (external editors), copy relative/absolute path, download. */
export function FileRowContextMenu({ node, x, y, cwd, onOpen, onClose, adapter }: {
  node: FileNodeLite;
  x: number;
  y: number;
  cwd: string;
  onOpen?: () => void;
  onClose: () => void;
  adapter: FileContextMenuAdapter;
}) {
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const copyText = (text: string): void => {
    if (adapter.copy) { adapter.copy(text); }
    else { void navigator.clipboard?.writeText(text).catch(() => { /* clipboard unavailable */ }); }
    onClose();
  };
  const downloadFile = (): void => {
    const url = "/api/files/" + encodeURIComponent(node.fullPath) + "?type=download";
    const a = document.createElement("a");
    a.href = url; a.style.display = "none";
    document.body.appendChild(a); a.click(); a.remove();
    onClose();
  };
  const menuStyle: React.CSSProperties = {
    position: "fixed",
    top: typeof window !== "undefined" ? Math.max(8, Math.min(y, window.innerHeight - 180)) : y,
    left: typeof window !== "undefined" ? Math.max(8, Math.min(x, window.innerWidth - 220)) : x,
    zIndex: 3000,
    minWidth: 180,
    padding: 6,
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    boxShadow: "0 6px 24px rgba(0,0,0,0.12)",
    display: "flex",
    flexDirection: "column",
    fontSize: 12,
  };
  const itemStyle: React.CSSProperties = {
    position: "relative",
    display: "flex", alignItems: "center", gap: 8,
    padding: "6px 10px", border: "none", borderRadius: 6,
    background: "none", color: "var(--text)", cursor: "pointer",
    textAlign: "left", whiteSpace: "nowrap",
  };
  const submenuStyle: React.CSSProperties = {
    position: "absolute",
    left: "100%",
    top: -4,
    marginLeft: 2,
    minWidth: 150,
    padding: 6,
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    boxShadow: "0 6px 24px rgba(0,0,0,0.12)",
    display: "flex",
    flexDirection: "column",
    fontSize: 12,
  };
  const relPath = cwd ? node.fullPath.slice(node.fullPath.indexOf(cwd) + cwd.length + 1) : node.fullPath;
  const targets = resolveOpenWithTargets(parseOpenWithConfig(undefined));
  const L = adapter.labels;
  const content = (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 2999 }}
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div role="menu" style={menuStyle} onContextMenu={(e) => e.preventDefault()}>
        {!node.isDir && onOpen !== undefined && (
          <button type="button" role="menuitem" style={itemStyle} onClick={() => { onOpen(); onClose(); }}>
            <span>▸</span>{L.open}
          </button>
        )}
        {!node.isDir && adapter.launchExternal !== undefined && targets.length > 0 && (
          <div
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenuOpen}
            style={itemStyle}
            onMouseEnter={() => setSubmenuOpen(true)}
            onMouseLeave={() => setSubmenuOpen(false)}
            onClick={() => setSubmenuOpen((v) => !v)}
          >
            <span>↗</span>
            <span style={{ flex: 1 }}>{L.openInApp}</span>
            <span style={{ color: "var(--text-dim)" }}>›</span>
            {submenuOpen && (
              <div role="menu" style={submenuStyle}>
                {targets.map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    role="menuitem"
                    style={itemStyle}
                    onClick={() => { launchTarget(target, node.fullPath, adapter); onClose(); }}
                  >
                    <span>{target.id === "explorer" ? "🗀" : target.id === "vscode" ? "⌨" : target.id === "cursor" ? "⌖" : "▣"}</span>
                    <span>{L.openWith[target.id] ?? target.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button type="button" role="menuitem" style={itemStyle} onClick={() => copyText(relPath)}>
          <span>⧉</span>{L.copyRelative}
        </button>
        <button type="button" role="menuitem" style={itemStyle} onClick={() => copyText(node.fullPath)}>
          <span>⧉</span>{L.copyAbsolute}
        </button>
        {!node.isDir && (
          <button type="button" role="menuitem" style={itemStyle} onClick={downloadFile}>
            <span>↓</span>{L.download}
          </button>
        )}
      </div>
    </>
  );

  if (typeof document !== "undefined") {
    return createPortal(content, document.body);
  }
  return content;
}
