"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageView } from "./MessageView";
import { StatusIcon, statusColor } from "./AgentSessionPanel";
import { buildToolResultsMap, EMPTY_TRANSCRIPT, mergeTailPage, prependOlderPage, type SubagentTranscript } from "./subagent-viewer-state";
import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo } from "@/lib/types";

interface Props {
  sessionId: string;
  /** Label from the subagent tool call (`description || profile`), used until the session info loads. */
  fallbackLabel: string;
  running: boolean;
  onOpenFile: (filePath: string, page?: number) => void;
}

const POLL_MS = 2000;
const TAIL = 100;

function contextUrl(sessionId: string, before?: string): string {
  const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1", tail: String(TAIL) });
  if (before) params.set("before", before);
  return `/api/sessions/${encodeURIComponent(sessionId)}/context?${params}`;
}

function toTranscript(page: Partial<SubagentTranscript>): SubagentTranscript {
  return {
    messages: page.messages ?? [],
    entryIds: page.entryIds ?? [],
    oldestEntryId: page.oldestEntryId ?? null,
    hasMore: Boolean(page.hasMore),
  };
}

/**
 * Read-only view of a subagent's session, rendered in a right-panel tab.
 *
 * Live updates deliberately poll the context endpoint instead of opening the
 * agent SSE stream: `GET /api/sessions/[id]/context` serves the in-memory
 * entries of a running wrapper (or the file once it settles) without ever
 * spawning a wrapper, so a viewer tab can never resurrect or interfere with a
 * subagent run. Entry-level granularity: pi appends each finished entry
 * synchronously, so a 2 s poll shows the run at message/tool-call resolution.
 */
