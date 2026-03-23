"use client";

import { useEffect, useState, useRef, useCallback, useReducer } from "react";
import type { SessionInfo, SessionTreeNode, AgentMessage } from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import { MessageView } from "./MessageView";
import { ChatInput } from "./ChatInput";
import { BranchNavigator } from "./BranchNavigator";
import { ToolPanel, type ToolEntry } from "./ToolPanel";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";

interface SessionData {
  sessionId: string;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "end" }
  | { type: "reset" };

function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingMessage: null };
    case "update":
      return { isStreaming: true, streamingMessage: action.message };
    case "end":
    case "reset":
      return { isStreaming: false, streamingMessage: null };
    default:
      return state;
  }
}

interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
}

export function ChatWindow({ session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked }: Props) {
  const isNew = session === null && newSessionCwd !== null;

  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [streamState, dispatch] = useReducer(streamReducer, {
    isStreaming: false,
    streamingMessage: null,
  });
  const [agentRunning, setAgentRunning] = useState(false);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<{ id: string; name: string; provider: string }[]>([]);
  // For new sessions, allow pre-selecting a model before the first message is sent
  const [newSessionModel, setNewSessionModel] = useState<{ provider: string; modelId: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const messageRefs = useMessageRefs(visibleMessages.length);
  const eventSourceRef = useRef<EventSource | null>(null);
  // Always holds the current real session id once known
  const sessionIdRef = useRef<string | null>(session?.id ?? null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const loadSession = useCallback(async (sid: string, showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}`);
      if (res.status === 404) {
        if (showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setError(null);
        }
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as SessionData;
      setData(d);
      setActiveLeafId(d.leafId);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setCurrentModelOverride(null);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const loadContext = useCallback(async (sid: string, leafId: string | null) => {
    try {
      const url = leafId
        ? `/api/sessions/${encodeURIComponent(sid)}/context?leafId=${encodeURIComponent(leafId)}`
        : `/api/sessions/${encodeURIComponent(sid)}/context`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { context: { messages: AgentMessage[] } };
      setMessages(d.context.messages);
    } catch (e) {
      console.error("Failed to load context:", e);
    }
  }, []);

  const connectEvents = useCallback((sid: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    const es = new EventSource(`/api/agent/${encodeURIComponent(sid)}/events`);
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as AgentEvent;
        handleAgentEvent(event);
      } catch {
        // ignore
      }
    };
    es.onerror = () => { /* silent */ };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "agent_start":
        setAgentRunning(true);
        dispatch({ type: "start" });
        break;
      case "agent_end":
        setAgentRunning(false);
        dispatch({ type: "end" });
        // Reload from file to get toolResult pairing and accurate final state
        if (sessionIdRef.current) loadSession(sessionIdRef.current);
        onAgentEnd?.();
        break;
      case "message_update": {
        const msg = event.message as Partial<AgentMessage> | undefined;
        if (msg) {
          dispatch({ type: "update", message: normalizeToolCalls(msg as AgentMessage) });
        }
        break;
      }
      case "message_end": {
        const completed = event.message as AgentMessage | undefined;
        if (completed) {
          setMessages((prev) => [...prev, normalizeToolCalls(completed)]);
        }
        dispatch({ type: "reset" });
        break;
      }
      case "auto_compaction_start":
        setIsCompacting(true);
        setCompactError(null);
        break;
      case "auto_compaction_end":
        setIsCompacting(false);
        if (event.errorMessage) {
          setCompactError(event.errorMessage as string);
        } else if (!event.aborted) {
          // Reload session to display the compaction summary
          if (sessionIdRef.current) loadSession(sessionIdRef.current);
        }
        break;
    }
  }, [loadSession, onAgentEnd]);

  // On mount: load existing session, or show empty chat for new session
  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then((d: { models: Record<string, string>; modelList?: { id: string; name: string; provider: string }[]; defaultModel?: { provider: string; modelId: string } | null }) => {
      setModelNames(d.models);
      if (d.modelList) {
        setModelList(d.modelList);
        if (isNew && d.modelList.length > 0) {
          // Use pi's saved default model from settings.json, fallback to first available
          const def = d.defaultModel;
          const match = def && d.modelList.find((m) => m.id === def.modelId && m.provider === def.provider);
          const selected = match
            ? { provider: match.provider, modelId: match.id }
            : { provider: d.modelList[0].provider, modelId: d.modelList[0].id };
          setNewSessionModel(selected);
        }
      }
    }).catch(() => {});

    if (session) {
      sessionIdRef.current = session.id;
      loadSession(session.id, true);
      // If the agent is already running (e.g. page refresh mid-stream), reconnect SSE
      // Also sync agent state (thinking level, auto flags)
      fetch(`/api/agent/${encodeURIComponent(session.id)}`)
        .then((r) => r.json())
        .then((d: { running?: boolean; state?: { isStreaming?: boolean; thinkingLevel?: string; isCompacting?: boolean } }) => {
          if (d.running && d.state?.isStreaming) {
            setAgentRunning(true);
            connectEvents(session.id);
          }
          if (d.state) {
            if (d.state.thinkingLevel) setThinkingLevel(d.state.thinkingLevel);
            if (d.state.isCompacting !== undefined) setIsCompacting(d.state.isCompacting);
          }
        })
        .catch(() => {});
    }
    // isNew: nothing to load, just show empty chat
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (messages.length > 0) setTimeout(scrollToBottom, 50);
  }, [messages.length, scrollToBottom]);

  const handleLeafChange = useCallback(async (leafId: string | null) => {
    setActiveLeafId(leafId);
    const sid = sessionIdRef.current;
    if (!sid) return;
    // Update display context
    await loadContext(sid, leafId);
    // Tell the agent to navigate to this node so next prompt branches from here
    if (leafId) {
      fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "navigate_tree", targetId: leafId }),
      }).catch(() => {});
    }
  }, [loadContext]);

  const handleSend = useCallback(async (message: string) => {
    if (!message.trim() || agentRunning) return;

    const userMsg: AgentMessage = {
      role: "user",
      content: message,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setAgentRunning(true);
    dispatch({ type: "start" });
    scrollToBottom();

    try {
      if (isNew && newSessionCwd) {
        // Brand-new session: single POST that spawns pi and sends the message
        const selectedModel = newSessionModel;
        const res = await fetch("/api/agent/new", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd: newSessionCwd,
            type: "prompt",
            message,
            ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { sessionId: string };
        const realId = data.sessionId;

        // Now we have the real id — connect SSE and update parent
        sessionIdRef.current = realId;
        connectEvents(realId);
        onSessionCreated?.({
          id: realId,
          path: "",
          cwd: newSessionCwd,
          name: undefined,
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          messageCount: 1,
          firstMessage: message,
        });
      } else if (session) {
        // Existing session: connect SSE then POST
        connectEvents(session.id);
        const res = await fetch(`/api/agent/${encodeURIComponent(session.id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "prompt", message }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      console.error("Failed to send message:", e);
      setAgentRunning(false);
      dispatch({ type: "end" });
    }
  }, [isNew, newSessionCwd, newSessionModel, session, agentRunning, scrollToBottom, connectEvents, onSessionCreated]);

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "abort" }),
      });
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, []);

  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);

  const handleFork = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setForkingEntryId(entryId);
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "fork", entryId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { success?: boolean; data?: { cancelled?: boolean; newSessionId?: string } };
      const { cancelled, newSessionId } = data.data ?? {};
      if (!cancelled && newSessionId) {
        onSessionForked?.(newSessionId);
      }
    } catch (e) {
      console.error("Fork failed:", e);
    } finally {
      setForkingEntryId(null);
    }
  }, [onSessionForked]);

  const handleNavigate = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    // Update leaf pointer in agent
    fetch(`/api/agent/${encodeURIComponent(sid)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "navigate_tree", targetId: entryId }),
    }).catch(() => {});
    // Update display to show history up to this node
    setActiveLeafId(entryId);
    await loadContext(sid, entryId);
  }, [loadContext]);

  const [currentModelOverride, setCurrentModelOverride] = useState<{ provider: string; modelId: string } | null>(null);
  const currentModel = currentModelOverride ?? data?.context.model ?? null;
  const displayModel = isNew ? newSessionModel : currentModel;

  const [thinkingLevel, setThinkingLevel] = useState<string>("off");
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  useEffect(() => {
    if (!compactError) return;
    const t = setTimeout(() => setCompactError(null), 3000);
    return () => clearTimeout(t);
  }, [compactError]);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [toolPanelOpen, setToolPanelOpen] = useState(false);

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    if (isNew) {
      setNewSessionModel({ provider, modelId });
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "set_model", provider, modelId }),
      });
      setCurrentModelOverride({ provider, modelId });
    } catch (e) {
      console.error("Failed to set model:", e);
    }
  }, [isNew]);

  const handleThinkingLevelChange = useCallback(async (level: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setThinkingLevel(level);
    try {
      await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "set_thinking_level", level }),
      });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
    }
  }, []);

  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isCompacting) return;
    setIsCompacting(true);
    setCompactError(null);
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "compact" }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || data.error) {
        setCompactError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      await loadSession(sid, true);
    } catch (e) {
      setCompactError(String(e));
    } finally {
      setIsCompacting(false);
    }
  }, [isCompacting, loadSession]);

  const handleSteer = useCallback(async (message: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "steer", message }),
      });
    } catch (e) {
      console.error("Failed to steer:", e);
    }
  }, []);

  const handleFollowUp = useCallback(async (message: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "follow_up", message }),
      });
    } catch (e) {
      console.error("Failed to follow up:", e);
    }
  }, []);

  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "abort_compaction" }),
      });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
    }
  }, []);

  const loadTools = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "get_tools" }),
      });
      if (!res.ok) return;
      const data = await res.json() as { success?: boolean; data?: ToolEntry[] };
      if (data.data) setTools(data.data);
    } catch (e) {
      console.error("Failed to load tools:", e);
    }
  }, []);

  const handleToolsClick = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    // Load tools fresh each time panel opens
    await loadTools(sid);
    setToolPanelOpen(true);
  }, [loadTools]);

  const handleToolToggle = useCallback(async (name: string, active: boolean) => {
    // Optimistic update
    setTools(prev => prev.map(t => t.name === name ? { ...t, active } : t));
    const sid = sessionIdRef.current;
    if (!sid) return;
    // Compute new active list based on updated tools
    const newActiveNames = tools
      .map(t => t.name === name ? { ...t, active } : t)
      .filter(t => t.active)
      .map(t => t.name);
    try {
      await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "set_tools", toolNames: newActiveNames }),
      });
    } catch (e) {
      console.error("Failed to set tools:", e);
      // Revert on error
      setTools(prev => prev.map(t => t.name === name ? { ...t, active: !active } : t));
    }
  }, [tools]);

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
        Loading session...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171" }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {data && data.tree.length > 0 && (
        <BranchNavigator
          tree={data.tree}
          activeLeafId={activeLeafId}
          onLeafChange={handleLeafChange}
        />
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <div ref={scrollContainerRef} style={{ flex: 1, overflowY: "auto", padding: "16px 0" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 16px" }}>
          {(() => {
            // Build toolCallId -> ToolResultMessage map for inline pairing
            const toolResultsMap = new Map<string, import("@/lib/types").ToolResultMessage>();
            for (const msg of messages) {
              if (msg.role === "toolResult") {
                toolResultsMap.set((msg as import("@/lib/types").ToolResultMessage).toolCallId, msg as import("@/lib/types").ToolResultMessage);
              }
            }
            let refIdx = 0;
            return messages.map((msg, idx) => {
              // For user messages, find the previous assistant's entryId for "Continue" button
              const prevAssistantEntryId =
                msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
                  ? entryIds[idx - 1]
                  : undefined;
              const isVisible = msg.role === "user" || msg.role === "assistant";
              const currentRefIdx = isVisible ? refIdx++ : -1;
              const view = (
                <MessageView
                  key={idx}
                  message={msg}
                  toolResults={toolResultsMap}
                  modelNames={modelNames}
                  entryId={entryIds[idx]}
                  onFork={agentRunning || isNew || (idx === 0 && msg.role === "user") ? undefined : handleFork}
                  forking={forkingEntryId === entryIds[idx]}
                  onNavigate={agentRunning ? undefined : handleNavigate}
                  prevAssistantEntryId={agentRunning ? undefined : prevAssistantEntryId}
                />
              );
              if (!isVisible) return view;
              return (
                <div key={idx} ref={(el) => { messageRefs.current[currentRefIdx] = el; }}>
                  {view}
                </div>
              );
            });
          })()}

          {streamState.isStreaming && streamState.streamingMessage && (
            <MessageView message={streamState.streamingMessage as AgentMessage} isStreaming modelNames={modelNames} />
          )}

          {streamState.isStreaming && !streamState.streamingMessage && (
            <div style={{ padding: "8px 0", color: "var(--text-muted)", fontSize: 13 }}>
              <span style={{ animation: "pulse 1.5s infinite" }}>Thinking...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>
      <ChatMinimap
        messages={messages}
        streamingMessage={streamState.streamingMessage}
        scrollContainer={scrollContainerRef}
        messageRefs={messageRefs}
      />
      </div>

      <div style={{ position: "relative" }}>
        {toolPanelOpen && tools.length > 0 && (
          <div style={{ position: "absolute", bottom: "100%", right: 16, zIndex: 200 }}>
            <ToolPanel
              tools={tools}
              onToggle={handleToolToggle}
              onClose={() => setToolPanelOpen(false)}
            />
          </div>
        )}
        <ChatInput
          onSend={handleSend}
          onAbort={handleAbort}
          onSteer={agentRunning ? handleSteer : undefined}
          onFollowUp={agentRunning ? handleFollowUp : undefined}
          isStreaming={agentRunning}
          model={displayModel}
          modelNames={modelNames}
          modelList={modelList}
          onModelChange={handleModelChange}
          thinkingLevel={thinkingLevel}
          onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
          onCompact={session || isNew ? handleCompact : undefined}
          onAbortCompaction={handleAbortCompaction}
          isCompacting={isCompacting}
          compactError={compactError}
          onToolsClick={session || isNew ? handleToolsClick : undefined}
        />
      </div>
    </div>
  );
}
