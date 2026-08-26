"use client";

// Full-text search over past conversations, rendered in place of the session
// list in the sidebar. Backed by GET /api/sessions/search.

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type {
  SessionSearchHit,
  SessionSearchResponse,
  SessionSearchResult,
} from "@/lib/session-search";

/** Longer than the file search debounce: this scans session files. */
const SEARCH_DEBOUNCE_MS = 320;
const MIN_QUERY_LENGTH = 2;

interface Props {
  /** Restrict to the selected project; null searches every project. */
  projectKey: string | null;
  /** Display name of the selected project, shown on the scope toggle. */
  projectLabel: string | null;
  /** Called with the clicked result; the sidebar resolves it to a session. */
  onSelectResult: (result: SessionSearchResult) => void;
  onClose: () => void;
}

function formatTime(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${sameYear ? day : `${date.getFullYear()}-${day}`} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function resultTitle(result: SessionSearchResult): string {
  const title = result.name?.trim() || result.firstMessage?.trim();
  if (!title) return "—";
  return title.length > 120 ? `${title.slice(0, 120)}…` : title;
}

function projectName(cwd: string): string {
  const parts = cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || cwd;
}

function HitRow({ hit }: { hit: SessionSearchHit }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        lineHeight: 1.5,
        color: "var(--text-muted)",
        padding: "2px 0 2px 8px",
        borderLeft: "2px solid var(--border)",
        wordBreak: "break-word",
      }}
    >
      <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 9.5 }}>
        {hit.tool ? `${hit.role}:${hit.tool}` : hit.role}
        {" "}
      </span>
      {hit.clippedStart ? "…" : ""}
      {hit.prefix}
      <mark style={{ background: "rgba(37,99,235,0.22)", color: "var(--text)", borderRadius: 2, padding: "0 1px" }}>
        {hit.match}
      </mark>
      {hit.suffix}
      {hit.clippedEnd ? "…" : ""}
    </div>
  );
}

export function SessionSearchPanel({ projectKey, projectLabel, onSelectResult, onClose }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [allProjects, setAllProjects] = useState(false);
  const [includeTools, setIncludeTools] = useState(false);
  const [response, setResponse] = useState<SessionSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const roles = useMemo(
    () => (includeTools ? "user,assistant,toolCall,toolResult,bash,summary" : "user,assistant"),
    [includeTools],
  );
  const effectiveProjectKey = allProjects ? "" : (projectKey ?? "");
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResponse(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: trimmed, roles });
      if (effectiveProjectKey) params.set("projectKey", effectiveProjectKey);
      fetch(`/api/sessions/search?${params.toString()}`, { signal: controller.signal })
        .then(async (res) => {
          const data = await res.json() as SessionSearchResponse & { error?: string };
          if (!res.ok) throw new Error(data.error ?? "Search failed");
          return data;
        })
        .then((data) => setResponse(data))
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setResponse(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, roles, effectiveProjectKey]);

  const results = response?.results ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: "1 1 0" }}>
      <div style={{ padding: "8px 10px 6px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                if (query) setQuery("");
                else onClose();
              }
            }}
            placeholder={t("sidebar.searchSessionsPlaceholder")}
            aria-label={t("sidebar.searchSessions")}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "6px 24px 6px 8px",
              border: "1px solid var(--border)",
              borderRadius: 5,
              outline: "none",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 11.5,
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              title={t("sidebar.clearSearch")}
              aria-label={t("sidebar.clearSearch")}
              style={{
                position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 18, height: 18, padding: 0, border: "none", borderRadius: 4,
                background: "none", color: "var(--text-dim)", cursor: "pointer",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, paddingTop: 6, fontSize: 10, color: "var(--text-dim)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={allProjects || !projectKey}
              disabled={!projectKey}
              onChange={(event) => setAllProjects(event.target.checked)}
              style={{ margin: 0 }}
            />
            {projectLabel && !allProjects
              ? t("sidebar.searchScopeProject", { project: projectLabel })
              : t("sidebar.searchScopeAll")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={includeTools}
              onChange={(event) => setIncludeTools(event.target.checked)}
              style={{ margin: 0 }}
            />
            {t("sidebar.searchIncludeTools")}
          </label>
        </div>
      </div>

      <div style={{ flex: "1 1 0", overflowY: "auto", minHeight: 60 }}>
        {trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH && (
          <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-dim)" }}>
            {t("sidebar.searchMinLength", { count: MIN_QUERY_LENGTH })}
          </div>
        )}
        {loading && (
          <div role="status" style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-dim)" }}>
            {t("sidebar.searchingSessions")}
          </div>
        )}
        {!loading && error && (
          <div role="alert" style={{ padding: "10px 12px", fontSize: 11, color: "#f87171", wordBreak: "break-word" }}>
            {error}
          </div>
        )}
        {!loading && !error && response && results.length === 0 && (
          <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-dim)" }}>
            {t("sidebar.noMatchingSessions")}
          </div>
        )}
        {!loading && !error && response && results.length > 0 && (
          <>
            <div style={{ padding: "6px 12px 2px", fontSize: 10, color: "var(--text-dim)" }}>
              {t("sidebar.searchSummary", {
                matches: response.totalMatches,
                sessions: response.stats.sessionsMatched,
                scanned: response.stats.sessionsScanned,
                ms: response.stats.elapsedMs,
              })}
              {response.stats.truncated ? ` · ${t("sidebar.searchTruncated")}` : ""}
            </div>
            {results.map((result) => (
              <button
                key={result.sessionId}
                type="button"
                onClick={() => onSelectResult(result)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  background: "none", border: "none", borderBottom: "1px solid var(--border)",
                  padding: "8px 12px", cursor: "pointer", color: "var(--text)",
                }}
                onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(event) => { event.currentTarget.style.background = "none"; }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 9.5, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                  <span>{formatTime(result.modified)}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {projectName(result.cwd)}
                  </span>
                  <span style={{ marginLeft: "auto", flexShrink: 0 }}>
                    {t("sidebar.searchMatchCount", { count: result.matchCount })}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, padding: "2px 0 4px", lineHeight: 1.4, wordBreak: "break-word" }}>
                  {resultTitle(result)}
                </div>
                {result.hits.map((hit, index) => (
                  <HitRow key={`${hit.entryId}:${index}`} hit={hit} />
                ))}
                {result.moreHits && (
                  <div style={{ fontSize: 10, color: "var(--text-dim)", paddingLeft: 8, paddingTop: 2 }}>
                    {t("sidebar.searchMoreHits", { count: result.matchCount - result.hits.length })}
                  </div>
                )}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
