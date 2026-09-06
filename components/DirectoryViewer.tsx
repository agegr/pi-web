"use client";

import { useEffect, useState } from "react";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { useI18n } from "@/hooks/useI18n";

interface Entry { name: string; isDir: boolean }

export function DirectoryViewer({ filePath, onOpenFile }: {
  filePath: string;
  onOpenFile?: (path: string) => void;
}) {
  const { t } = useI18n();
  const [result, setResult] = useState<{ path: string; entries?: Entry[]; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/files/${encodeFilePathForApi(filePath)}?type=list`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? response.statusText);
        if (!controller.signal.aborted) setResult({ path: filePath, entries: data.entries });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ path: filePath, error: String(error) });
      });
    return () => controller.abort();
  }, [filePath]);

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 16 }}>
      <div style={{ fontFamily: "var(--font-mono)", overflowWrap: "anywhere", marginBottom: 16 }} title={filePath}>{filePath}</div>
      {result?.path !== filePath ? <div>{t("files.loading")}</div> : result.error ? (
        <div role="alert" style={{ color: "var(--text-muted)" }}>{result.error}</div>
      ) : (
        <div>
          {result.entries?.length === 0 && <div style={{ color: "var(--text-muted)" }}>{t("files.noFiles")}</div>}
          {result.entries?.map((entry) => {
            const childPath = `${filePath.replace(/[\\/]+$/, "")}/${entry.name}`;
            return (
              <button key={entry.name} type="button" className="directory-viewer-entry" title={childPath}
                disabled={!onOpenFile} onClick={() => onOpenFile?.(childPath)}>
                {entry.isDir ? <FolderIcon size={16} /> : getFileIcon(entry.name, 16)}
                <span>{entry.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
