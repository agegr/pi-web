"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { requestRefresh } from "./refreshBus";

interface AssistantResponse {
  reply: string;
  usedTools: string[];
}

/** Tool names map to message keys so the summary follows the chosen language. */
const TOOL_KEYS: Record<string, string> = {
  todo_add: "robin.tool.todoAdd",
  todo_complete: "robin.tool.todoComplete",
  todo_list: "robin.tool.todoList",
  calendar_create_event: "robin.tool.eventAdd",
  calendar_list_events: "robin.tool.eventList",
  link_add: "robin.tool.linkAdd",
  link_list: "robin.tool.linkList",
};

function describeTools(usedTools: string[], t: (key: string) => string): string | null {
  const described = [...new Set(usedTools)].map((name) => {
    const key = TOOL_KEYS[name];
    return key ? t(key) : name;
  });
  return described.length > 0 ? described.join(", ") : null;
}

export function AssistantBar() {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const actions = reply ? describeTools(reply.usedTools, t) : null;

  return (
    <section
      className="flex flex-col gap-2 rounded-lg p-4"
      style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
    >
      <form onSubmit={submit} className="flex gap-2">
        <input
          ref={inputRef}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          disabled={busy}
          placeholder={t("robin.assistant.placeholder")}
          className="min-w-0 flex-1 rounded px-3 py-2 text-sm outline-none disabled:opacity-60"
          style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
        />
        <button
          type="submit"
          disabled={busy || !message.trim()}
          className="rounded px-4 py-2 text-sm disabled:opacity-40"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {busy ? "…" : t("robin.assistant.send")}
        </button>
      </form>

      {busy && (
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.assistant.working")}</p>
      )}

      {error && <p className="text-xs" style={{ color: "var(--accent)" }}>{error}</p>}

      {reply && !busy && (
        <div className="flex flex-col gap-1">
          {reply.reply && (
            <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--text-muted)" }}>
              {reply.reply}
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
