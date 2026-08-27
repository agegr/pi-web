/**
 * NativeFilesTab — the "Files" tab content for the embedded BetterSidebarHost.
 * Uses pi-web's own FileExplorer (file tree) and FileViewer (read-only preview)
 * instead of the CodeMirror chunk-loaded editor, eliminating the
 * "[dsh-better-sidebar] chunk "editor": client module system unavailable" error.
 *
 * When a file is clicked:
 *   - if the host provided onOpenFile, the file is opened in the native
 *     right-panel FileViewer tab (AppShell's tab strip)
 *   - otherwise it falls back to an inline preview inside this panel
 */
"use client";

import { useState, useCallback, useRef } from "react";
import {
  FileExplorer,
  type FileExplorerHandle,
} from "@/components/FileExplorer";
import { FileViewer } from "@/components/FileViewer";

interface NativeFilesTabProps {
  cwd: string;
  sessionId?: string;
  /** Called when user clicks a file — opens it in AppShell's native right panel. */
  onOpenFile?: (
    filePath: string,
    fileName: string,
    options?: { sourceSessionId?: string | null },
  ) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
}

export function NativeFilesTab({
  cwd,
  sessionId,
  onOpenFile,
  onAtMention,
}: NativeFilesTabProps) {
  // Inline preview state — used only when onOpenFile is not provided
  const [inlineFile, setInlineFile] = useState<string | null>(null);
  const explorerRef = useRef<FileExplorerHandle>(null);

  const handleOpenFile = useCallback(
    (
      filePath: string,
      fileName: string,
      options?: { sourceSessionId?: string | null },
    ) => {
      if (onOpenFile) {
        onOpenFile(filePath, fileName, {
          sourceSessionId: sessionId ?? null,
          ...options,
        });
      } else {
        // Inline fallback: show preview inside this panel
        setInlineFile(filePath);
      }
    },
    [onOpenFile, sessionId],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* File tree */}
      <div
        style={{
          flex: inlineFile && !onOpenFile ? "0 0 240px" : "1 1 auto",
          overflow: "auto",
          borderBottom:
            inlineFile && !onOpenFile ? "1px solid var(--border)" : undefined,
        }}
      >
        <FileExplorer
          ref={explorerRef}
          cwd={cwd}
          onOpenFile={handleOpenFile}
          changesCollapsed={false}
          onAtMention={onAtMention}
        />
      </div>

      {/* Inline preview — only rendered when no native right-panel handler */}
      {inlineFile && !onOpenFile && (
        <div
          style={{ flex: "1 1 auto", overflow: "auto", position: "relative" }}
        >
          <button
            type="button"
            onClick={() => setInlineFile(null)}
            style={{
              position: "absolute",
              top: 6,
              right: 8,
              zIndex: 1,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "2px 8px",
              cursor: "pointer",
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            ✕
          </button>
          <FileViewer
            filePath={inlineFile}
            cwd={cwd}
            sourceSessionId={sessionId ?? null}
            onAtMention={onAtMention}
          />
        </div>
      )}
    </div>
  );
}
