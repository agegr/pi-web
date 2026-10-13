"use client";

import { useState } from "react";
import { formatUpdatedTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";
import {
  readSessionFileFilter,
  SESSION_FILE_FILTERS,
  sessionFileLocation,
  writeSessionFileFilter,
  type SessionFileFilter,
  type SessionWrittenFile,
} from "@/lib/session-written-files";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  files: SessionWrittenFile[];
  cwd?: string;
  locale: Locale;
  translate: Translate;
  onOpenFile: (filePath: string) => void;
  onRetry?: () => void;
}

function getFilterStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function SessionFilesPanel({ files, cwd, locale, translate, onOpenFile, onRetry }: Props) {
  const [filter, setFilter] = useState<SessionFileFilter>(() => readSessionFileFilter(
    getFilterStorage(),
  ));
  const selectFilter = (next: SessionFileFilter) => {
    setFilter(next);
    writeSessionFileFilter(getFilterStorage(), next);
  };
  const visible = filter === "all" ? files : files.filter((file) => file.kind === filter);

  return (
    <div className="session-files-panel" style={{
      background: "var(--bg-panel)",
      borderBottom: "1px solid var(--border)",
      boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
    }}>
      <style>{`
        .session-files-panel .filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px 0; }
        .session-files-panel .filter {
          border: 1px solid var(--border); background: transparent; color: var(--text-muted);
          border-radius: 999px; padding: 2px 8px; font-size: 11px; cursor: pointer;
        }
        .session-files-panel .filter[aria-pressed="true"] {
          background: var(--bg-selected); color: var(--text); border-color: transparent;
        }
        .session-files-panel .filter:disabled { opacity: 0.4; cursor: default; }
        .session-files-panel .row {
          width: 100%; text-align: left; border: none; border-bottom: 1px solid var(--border);
          background: transparent; color: inherit; padding: 8px 12px; cursor: pointer;
          display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center;
        }
        .session-files-panel .row:hover { background: var(--bg-hover); }
        .session-files-panel .name { font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .session-files-panel .dir { font-size: 11px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .session-files-panel .meta { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; font-size: 11px; color: var(--text-muted); }
      `}</style>
      <div style={{ padding: "10px 12px 0", fontSize: 12, color: "var(--text)" }}>{translate("sessionFiles.title")}</div>
      {onRetry ? (
        <div role="status" style={{ padding: "12px", fontSize: 12 }}>
          <p>{translate("sessionFiles.loadError")}</p>
          <button type="button" className="retry" onClick={onRetry}>{translate("sessionFiles.retry")}</button>
        </div>
      ) : <>
      <div className="filters">
        {SESSION_FILE_FILTERS.map((kind) => {
          const count = kind === "all" ? files.length : files.filter((file) => file.kind === kind).length;
          return (
            <button
              key={kind}
              type="button"
              className="filter"
              aria-pressed={filter === kind}
              disabled={count === 0}
              onClick={() => selectFilter(kind)}
            >
              {translate(`sessionFiles.filter.${kind}`)} {count}
            </button>
          );
        })}
      </div>
      {visible.length === 0 ? (
        <div style={{ padding: "12px", fontSize: 12, color: "var(--text-muted)" }}>
          {translate(files.length === 0 ? "sessionFiles.empty" : "sessionFiles.filterEmpty")}
        </div>
      ) : (
        <div>
          {visible.map((file) => {
            const location = sessionFileLocation(file.filePath, cwd);
            const sessionTime = typeof file.sessionWrittenAtMs === "number"
              ? formatUpdatedTime(file.sessionWrittenAtMs, locale)
              : "";
            return (
              <button
                key={file.filePath}
                type="button"
                className="row"
                title={file.filePath}
                onClick={() => onOpenFile(file.filePath)}
              >
                <span style={{ minWidth: 0 }}>
                  <span className="name">{location.name}</span>
                  {location.directory && <span className="dir">{location.directory}</span>}
                </span>
                <span className="meta">
                  <span>{translate(`sessionFiles.kind.${file.kind}`)}</span>
                  {file.writeCount > 1 && <span>{translate("sessionFiles.writes", { count: file.writeCount })}</span>}
                  {sessionTime && <span>{translate("sessionFiles.sessionTime", { time: sessionTime })}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      </>}
    </div>
  );
}
