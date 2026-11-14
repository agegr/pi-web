"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/i18n/format";
import { projectNameOf } from "@/lib/session-tree";
import { sideChatHit } from "@/lib/session-search-hit";
import type { SessionInfo } from "@/lib/types";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import type { SessionSearchResponse } from "@/lib/session-search";

export function SessionSearch({ open, query, children, selectedSessionId, onSelectSession, onSelectSideChat, sessions, archivedSessionIds, projectNames }: {
  open: boolean;
  query: string;
  children: ReactNode;
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, entryId?: string, blockIndex?: number) => void;
  /** Picking a side chat's hit: its parent's chat opens, then the side chat's tab. */
  onSelectSideChat?: (session: SessionInfo) => void;
  /** Every listed session: a side chat's hit names the parent it belongs to. */
  sessions?: readonly SessionInfo[];
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
      {response?.results.map(({ session, entryId, blockIndex, titleMatch, before, match, after }) => {
        const side = session.relation?.kind === "side" ? session.relation : null;
        const parent = side ? sessions?.find((item) => item.id === side.parentSessionId) : undefined;
        const parentTitle = parent?.name || parent?.firstMessage || undefined;
        // A side chat's own title: its first message is the parent's question.
        const sideLabel = side && sessions ? sideChatHit(session, sessions, t("agentSwitcher.sideChat"))?.label : null;
        const title = sideLabel ?? session.name ?? session.firstMessage;
        return (
          <button
            key={session.id}
            type="button"
            onClick={() => side && onSelectSideChat ? onSelectSideChat(session) : onSelectSession(session, entryId, blockIndex)}
            aria-current={session.id === selectedSessionId ? "true" : undefined}
            className={`block w-full cursor-pointer border-b border-border px-3 py-2 text-left hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent ${session.id === selectedSessionId ? "bg-bg-selected" : ""}`}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-xs font-medium text-text">
                {titleMatch ? <>{before}<mark className="rounded-sm bg-accent/20 text-text">{match}</mark>{after}</> : title}
              </span>
              {archivedSessionIds?.has(session.id) && (
                <span className="shrink-0 rounded-[4px] border border-border px-1 text-[10px] leading-[14px] text-text-dim">{t("sidebar.archived")}</span>
              )}
            </span>
            {side && (
              <span className="mt-1 block truncate text-[10px] text-text-dim" title={parentTitle}>
                {parentTitle ? t("sidebar.sideChatOf", { name: parentTitle }) : t("agentSwitcher.sideChat")}
              </span>
            )}
            <span className="mt-1 flex min-w-0 gap-2 text-[10px] text-text-dim">
              <span className="min-w-0 flex-1 truncate" title={session.cwd}>
                <span className="font-medium text-text-muted">{projectLabelOf(session)}</span>
                {session.cwd !== (session.projectRoot ?? session.cwd) && ` · ${session.cwd}`}
              </span>
              <span className="shrink-0">{formatRelativeTime(session.modified, locale)}</span>
            </span>
            {!titleMatch && (
              <span className="mt-1 block text-xs leading-relaxed wrap-anywhere text-text-muted">
                {before}<mark className="rounded-sm bg-accent/20 text-text">{match}</mark>{after}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
