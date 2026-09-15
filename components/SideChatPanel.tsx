"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { MessageView } from "./MessageView";
import { AgentEventConnection } from "@/lib/agent-event-connection";
import { AgentCommandError, isSideChatReclaimError, sendAgentCommand } from "@/lib/agent-client";
import { INITIAL_STREAMING_STATE, streamReducer, type ClientAssistantMessageEvent } from "@/lib/streaming-message";
import { normalizeToolCalls } from "@/lib/normalize";
import type { AgentMessage, ToolResultMessage } from "@/lib/types";

/**
 * Side conversation panel ("/btw").
 *
 * Renders an ephemeral fork of the current session: the parent's active branch
 * arrives as reference context, nothing here is written to a session file, and
 * discarding the panel discards the conversation.
 *
 * The transcript is deliberately simpler than the main chat window — it loads
 * the fork's messages, streams new ones, and resyncs after each completed
 * message instead of tracking queue/steering/compaction state, none of which a
 * throwaway conversation needs.
 */

export interface SideChatInfo {
  sessionId: string;
  parentSessionId: string;
  cwd: string;
  inheritedMessages: number;
  inheritedToolCalls: number;
  droppedEntries: number;
  createdAt: string;
}

interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

interface Props {
  /** Parent session whose branch this side conversation inherits. */
  sessionId: string;
  sessionName?: string;
  onClose: () => void;
  translate: (key: string, vars?: Record<string, string | number>) => string;
  /** Hand the latest answer back to the main composer. */
  onInsertIntoMain: (text: string) => void;
}

const EVENT_STREAM_READY_TIMEOUT_MS = 15000;
const EVENT_STREAM_RECONNECT_DELAY_MS = 2000;
/** One turn emits several completion events; fetch the transcript once per burst. */
const RELOAD_COALESCE_MS = 60;

