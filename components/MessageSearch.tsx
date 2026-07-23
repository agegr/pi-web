"use client";
import { useMemo, useState, useCallback, RefObject } from "react";
import type { AgentMessage, AssistantMessage, TextContent } from "@/lib/types";

interface Props {
  messages: AgentMessage[];
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  scrollContainer: RefObject<HTMLDivElement | null>;
}

function getMessageText(msg: AgentMessage): string {
  if (msg.role === "user") {
    const content = (msg as { content: unknown }).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return (content as { type: string; text?: string }[])
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("\n");
    }
    return "";
  }
  if (msg.role === "assistant") {
    const blocks = (msg as AssistantMessage).content ?? [];
    return blocks
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join(" ");
  }
  return "";
}

interface Match {
  index: number;
  refIndex: number;
  role: "user" | "assistant";
  snippet: string;
}

export function MessageSearch({
  messages,
  messageRefs,
  scrollContainer,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const matches = useMemo<Match[]>(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const result: Match[] = [];
    let refIndex = 0;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      const currentRefIndex = refIndex++;
      const text = getMessageText(msg);
      const pos = text.toLowerCase().indexOf(q);
      if (pos === -1) continue;
      const start = Math.max(0, pos - 30);
      const end = Math.min(text.length, pos + q.length + 30);
      const snippet = `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
      result.push({
        index: i,
        refIndex: currentRefIndex,
        role: msg.role,
        snippet,
      });
    }
    return result;
  }, [messages, query]);

  const jumpTo = useCallback(
    (refIndex: number) => {
      const el = messageRefs.current?.[refIndex];
      if (el && scrollContainer.current) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    },
    [messageRefs, scrollContainer],
  );

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Search messages"
        style={{
          border: "1px solid var(--border)",
          background: "var(--bg-panel)",
          borderRadius: 6,
          width: 28,
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        🔍
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 34,
            right: 0,
            width: 320,
            maxHeight: 400,
            overflowY: "auto",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 8,
            zIndex: 200,
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages..."
            style={{
              width: "100%",
              padding: "6px 8px",
              marginBottom: 8,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg-panel)",
              color: "var(--text)",
              fontSize: 13,
            }}
          />
          {query.trim() && matches.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                padding: "4px 2px",
              }}
            >
              No matches
            </div>
          )}
          {matches.map((m) => (
            <div
              key={m.index}
              onClick={() => {
                jumpTo(m.refIndex);
                setOpen(false);
              }}
              style={{
                padding: "6px 8px",
                borderRadius: 6,
                cursor: "pointer",
                marginBottom: 2,
                borderLeft: `3px solid ${m.role === "user" ? "rgba(37,99,235,0.9)" : "rgba(234,88,12,0.85)"}`,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginBottom: 2,
                }}
              >
                {m.role === "user" ? "You" : "Assistant"}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--text)",
                  lineHeight: 1.4,
                }}
              >
                {m.snippet}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
