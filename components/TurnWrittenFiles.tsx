"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import type { WrittenFile } from "@/lib/turn-written-files";
import { getFileIcon } from "./FileIcons";
import { SplitPatchView } from "./SplitPatchView";

export function TurnWrittenFiles({ files, onOpenFile }: {
  files: WrittenFile[];
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  if (files.length === 0) return null;

  const expanded = files.find((file) => file.filePath === expandedPath);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
      <div aria-label={t("chat.filesWritten")} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {files.map(({ filePath, additions = 0, deletions = 0 }) => {
          const name = getFileName(filePath);
          const isExpanded = expandedPath === filePath;
          return (
            <span
              key={filePath}
              title={filePath}
              style={{
                display: "inline-flex",
                alignItems: "stretch",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: isExpanded ? "var(--bg-selected)" : "var(--bg-subtle)",
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-label={t(isExpanded ? "chat.hideTurnDiff" : "chat.showTurnDiff", { name })}
                onClick={() => setExpandedPath((current) => current === filePath ? null : filePath)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 8px",
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  color: "var(--text)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {getFileIcon(name, 12)}
                <span>{name}</span>
                {additions > 0 && (
                  <span style={{ color: "#006f30", fontSize: 11, fontWeight: 600 }}>+{additions}</span>
                )}
                {deletions > 0 && (
                  <span style={{ color: "#980e1e", fontSize: 11, fontWeight: 600 }}>-{deletions}</span>
                )}
              </button>
              <button
                type="button"
                title={t("chat.openWrittenFile", { name })}
                aria-label={t("chat.openWrittenFile", { name })}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenFile?.(filePath);
                }}
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 24,
                  border: "none",
                  borderLeft: "1px solid var(--border)",
                  background: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 3h6v6" />
                  <path d="M10 14 21 3" />
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                </svg>
              </button>
            </span>
          );
        })}
      </div>
      {expanded && (
        expanded.patch
          ? (
            <div style={{ border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
              <SplitPatchView text={expanded.patch} />
            </div>
          )
          : (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("chat.noTurnDiff")}
            </div>
          )
      )}
    </div>
  );
}