function assistantText(message: AgentMessage): string {
  if (message.role !== "assistant") return "";
  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

export function SideChatPanel({ sessionId, sessionName, onClose, translate, onInsertIntoMain }: Props) {
  const [sideChat, setSideChat] = useState<SideChatInfo | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [streamState, dispatch] = useReducer(streamReducer, INITIAL_STREAMING_STATE);
  const [opening, setOpening] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const sideChatRef = useRef<SideChatInfo | null>(null);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  // Set when the ephemeral runtime is gone, so the event stream stops retrying
  // an endpoint that will keep refusing it until a fresh fork is opened.
  const runtimeGoneRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Monotonic token: a slow response must never overwrite a newer one.
  const loadSeqRef = useRef(0);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    sideChatRef.current = sideChat;
  }, [sideChat]);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const seq = ++loadSeqRef.current;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}?tail=400&deferMedia=1`);
      if (!res.ok) return;
      const data = await res.json() as { context?: { messages?: AgentMessage[] } };
      if (!mountedRef.current || seq !== loadSeqRef.current) return;
      setMessages((data.context?.messages ?? []) as AgentMessage[]);
    } catch {
      // A resync is a repair path; the next event retries it.
    }
  }, []);

  /**
   * Refetch the fork after a completion, coalescing the burst of events one turn
   * emits (message_end, agent_settled, agent_end).
   *
   * Deliberately not deduplicated by an in-flight promise: the first fetch of a
   * burst can predate the message being stored, and dropping the last one would
   * leave the transcript a turn behind with no later event to correct it.
   */
  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      const id = sideChatRef.current?.sessionId;
      if (id) void loadMessages(id);
    }, RELOAD_COALESCE_MS);
  }, [loadMessages]);

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "connected": {
        setRunning(Boolean(event.isStreaming));
        break;
      }
      case "agent_start": {
        setRunning(true);
        break;
      }
      case "agent_end":
      case "agent_settled": {
        setRunning(false);
        dispatch({ type: "end" });
        scheduleReload();
        break;
      }
      case "message_start": {
        const message = event.message as AgentMessage | undefined;
        if (message?.role === "assistant") dispatch({ type: "snapshot", message });
        break;
      }
      case "message_update": {
        const delta = event.assistantMessageEvent as ClientAssistantMessageEvent | undefined;
        if (delta) dispatch({ type: "delta", event: delta });
        break;
      }
      case "message_end": {
        const completed = event.message as AgentMessage | undefined;
        // A completed message is already in the fork's entry list, so the
        // resync below is also what turns an optimistic bubble into a real one.
        if (completed?.role === "assistant") dispatch({ type: "end" });
        scheduleReload();
        break;
      }
      default:
        break;
    }
  }, [scheduleReload]);

  const handleEventRef = useRef(handleEvent);
  useEffect(() => {
    handleEventRef.current = handleEvent;
  }, [handleEvent]);

  const connection = useMemo(() => new AgentEventConnection({
    createSource: (id: string) => {
      const source = new EventSource(`/api/agent/${encodeURIComponent(id)}/events`);
      source.addEventListener("error", () => {
        // A permanently CLOSED source means the endpoint refused the stream (the
        // runtime was reclaimed) rather than dropping it: a transient failure
        // leaves readyState CONNECTING for the source's own reconnect.
        if (source.readyState === EventSource.CLOSED) {
          runtimeGoneRef.current = true;
          if (mountedRef.current) setNotice("reclaimed");
        }
      });
      return source;
    },
    onEvent: (event) => handleEventRef.current(event as unknown as AgentEvent),
    shouldMaintain: () => mountedRef.current && !runtimeGoneRef.current,
    readinessTimeoutMs: EVENT_STREAM_READY_TIMEOUT_MS,
    reconnectDelayMs: EVENT_STREAM_RECONNECT_DELAY_MS,
  }), []);

  /**
   * Open the fork, or adopt the live one the server already has.
   *
   * The route is idempotent per parent session, so this doubles as the liveness
   * probe after a reclaim: it hands back whichever fork is currently alive.
   */
  const openFork = useCallback(async (): Promise<SideChatInfo> => {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/side-chat`, { method: "POST" });
    const data = await res.json() as { data?: { sideChat?: SideChatInfo }; error?: string };
    const opened = data.data?.sideChat;
    if (!res.ok || !opened) throw new Error(data.error ?? `HTTP ${res.status}`);
    // Set the ref synchronously: send() reads it in the same tick.
    sideChatRef.current = opened;
    setSideChat(opened);
    runtimeGoneRef.current = false;
    setOpening(false);
    await loadMessages(opened.sessionId);
    connection.maintain(opened.sessionId);
    return opened;
  }, [sessionId, connection, loadMessages]);

  // Open the fork on mount, then attach to its event stream.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const opened = await openFork();
        if (cancelled) return;
        void opened;
      } catch (err) {
        if (cancelled) return;
        setOpening(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      connection.close();
    };
  }, [openFork, connection]);

  // Tail-follow while the answer streams in.
  useEffect(() => {
    if (!streamState.isStreaming && messages.length === 0) return;
    const node = scrollRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
    if (nearBottom || streamState.isStreaming) node.scrollTop = node.scrollHeight;
  }, [messages, streamState.streamingMessage, streamState.isStreaming]);

  const toolResults = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const message of messages) {
      if (message.role === "toolResult") map.set(message.toolCallId, message);
    }
    return map;
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    const chat = sideChatRef.current;
    if (!text || !chat || runningRef.current) return;
    setInput("");
    setError(null);
    setNotice(null);
    // Optimistic bubble: the next resync replaces it with the stored message.
    setMessages((prev) => [...prev, {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    } as AgentMessage]);
    dispatch({ type: "start" });
    setRunning(true);

    const prompt = (id: string) => sendAgentCommand(id, { type: "prompt", message: text });
    let failure: unknown = null;
    try {
      await prompt(chat.sessionId);
      return;
    } catch (err) {
      if (!isSideChatReclaimError(err as AgentCommandError)) {
        failure = err;
      } else {
        // The ephemeral runtime was reclaimed. Open a fresh fork and resend once:
        // the fork is disposable, so this is recovery, not data loss.
        try {
          const revived = await openFork();
          setNotice("revived");
          await prompt(revived.sessionId);
          return;
        } catch (reviveError) {
          failure = reviveError;
        }
      }
    }
    setRunning(false);
    dispatch({ type: "end" });
    setError(failure instanceof Error ? failure.message : String(failure));
  }, [input, openFork]);

  const abort = useCallback(async () => {
    const chat = sideChatRef.current;
    if (!chat) return;
    // Unlock the composer first: if the runtime is already gone the abort cannot
    // land, and a stuck "running" would block the recovery send.
    setRunning(false);
    dispatch({ type: "end" });
    await sendAgentCommand(chat.sessionId, { type: "abort" }).catch(() => undefined);
  }, []);

  const close = useCallback(async () => {
    const chat = sideChatRef.current;
    onClose();
    if (!chat) return;
    // Discarding the runtime is what makes the conversation ephemeral; the
    // panel closes immediately rather than waiting on it.
    void fetch(`/api/sessions/${encodeURIComponent(chat.parentSessionId)}/side-chat`, { method: "DELETE" })
      .catch(() => undefined);
  }, [onClose]);

  const lastAnswer = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const text = assistantText(normalizeToolCalls(messages[i]));
      if (text) return text;
    }
    return "";
  }, [messages]);

  const copyAnswer = useCallback(() => {
    if (!lastAnswer) return;
    onInsertIntoMain(lastAnswer);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [lastAnswer, onInsertIntoMain]);

  const visible = messages.filter((message) => message.role !== "toolResult");

  return (
    <aside
      className="side-chat-panel"
      aria-label={translate("sideChat.title")}
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(480px, 100vw)",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        borderLeft: "1px solid var(--border)",
        boxShadow: "-16px 0 40px rgba(0, 0, 0, 0.18)",
        zIndex: 480,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flexShrink: 0 }}>
              {translate("sideChat.title")}
            </span>
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={sessionName ?? sessionId}
            >
              {sessionName ?? sessionId}
            </span>
          </div>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {sideChat
              ? translate("sideChat.inherited", { count: sideChat.inheritedMessages })
              : translate("sideChat.opening")}
            {" · "}
            {translate("sideChat.ephemeral")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void close()}
          aria-label={translate("sideChat.close")}
          title={translate("sideChat.close")}
          style={{
            flexShrink: 0,
            width: 26,
            height: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div
        ref={scrollRef}
        className="side-chat-body"
        style={{ flex: 1, overflowY: "auto", padding: "12px 12px 4px", overscrollBehavior: "contain" }}
      >
        {opening && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 2px" }}>
            {translate("sideChat.opening")}
          </div>
        )}
        {error && (
          <div
            role="alert"
            style={{
              fontSize: 12,
              color: "var(--text)",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 8px",
              marginBottom: 8,
            }}
          >
            {error}
          </div>
        )}
        {notice && !error && (
          <div
            role="status"
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 8px",
              marginBottom: 8,
            }}
          >
            {translate(notice === "revived" ? "sideChat.revived" : "sideChat.reclaimed")}
          </div>
        )}
        {visible.map((message, index) => (
          <MessageView
            key={`${message.role}-${index}-${(message as { timestamp?: number }).timestamp ?? index}`}
            message={message}
            toolResults={toolResults}
            cwd={sideChat?.cwd}
            sessionId={sideChat?.sessionId}
          />
        ))}
        {streamState.streamingMessage && (
          <MessageView
            message={streamState.streamingMessage as AgentMessage}
            toolResults={toolResults}
            isStreaming
            cwd={sideChat?.cwd}
            sessionId={sideChat?.sessionId}
          />
        )}
      </div>

      <footer style={{ padding: 12, borderTop: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={translate("sideChat.placeholder")}
          rows={2}
          aria-label={translate("sideChat.placeholder")}
          style={{
            width: "100%",
            resize: "vertical",
            minHeight: 44,
            maxHeight: 160,
            padding: "8px 10px",
            fontSize: 12,
            fontFamily: "inherit",
            color: "var(--text)",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            outline: "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={copyAnswer}
            disabled={!lastAnswer}
            title={translate("sideChat.bringBackHint")}
            style={{
              fontSize: 11,
              padding: "5px 9px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "none",
              color: lastAnswer ? "var(--text)" : "var(--text-dim)",
              cursor: lastAnswer ? "pointer" : "not-allowed",
              opacity: lastAnswer ? 1 : 0.5,
              whiteSpace: "nowrap",
            }}
          >
            {copied ? translate("sideChat.broughtBack") : translate("sideChat.bringBack")}
          </button>
          <div style={{ flex: 1 }} />
          {running ? (
            <button
              type="button"
              onClick={() => void abort()}
              style={{
                fontSize: 11,
                padding: "5px 12px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--bg-hover)",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              {translate("sideChat.stop")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!input.trim() || !sideChat}
              style={{
                fontSize: 11,
                padding: "5px 12px",
                borderRadius: 6,
                border: "none",
                background: input.trim() && sideChat ? "var(--accent)" : "var(--bg-hover)",
                color: input.trim() && sideChat ? "var(--accent-contrast, #fff)" : "var(--text-dim)",
                cursor: input.trim() && sideChat ? "pointer" : "not-allowed",
              }}
            >
              {translate("sideChat.send")}
            </button>
          )}
        </div>
      </footer>
    </aside>
  );
}
