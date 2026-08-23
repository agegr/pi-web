"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  searchDashboard,
  type DashboardSearchData,
  type DashboardSearchResult,
} from "@/extension/robin/search";
import { formatLinkPaste } from "@/lib/clipboard";
import { requestRefresh } from "./refreshBus";
import { splitReplyLinks } from "./reply-links";

interface AssistantResponse {
  reply: string;
  usedTools: string[];
}

/** Tool names map to message keys so the summary follows the chosen language. */
const TOOL_KEYS: Record<string, string> = {
  todo_add: "robin.tool.todoAdd",
  todo_update: "robin.tool.todoUpdate",
  todo_delete: "robin.tool.todoDelete",
  todo_complete: "robin.tool.todoComplete",
  todo_list: "robin.tool.todoList",
  calendar_create_event: "robin.tool.eventAdd",
  calendar_list_events: "robin.tool.eventList",
  link_add: "robin.tool.linkAdd",
  link_list: "robin.tool.linkList",
  provider_usage: "robin.tool.providerUsage",
};

function describeTools(usedTools: string[], t: (key: string) => string): string | null {
  const described = [...new Set(usedTools)].map((name) => {
    const key = TOOL_KEYS[name];
    return key ? t(key) : name;
  });
  return described.length > 0 ? described.join(", ") : null;
}

async function fetchSearchResource<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? `Request failed (${response.status})`);
  return body;
}

export function AssistantBar() {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchData, setSearchData] = useState<DashboardSearchData | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The assistant field doubles as global search. Load all three small dashboard
  // collections once per query, then filter locally while the user keeps typing.
  useEffect(() => {
    if (!message.trim()) {
      setSearchData(null);
      setSearchError(null);
      return;
    }
    if (searchData) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearchError(null);
      void Promise.all([
        fetchSearchResource<Pick<DashboardSearchData, "links">>("/api/robin/links", controller.signal),
        fetchSearchResource<Pick<DashboardSearchData, "todos">>("/api/robin/todos", controller.signal),
        fetchSearchResource<Pick<DashboardSearchData, "events">>("/api/robin/events", controller.signal),
      ]).then(([links, todos, events]) => {
        setSearchData({ links: links.links, todos: todos.todos, events: events.events });
      }).catch((caught: unknown) => {
        if ((caught as { name?: string }).name !== "AbortError") {
          setSearchError(caught instanceof Error ? caught.message : String(caught));
        }
      });
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [message, searchData]);

  const searchResults = useMemo(
    () => searchData ? searchDashboard(searchData, message) : [],
    [searchData, message],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;

    setBusy(true);
    setError(null);
    setReply(null);
    try {
      const response = await fetch("/api/robin/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const body = await response.json().catch(() => null) as
        (AssistantResponse & { error?: string }) | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);

      setMessage("");
      setSearchData(null);
      setReply({ reply: body?.reply ?? "", usedTools: body?.usedTools ?? [] });
      // The agent wrote straight to the JSON stores; pull the panels forward.
      requestRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const replacement = formatLinkPaste(
      event.clipboardData.getData("text/plain") || event.clipboardData.getData("text"),
      event.clipboardData.getData("text/html"),
      input.value.slice(start, end),
    );
    if (!replacement) return;

    event.preventDefault();
    const nextMessage = input.value.slice(0, start) + replacement + input.value.slice(end);
    const nextCursor = start + replacement.length;
    setMessage(nextMessage);
    requestAnimationFrame(() => input.setSelectionRange(nextCursor, nextCursor));
  };

  const actions = reply ? describeTools(reply.usedTools, t) : null;

  return (
    <section
      className="robin-assistant-bar pi-card flex flex-col gap-2 p-4"
    >
      <form onSubmit={submit} className="flex gap-2">
        <input
          ref={inputRef}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onPaste={handlePaste}
          disabled={busy}
          placeholder={t("robin.assistant.placeholder")}
          className="min-w-0 flex-1 rounded px-3 py-2 text-sm outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !message.trim()}
          className="ui-action ui-action--outline pi-bracket px-3 disabled:opacity-40"
          data-state="accent"
        >
          {busy ? "…" : t("robin.assistant.send")}
        </button>
      </form>

      {!busy && searchResults.length > 0 && <SearchResults results={searchResults} t={t} />}

      {busy && (
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.assistant.working")}</p>
      )}

      {searchError && message.trim() && (
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>{searchError}</p>
      )}
      {error && <p className="text-xs" style={{ color: "var(--accent)" }}>{error}</p>}

      {reply && !busy && (
        <div className="flex flex-col gap-1">
          {reply.reply && (
            <p className="whitespace-pre-wrap break-words text-sm" style={{ color: "var(--text-muted)" }}>
              {splitReplyLinks(reply.reply).map((segment, index) => segment.type === "link" ? (
                <a
                  key={`${segment.href}:${index}`}
                  href={segment.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: 3 }}
                >
                  {segment.value}
                </a>
              ) : segment.value)}
            </p>
          )}
          {actions && (
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>{actions}</p>
          )}
        </div>
      )}
    </section>
  );
}

function SearchResults({
  results,
  t,
}: {
  results: DashboardSearchResult[];
  t: (key: string, params?: Record<string, string>) => string;
}) {
  return (
    <div
      role="region"
      aria-label={t("robin.search.results")}
      className="max-h-64 overflow-y-auto rounded"
      style={{ border: "1px solid var(--border)", background: "var(--bg)" }}
    >
      {results.map((result) => {
        const category = result.kind === "link"
          ? t("robin.links.title")
          : result.kind === "todo"
            ? t("robin.todos.title")
            : t("robin.calendar.title");
        const detail = result.kind === "link"
          ? linkDetail(result.item.url, result.item.group)
          : result.kind === "todo"
            ? [result.item.done ? "✓" : "", result.item.due ?? ""].filter(Boolean).join(" · ")
            : [result.item.date, result.item.start ?? "", result.item.location ?? ""].filter(Boolean).join(" · ");
        const item = result.item;
        const content = (
          <>
            <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide" style={{ color: "var(--text-dim)" }}>
              {category}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm" style={{ color: "var(--text)" }}>{item.title}</span>
              {detail && (
                <span className="block truncate text-xs" style={{ color: "var(--text-dim)" }}>{detail}</span>
              )}
            </span>
          </>
        );

        return result.kind === "link" ? (
          <a
            key={`link:${item.id}`}
            href={result.item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-action ui-action--surface flex min-h-11 items-center gap-2 border-b px-3 py-1 last:border-b-0"
          >
            {content}
          </a>
        ) : (
          <div key={`${result.kind}:${item.id}`} className="flex min-h-11 items-center gap-2 border-b px-3 py-1 last:border-b-0">
            {content}
          </div>
        );
      })}
    </div>
  );
}

function linkDetail(url: string, group?: string): string {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // Keep the original address when a legacy item is malformed.
  }
  return [group, host].filter(Boolean).join(" · ");
}
