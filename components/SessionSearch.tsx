"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/i18n/format";
import { projectNameOf } from "@/lib/session-tree";
import type { SessionInfo } from "@/lib/types";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import type { SessionSearchResponse, SessionSearchResult } from "@/lib/session-search";

// Server sends every term's range as offsets into the snippet it built, so an AND
// query marks each word; a payload without ranges (older server) marks `match`.
function SearchSnippet({ before, match, after, highlights }: Pick<SessionSearchResult, "before" | "match" | "after" | "highlights">) {
  const text = before + match + after;
  const ranges = highlights?.length ? highlights : [{ start: before.length, end: before.length + match.length }];
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(<mark key={range.start} className="rounded-sm bg-accent/20 text-text">{text.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function SessionSearch({ open, query, children, selectedSessionId, onSelectSession, archivedSessionIds, projectNames }: {
  open: boolean;
  query: string;
  children: ReactNode;
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, entryId?: string, blockIndex?: number) => void;
  /** Ids of every session in an archived family: their results are tagged, not hidden. */
  archivedSessionIds?: ReadonlySet<string>;
  /** The sidebar's project display names, by project key: a hit names its project like the tree's groups do. */
  projectNames?: Readonly<Record<string, string>>;
}) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<{ query: string; response?: SessionSearchResponse; failed?: boolean }>({ query: "" });
  const search = query.trim();
  const response = state.query === search ? state.response : undefined;
  const failed = state.query === search && state.failed;

  const projectLabelOf = (session: SessionInfo) => {
    const key = workspaceKeyOf(session);
    const root = session.projectRoot ?? session.cwd;
    return projectNames && Object.hasOwn(projectNames, key) ? projectNames[key] : projectNameOf(root);
  };

  // Re-runs only when the query changes. It deliberately does not depend on the
  // session-list version: ordinary agent activity bumps that version every few
  // seconds, which used to refetch (and re-order) results while they were being
  // read.
  useEffect(() => {
    if (!open || !search) return;
    const controller = new AbortController();
    setState({ query: search });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sessions/search?${new URLSearchParams({ q: search })}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as SessionSearchResponse;
        if (!controller.signal.aborted) setState({ query: search, response: data });
      } catch {
        if (!controller.signal.aborted) setState({ query: search, failed: true });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, search]);

  return !open || !search ? children : (
    <div className="min-h-20 flex-1 overflow-y-auto" aria-busy={!response && !failed}>
      <div role="status" className="px-3 py-2 text-xs text-text-muted">
        {failed ? t("sidebar.sessionSearchFailed") : !response ? t("sidebar.sessionSearching")
          : response.results.length === 0 ? t("sidebar.sessionSearchEmpty")
          : t("sidebar.sessionSearchCount", { count: response.results.length })}
      </div>
      {response?.truncated && (
        <div role="status" className="px-3 pb-2 text-xs text-text-muted">{t("sidebar.sessionSearchPartial")}</div>
      )}
      {response?.results.map(({ session, entryId, blockIndex, titleMatch, before, match, after, highlights }) => (
        <button
          key={session.id}
          type="button"
          onClick={() => onSelectSession(session, entryId, blockIndex)}
          aria-current={session.id === selectedSessionId ? "true" : undefined}
          className={`block w-full cursor-pointer border-b border-border px-3 py-2 text-left hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent ${session.id === selectedSessionId ? "bg-bg-selected" : ""}`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-xs font-medium text-text">
              {titleMatch ? <SearchSnippet before={before} match={match} after={after} highlights={highlights} /> : session.name || session.firstMessage}
            </span>
            {archivedSessionIds?.has(session.id) && (
              <span className="shrink-0 rounded-[4px] border border-border px-1 text-[10px] leading-[14px] text-text-dim">{t("sidebar.archived")}</span>
            )}
          </span>
          <span className="mt-1 flex min-w-0 gap-2 text-[10px] text-text-dim">
            <span className="min-w-0 flex-1 truncate" title={session.cwd}>
              <span className="font-medium text-text-muted">{projectLabelOf(session)}</span>
              {session.cwd !== (session.projectRoot ?? session.cwd) && ` · ${session.cwd}`}
            </span>
            <span className="shrink-0">{formatRelativeTime(session.modified, locale)}</span>
          </span>
          {!titleMatch && (
            <span className="mt-1 block text-xs leading-relaxed wrap-anywhere text-text-muted">
              <SearchSnippet before={before} match={match} after={after} highlights={highlights} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
