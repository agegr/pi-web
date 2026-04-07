"use client";

import { useEffect, useState, useRef, useCallback, useReducer, useMemo } from "react";
import type { SessionInfo, SessionTreeNode, AgentMessage } from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import { MessageView } from "./MessageView";
import { ChatInput, type ChatInputHandle, type AttachedImage } from "./ChatInput";
import { type ToolEntry } from "./ToolPanel";
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
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
}

export function ChatWindow({ session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange }: Props) {
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
  const [toolPreset, setToolPreset] = useState<"none" | "default" | "full">("default");
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; errorMessage?: string } | null>(null);
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const messageRefs = useMessageRefs(visibleMessages.length);
  const eventSourceRef = useRef<EventSource | null>(null);
  // Always holds the current real session id once known
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  // Ref mirror of agentRunning for use in stable closures (e.g. SSE onerror)
  const agentRunningRef = useRef(false);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);

  const initialScrollDoneRef = useRef(false);
  // When true, suppress auto-scroll (viewport is locked during streaming)
  const scrollLockedRef = useRef(false);
  // Ref to the last sent user message element for scrolling it to top
  const lastUserMsgRef = useRef<HTMLDivElement>(null);
  // Set to true after send so the post-render effect scrolls the user msg to top
  const pendingScrollToUserRef = useRef(false);

  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleWindowDragEnter = useCallback((e: React.DragEvent) => {
    const hasImages = Array.from(e.dataTransfer.items).some((item) => item.type.startsWith("image/"));
    if (!hasImages) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleWindowDragOver = useCallback((e: React.DragEvent) => {
    const hasImages = Array.from(e.dataTransfer.items).some((item) => item.type.startsWith("image/"));
    if (!hasImages) return;
    e.preventDefault();
  }, []);

  const handleWindowDragLeave = useCallback((e: React.DragEvent) => {
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleWindowDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    chatInputRef?.current?.addImages(files);
  }, [chatInputRef]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const scrollUserMsgToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const el = lastUserMsgRef.current;
    if (!container || !el) return;
    const elAbsTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: elAbsTop - 16, behavior: "smooth" });
  }, []);

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false) => {
    try {
      if (showLoading) setLoading(true);
      const url = includeState
        ? `/api/sessions/${encodeURIComponent(sid)}?includeState`
        : `/api/sessions/${encodeURIComponent(sid)}`;
      const res = await fetch(url);
      if (res.status === 404) {
        if (showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setError(null);
        }
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as SessionData & { agentState?: { running: boolean; state?: { isStreaming?: boolean; isCompacting?: boolean; contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null; systemPrompt?: string } } };
      setData(d);
      setActiveLeafId(d.leafId);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setCurrentModelOverride(null);
      setError(null);
      return d.agentState ?? null;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const sessionStats = useMemo(() => {
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      const u = (msg as import("@/lib/types").AssistantMessage).usage;
      if (!u) continue;
      tokens.input += u.input ?? 0;
      tokens.output += u.output ?? 0;
      tokens.cacheRead += u.cacheRead ?? 0;
      tokens.cacheWrite += u.cacheWrite ?? 0;
    }
    const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    return total > 0 ? { tokens } : null;
  }, [messages]);

  const loadContext = useCallback(async (sid: string, leafId: string | null) => {
    try {
      const url = leafId
        ? `/api/sessions/${encodeURIComponent(sid)}/context?leafId=${encodeURIComponent(leafId)}`
        : `/api/sessions/${encodeURIComponent(sid)}/context`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { context: { messages: AgentMessage[]; entryIds: string[] } };
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
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
        handleAgentEventRef.current?.(event);
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      // Reconnect if agent is still running (e.g. after server timeout)
      if (eventSourceRef.current === es && agentRunningRef.current) {
        es.close();
        eventSourceRef.current = null;
        setTimeout(() => {
          if (agentRunningRef.current) connectEvents(sid);
        }, 1000);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "agent_start":
        setAgentRunning(true);
        dispatch({ type: "start" });
        break;
      case "agent_end":
        setAgentRunning(false);
        setRetryInfo(null);
        scrollLockedRef.current = false;
        dispatch({ type: "end" });
        if (sessionIdRef.current) {
          loadSession(sessionIdRef.current);
          // Refresh context usage after the turn completes
          fetch(`/api/agent/${encodeURIComponent(sessionIdRef.current)}`)
            .then((r) => r.json())
            .then((d: { state?: { contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null; systemPrompt?: string } }) => {
              if (d.state?.contextUsage !== undefined) setContextUsage(d.state.contextUsage ?? null);
              if (d.state?.systemPrompt !== undefined) setSystemPrompt(d.state.systemPrompt ?? null);
            })
            .catch(() => {});
        }
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
      case "auto_retry_start":
        setRetryInfo({ attempt: event.attempt as number, maxAttempts: event.maxAttempts as number, errorMessage: event.errorMessage as string | undefined });
        break;
      case "auto_retry_end":
        setRetryInfo(null);
        break;
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
  handleAgentEventRef.current = handleAgentEvent;

  // Fetch model list — re-runs whenever modelsRefreshKey changes (e.g. after ModelsConfig save/OAuth login)
  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then((d: { models: Record<string, string>; modelList?: { id: string; name: string; provider: string }[]; defaultModel?: { provider: string; modelId: string } | null }) => {
      setModelNames(d.models);
      if (d.modelList) {
        setModelList(d.modelList);
        if (isNew && d.modelList.length > 0) {
          const def = d.defaultModel;
          const match = def && d.modelList.find((m) => m.id === def.modelId && m.provider === def.provider);
          const selected = match
            ? { provider: match.provider, modelId: match.id }
            : { provider: d.modelList[0].provider, modelId: d.modelList[0].id };
          setNewSessionModel(selected);
        }
      }
    }).catch(() => {});
  }, [isNew, modelsRefreshKey]);

  // On mount: load existing session, or show empty chat for new session
  useEffect(() => {

    if (session) {
      sessionIdRef.current = session.id;
      // Single request: load session content + agent state together
      loadSession(session.id, true, true).then((agentState) => {
        if (!agentState) return;
        if (agentState.running) {
          loadTools(session.id);
          if (agentState.state?.isStreaming) {
            setAgentRunning(true);
            connectEvents(session.id);
          }
        }
        if (agentState.state) {
          if (agentState.state.isCompacting !== undefined) setIsCompacting(agentState.state.isCompacting);
          if (agentState.state.contextUsage !== undefined) setContextUsage(agentState.state.contextUsage ?? null);
          if (agentState.state.systemPrompt !== undefined) setSystemPrompt(agentState.state.systemPrompt ?? null);
        }
      });
    }
    // isNew: nothing to load, just show empty chat
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);

  useEffect(() => {
    onSystemPromptChange?.(systemPrompt);
  }, [systemPrompt, onSystemPromptChange]);



  useEffect(() => {
    if (messages.length > 0) {
      if (pendingScrollToUserRef.current) {
        pendingScrollToUserRef.current = false;
        initialScrollDoneRef.current = true;
        scrollUserMsgToTop();
      } else if (!initialScrollDoneRef.current) {
        initialScrollDoneRef.current = true;
        scrollToBottom("instant");
      } else if (!scrollLockedRef.current) {
        scrollToBottom("smooth");
      }
    }
  }, [messages.length, scrollToBottom, scrollUserMsgToTop]);

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

  useEffect(() => {
    if (!onBranchDataChange) return;
    onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChange);
  }, [data?.tree, activeLeafId, handleLeafChange, onBranchDataChange]);

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]) => {
    if (!message.trim() && !images?.length) return;
    if (agentRunning) return;

    const imageBlocks = images?.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType, data: img.data } }));
    const userMsg: AgentMessage = {
      role: "user",
      content: imageBlocks?.length
        ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks]
        : message,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setAgentRunning(true);
    dispatch({ type: "start" });
    scrollLockedRef.current = true;
    pendingScrollToUserRef.current = true;

    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));

    try {
      if (isNew && newSessionCwd) {
        // Brand-new session: single POST that spawns pi and sends the message
        const selectedModel = newSessionModel;
        const { PRESET_NONE, PRESET_DEFAULT, PRESET_FULL } = await import("./ToolPanel");
        const toolNames = toolPreset === "none" ? PRESET_NONE : toolPreset === "default" ? PRESET_DEFAULT : PRESET_FULL;
        const res = await fetch("/api/agent/new", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd: newSessionCwd,
            type: "prompt",
            message,
            toolNames,
            ...(piImages?.length ? { images: piImages } : {}),
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
          body: JSON.stringify({ type: "prompt", message, ...(piImages?.length ? { images: piImages } : {}) }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      console.error("Failed to send message:", e);
      setAgentRunning(false);
      scrollLockedRef.current = false;
      dispatch({ type: "end" });
    }
  }, [isNew, newSessionCwd, newSessionModel, toolPreset, session, agentRunning, connectEvents, onSessionCreated]);

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

  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  useEffect(() => {
    if (!compactError) return;
    const t = setTimeout(() => setCompactError(null), 3000);
    return () => clearTimeout(t);
  }, [compactError]);
  const setToolPresetPersist = useCallback((preset: "none" | "default" | "full") => {
    setToolPreset(preset);
  }, []);

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

  const handleSteer = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setMessages((prev) => [...prev, { role: "user", content: `[steer] ${message}`, timestamp: Date.now() } as AgentMessage]);
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "steer", message, ...(piImages?.length ? { images: piImages } : {}) }),
      });
    } catch (e) {
      console.error("Failed to steer:", e);
    }
  }, []);

  const handleFollowUp = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setMessages((prev) => [...prev, { role: "user", content: message, timestamp: Date.now() } as AgentMessage]);
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "follow_up", message, ...(piImages?.length ? { images: piImages } : {}) }),
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
      if (data.data) {
        const { getPresetFromTools } = await import("./ToolPanel");
        setToolPresetPersist(getPresetFromTools(data.data));
      }
    } catch (e) {
      console.error("Failed to load tools:", e);
    }
  }, [setToolPresetPersist]);

  const handleToolPresetChange = useCallback(async (preset: "none" | "default" | "full") => {
    const { PRESET_NONE, PRESET_DEFAULT, PRESET_FULL } = await import("./ToolPanel");
    const toolNames = preset === "none" ? PRESET_NONE : preset === "default" ? PRESET_DEFAULT : PRESET_FULL;
    setToolPresetPersist(preset);
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "set_tools", toolNames }),
      });
    } catch (e) {
      console.error("Failed to set tools:", e);
    }
  }, [setToolPresetPersist]);

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
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}
      onDragEnter={handleWindowDragEnter}
      onDragOver={handleWindowDragOver}
      onDragLeave={handleWindowDragLeave}
      onDrop={handleWindowDrop}
    >
      {isDragOver && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 50,
          background: "rgba(37,99,235,0.06)",
          backdropFilter: "blur(1px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
          animation: "drop-zone-in 0.15s ease both",
        }}>
          {/* ripple rings emanating from centre */}
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            {[0, 0.8, 1.6].map((delay) => (
              <div key={delay} style={{
                position: "absolute",
                width: 720, height: 720,
                borderRadius: "50%",
                border: "1.5px solid rgba(37,99,235,0.5)",
                animation: `drop-ripple 2.4s ease-out ${delay}s infinite backwards`,
                transformOrigin: "center",
              }} />
            ))}
          </div>
          {/* centre SVG — 2× size, no card/border wrapper */}
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
            style={{ filter: "drop-shadow(0 6px 18px rgba(37,99,235,0.18))" }}
          >

            {/* photo frame */}
            <rect x="28" y="44" width="84" height="60" rx="8" fill="rgba(37,99,235,0.08)" stroke="rgba(37,99,235,0.50)" strokeWidth="1.8"/>

            {/* mountain silhouette */}
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="rgba(37,99,235,0.16)" stroke="rgba(37,99,235,0.40)" strokeWidth="1.4" strokeLinejoin="round"/>

            {/* sun */}
            <circle cx="96" cy="58" r="8" fill="rgba(37,99,235,0.22)" stroke="rgba(37,99,235,0.55)" strokeWidth="1.6"/>

            {/* sun rays */}
            <g stroke="rgba(37,99,235,0.45)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}


      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
      <div ref={scrollContainerRef} style={{ flex: 1, overflowY: "auto", padding: "16px 0", scrollbarWidth: "none" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 16px" }}>

          {(() => {
            // Build toolCallId -> ToolResultMessage map for inline pairing
            const toolResultsMap = new Map<string, import("@/lib/types").ToolResultMessage>();
            for (const msg of messages) {
              if (msg.role === "toolResult") {
                toolResultsMap.set((msg as import("@/lib/types").ToolResultMessage).toolCallId, msg as import("@/lib/types").ToolResultMessage);
              }
            }
            // Index of the last user message (for scroll-to-top on send)
            let lastUserIdx = -1;
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].role === "user") { lastUserIdx = i; break; }
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
                  onEditContent={(content) => chatInputRef?.current?.insertIfEmpty(content)}
                />
              );
              if (!isVisible) return view;
              return (
                <div key={idx} ref={(el) => {
                  messageRefs.current[currentRefIdx] = el;
                  if (idx === lastUserIdx) { (lastUserMsgRef as { current: HTMLDivElement | null }).current = el; }
                }}>
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

          {agentRunning && (
            <div style={{ height: scrollContainerRef.current ? scrollContainerRef.current.clientHeight : "80vh" }} />
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
        <ChatInput
          ref={chatInputRef}
          onSend={handleSend}
          onAbort={handleAbort}
          onSteer={agentRunning ? handleSteer : undefined}
          onFollowUp={agentRunning ? handleFollowUp : undefined}
          isStreaming={agentRunning}
          model={displayModel}
          modelNames={modelNames}
          modelList={modelList}
          onModelChange={handleModelChange}
          onCompact={session || isNew ? handleCompact : undefined}
          onAbortCompaction={handleAbortCompaction}
          isCompacting={isCompacting}
          compactError={compactError}
          toolPreset={toolPreset}
          onToolPresetChange={session || isNew ? handleToolPresetChange : undefined}
          sessionStats={sessionStats}
          retryInfo={retryInfo}
          contextUsage={contextUsage}
        />
      </div>

    </div>
  );
}