export function SubagentViewer({ sessionId, fallbackLabel, running, onOpenFile }: Props) {
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [label, setLabel] = useState(fallbackLabel);
  const [transcript, setTranscript] = useState<SubagentTranscript>(EMPTY_TRANSCRIPT);
  const { messages, entryIds, oldestEntryId, hasMore } = transcript;
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Session info on open, when the run starts or ends (the persisted status
  // takes over from the live flag), and on manual refresh: label, cwd, status.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (res.status === 404) return; // keep the fallback label; the context poll reports "starting"
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { info?: SessionInfo; error?: string };
        if (!data.info) throw new Error(data.error ?? `HTTP ${res.status}`);
        setInfo(data.info);
        setLabel(data.info.name || data.info.firstMessage || fallbackLabel);
      } catch {
        /* non-fatal: the context view below is the primary content */
      }
    })();
    return () => controller.abort();
  }, [sessionId, running, refreshKey, fallbackLabel]);

  // Initial context load; while the subagent runs, poll for new entries. Each
  // poll is the newest page, folded into the older pages already loaded.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      // One request at a time: a slow answer must not land after a newer one.
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(contextUrl(sessionId), { signal: controller.signal, cache: "no-store" });
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { context: Partial<SubagentTranscript> };
        if (cancelled) return;
        setNotFound(false);
        setError(null);
        setTranscript((current) => mergeTailPage(current, toTranscript(data.context)));
      } catch (err) {
        if (!cancelled && !(err instanceof Error && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        inFlight = false;
      }
    };
    void load();
    if (!running) {
      return () => {
        cancelled = true;
        controller.abort();
      };
    }
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      controller.abort();
    };
  }, [sessionId, running, refreshKey]);

  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  // Distance from the bottom to keep while an older page is prepended.
  const prependAnchorRef = useRef<number | null>(null);
  const loadingEarlierRef = useRef(false);
  const pagingControllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => pagingControllerRef.current?.abort(), []);

  // Page upward through older entries, like the main chat's history paging.
  const loadEarlier = useCallback(async () => {
    const cursor = oldestEntryId;
    if (!cursor || loadingEarlierRef.current) return;
    loadingEarlierRef.current = true;
    const controller = new AbortController();
    pagingControllerRef.current = controller;
    setLoadingEarlier(true);
    try {
      const res = await fetch(contextUrl(sessionId, cursor), { signal: controller.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { context: Partial<SubagentTranscript> };
      // A poll replaced the transcript meanwhile: this page no longer joins on.
      if (transcriptRef.current.oldestEntryId !== cursor) return;
      const el = listRef.current;
      prependAnchorRef.current = el ? el.scrollHeight - el.scrollTop : null;
      setTranscript((current) => prependOlderPage(current, cursor, toTranscript(data.context)));
    } catch {
      /* paging is best-effort; the button stays for a retry */
    } finally {
      loadingEarlierRef.current = false;
      if (pagingControllerRef.current === controller) pagingControllerRef.current = null;
      if (!controller.signal.aborted) setLoadingEarlier(false);
    }
  }, [oldestEntryId, sessionId]);

  // Stick to the bottom while new entries arrive, unless the user scrolled up;
  // a prepended older page leaves what the user was reading in place.
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);
  useLayoutEffect(() => {
    const el = listRef.current;
    const anchor = prependAnchorRef.current;
    prependAnchorRef.current = null;
    if (!el) return;
    if (anchor !== null) el.scrollTop = el.scrollHeight - anchor;
    else if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const toolResults = useMemo(() => buildToolResultsMap(messages), [messages]);
  const relation = info?.relation?.kind === "subagent" ? info.relation : null;
  const status = running ? "running" as const : relation?.status ?? "completed" as const;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          flexShrink: 0,
          minHeight: 36,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", color: "var(--accent)", flexShrink: 0 }} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" />
          </svg>
        </span>
        <strong
          style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600 }}
          title={relation ? `${relation.profile ?? t("agentSwitcher.subagent")} · ${label}` : label}
        >
          {label}
        </strong>
        <span
          style={{ display: "flex", alignItems: "center", gap: 5, color: statusColor(status), fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}
          title={relation?.description}
        >
          <StatusIcon status={status} />
          <span>{t(`agentSwitcher.status.${status}`)}</span>
        </span>
        <button
          type="button"
          onClick={() => setRefreshKey((key) => key + 1)}
          title={t("subagent.refresh")}
          aria-label={t("subagent.refresh")}
          style={{
            display: "grid", placeItems: "center", width: 24, height: 24, flexShrink: 0,
            background: "none", border: "none", borderRadius: 4, color: "var(--text-dim)", cursor: "pointer", padding: 0,
          }}
          onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-dim)"; }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
          </svg>
        </button>
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "10px 0" }}
        lang={locale}
      >
        {notFound ? (
          <div style={{ padding: "24px 16px", color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>
            {running ? t("subagent.viewer.starting") : t("subagent.viewer.error")}
          </div>
        ) : error && messages.length === 0 ? (
          <div role="alert" style={{ padding: "24px 16px", color: "#dc2626", fontSize: 12, textAlign: "center" }}>
            {t("subagent.viewer.error")}
            <div style={{ marginTop: 6, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{error}</div>
          </div>
        ) : (
          <>
            {hasMore && (
              <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 10px" }}>
                <button
                  type="button"
                  onClick={loadEarlier}
                  disabled={loadingEarlier}
                  style={{
                    fontSize: 11, padding: "4px 12px", borderRadius: 6,
                    border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text-muted)",
                    cursor: loadingEarlier ? "default" : "pointer",
                  }}
                >
                  {t("i18n.loadMore")}
                </button>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={entryIds[index] ?? index} style={{ padding: "2px 12px" }}>
                <MessageView
                  message={message}
                  toolResults={toolResults}
                  cwd={info?.cwd}
                  onOpenFile={onOpenFile}
                  sessionId={sessionId}
                  entryId={entryIds[index]}
                />
              </div>
            ))}
            {messages.length === 0 && !error && (
              <div style={{ padding: "24px 16px", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
                {t("subagent.viewer.empty")}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
