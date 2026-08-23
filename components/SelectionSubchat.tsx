"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import type { AgentMessage, AssistantMessage, UserMessage } from "@/lib/types";

function messageText(message: AgentMessage): string {
  if (message.role === "user" && typeof message.content === "string") return message.content;
  if (message.role === "assistant") {
    return (message as AssistantMessage).content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }
  const content = (message as UserMessage).content;
  return Array.isArray(content)
    ? content.filter((block) => block.type === "text").map((block) => block.text).join("\n")
    : "";
}

interface Props {
  selection: string;
  sessionId?: string;
  subchatId: string | null;
  onStart: () => Promise<string | undefined>;
  onClose: () => void;
}

/** A lightweight, persistent-in-page conversation for a highlighted response excerpt. */
export function SelectionSubchat({ selection, sessionId, subchatId, onStart, onClose }: Props) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!subchatId) return;
    const response = await fetch(`/api/sessions/${encodeURIComponent(subchatId)}/context?deferThinking`);
    if (!response.ok) throw new Error(`Unable to load discussion (${response.status})`);
    const payload = await response.json() as { context?: { messages?: AgentMessage[] } };
    setMessages((payload.context?.messages ?? []).filter((message) => message.role === "user" || message.role === "assistant"));
  }, [subchatId]);

  useEffect(() => {
    if (!subchatId) return;
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    const timer = window.setInterval(() => void refresh().catch(() => {}), 1200);
    return () => window.clearInterval(timer);
  }, [refresh, subchatId]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      await onStart();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  };

  const send = async () => {
    if (!subchatId || !draft.trim() || sending) return;
    const prompt = draft.trim();
    setDraft("");
    setSending(true);
    try {
      await sendAgentCommand(subchatId, { type: "prompt", message: prompt });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  const latestAnswer = useMemo(() => [...messages].reverse().find((message) => message.role === "assistant"), [messages]);
  const sendSummaryToMain = async () => {
    const summary = latestAnswer ? messageText(latestAnswer) : "";
    if (!sessionId || !summary.trim()) return;
    setSending(true);
    try {
      await sendAgentCommand(sessionId, {
        type: "prompt",
        message: `A selected-text subchat produced the following result. Incorporate it into our main task as appropriate:\n\n--- Subchat result ---\n${summary.trim()}`,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  return (
    <aside role="dialog" aria-label="Selected-text discussion" style={{ position: "fixed", zIndex: 50, right: 24, bottom: 24, width: "min(430px, calc(100vw - 32px))", maxHeight: "min(620px, calc(100vh - 48px))", display: "flex", flexDirection: "column", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 16px 40px rgba(0,0,0,0.28)", overflow: "hidden" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <strong style={{ fontSize: 13, flex: 1 }}>Selected-text discussion</strong>
        <button type="button" onClick={onClose} aria-label="Close discussion" style={{ border: 0, background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}>×</button>
      </header>
      <blockquote style={{ margin: "10px 12px", padding: "7px 9px", borderLeft: "3px solid var(--accent)", background: "var(--bg-hover)", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.45, maxHeight: 100, overflow: "auto", whiteSpace: "pre-wrap" }}>{selection}</blockquote>
      {!subchatId ? (
        <div style={{ padding: "0 12px 12px", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.45 }}>
          Start a separate discussion about this selection. It will not change the main conversation until you send its result back.
          <button type="button" onClick={() => void start()} disabled={starting} style={{ display: "block", marginTop: 10, padding: "6px 9px", border: 0, borderRadius: 5, background: "var(--accent)", color: "white", cursor: starting ? "wait" : "pointer" }}>{starting ? "Starting…" : "Start discussion"}</button>
        </div>
      ) : (
        <>
          <div style={{ padding: "0 12px", overflow: "auto", flex: 1, minHeight: 130 }}>
            {messages.map((message, index) => <div key={index} style={{ margin: "8px 0", padding: "7px 9px", borderRadius: 6, background: message.role === "user" ? "var(--user-bg)" : "var(--bg)", whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.45 }}>{messageText(message)}</div>)}
          </div>
          <div style={{ padding: 10, borderTop: "1px solid var(--border)" }}>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask a follow-up…" rows={2} style={{ width: "100%", resize: "vertical", boxSizing: "border-box", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 5, padding: 7, font: "inherit", fontSize: 12 }} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, gap: 8 }}>
              <button type="button" onClick={() => void sendSummaryToMain()} disabled={sending || !latestAnswer || !sessionId} style={{ border: 0, borderRadius: 5, padding: "5px 7px", background: "var(--bg-hover)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}>Send result to main</button>
              <button type="button" onClick={() => void send()} disabled={sending || !draft.trim()} style={{ border: 0, borderRadius: 5, padding: "5px 9px", background: "var(--accent)", color: "white", cursor: "pointer", fontSize: 11 }}>{sending ? "Sending…" : "Send"}</button>
            </div>
          </div>
        </>
      )}
      {error && <div role="alert" style={{ padding: "0 12px 10px", color: "#ef4444", fontSize: 11 }}>{error}</div>}
    </aside>
  );
}
