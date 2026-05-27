"use client";

import { useEffect, useRef, useState, useCallback, useMemo, RefObject } from "react";
import type { AgentMessage, AssistantMessage, TextContent } from "@/lib/types";

interface Props {
  messages: AgentMessage[];
  streamingMessage: Partial<AgentMessage> | null;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
}

const MINIMAP_WIDTH = 36;
const COLLAPSED_MINIMAP_WIDTH = 12;
const TOOLTIP_HEIGHT = 44; // Adjusted for double-line layout

function getMessagePreview(msg: AgentMessage | Partial<AgentMessage>): string {
  if (msg.role === "user") {
    const content = msg.content;
    if (typeof content === "string") return content.slice(0, 150);
    if (Array.isArray(content)) {
      return (content as { type: string; text?: string }[])
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("\n")
        .slice(0, 150);
    }
    return "";
  }
  if (msg.role === "assistant") {
    const blocks = (msg as Partial<AssistantMessage>).content ?? [];
    const text = blocks
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join(" ");
    if (text) return text.slice(0, 150);
    const toolNames = blocks
      .filter((b) => b.type === "toolCall")
      .map((b) => (b as { type: string; toolName: string }).toolName);
    if (toolNames.length) return `调用了工具: ${toolNames.join(", ")}`;
    return "";
  }
  return "";
}

function getNodeColor(msg: AgentMessage | Partial<AgentMessage>): { bg: string; border: string } {
  if (msg.role === "user") {
    return { bg: "var(--accent)", border: "var(--accent)" };
  }
  return { bg: "var(--text-dim)", border: "var(--text-muted)" };
}

function hasTextContent(msg: AgentMessage | Partial<AgentMessage>): boolean {
  if (msg.role === "user") return true;
  if (msg.role === "assistant") {
    const blocks = (msg as Partial<AssistantMessage>).content ?? [];
    return blocks.some((b) => b.type === "text" || b.type === "toolCall");
  }
  return false;
}

interface NodeInfo {
  topRatio: number;   // 0–1 within total scroll height
  heightRatio: number;
  msg: AgentMessage | Partial<AgentMessage>;
  index: number;      // index in nodes array (0, 1, 2...)
  refIndex: number;   // index in messageRefs.current
}

export function ChatMinimap({ messages, streamingMessage, scrollContainer, messageRefs }: Props) {
  const [scrollRatio, setScrollRatio] = useState(0);
  const [viewportRatio, setViewportRatio] = useState(1);
  const [visible, setVisible] = useState(false);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [minimapHovered, setMinimapHovered] = useState(false);
  const [mouseYRatio, setMouseYRatio] = useState<number | null>(null);

  // Persistent user preference for closing/collapsing minimap list
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("pi-minimap-expanded");
        return stored !== "false"; // Default true
      } catch {}
    }
    return true;
  });

  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUpdateNodesRef = useRef<number>(0);
  const scrollUpdateFrameRef = useRef<number | null>(null);

  const toggleMinimap = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("pi-minimap-expanded", String(next));
      } catch {}
      return next;
    });
  }, []);

  const allMessages = useMemo(
    () => (streamingMessage ? [...messages, streamingMessage] : messages) as (AgentMessage | Partial<AgentMessage>)[],
    [messages, streamingMessage]
  );
  const allMessagesRef = useRef(allMessages);
  allMessagesRef.current = allMessages;

  // 1. FAST scroll state synchronizer inside requestAnimationFrame (Lag prevention!)
  const updateScrollState = useCallback(() => {
    if (scrollUpdateFrameRef.current !== null) return;

    scrollUpdateFrameRef.current = requestAnimationFrame(() => {
      scrollUpdateFrameRef.current = null;
      const scrollEl = scrollContainer.current;
      if (!scrollEl) return;

      const totalH = scrollEl.scrollHeight;
      const clientH = scrollEl.clientHeight;
      const scrollable = totalH - clientH;

      setVisible(scrollable > 20);
      if (scrollable <= 0) {
        setScrollRatio(0);
        setViewportRatio(1);
      } else {
        setScrollRatio(scrollEl.scrollTop / scrollable);
        setViewportRatio(clientH / totalH);
      }
    });
  }, [scrollContainer]);

  // 2. SLOW node measurer throttled/debounced to keep the browser responsive, especially during message streams
  const throttleUpdateNodes = useCallback(() => {
    const scheduleDelay = 150; // max resolution refresh: once every 150ms

    const run = () => {
      lastUpdateNodesRef.current = Date.now();
      const scrollEl = scrollContainer.current;
      if (!scrollEl) return;

      const totalH = scrollEl.scrollHeight;
      if (totalH <= 0) {
        setNodes([]);
        return;
      }

      const refs = messageRefs.current;
      const newNodes: NodeInfo[] = [];
      let refIndex = 0;

      const allMessages = allMessagesRef.current;
      for (let i = 0; i < allMessages.length; i++) {
        const msg = allMessages[i];
        if (msg.role !== "user" && msg.role !== "assistant") continue;

        const el = refs?.[refIndex];
        refIndex++;

        // Show only user messages as minimap anchor points
        if (msg.role !== "user") continue;

        if (el) {
          const elRect = el.getBoundingClientRect();
          const containerRect = scrollEl.getBoundingClientRect();
          const top = elRect.top - containerRect.top + scrollEl.scrollTop;
          const h = elRect.height;
          newNodes.push({
            topRatio: top / totalH,
            heightRatio: h / totalH,
            msg,
            index: newNodes.length, // sequential index in this filtered array
            refIndex: refIndex - 1, // actual index in messageRefs.current
          });
        }
      }
      setNodes(newNodes);
    };

    if (nodeTimeoutRef.current) {
      clearTimeout(nodeTimeoutRef.current);
    }

    const elapsed = Date.now() - lastUpdateNodesRef.current;
    if (elapsed >= scheduleDelay) {
      run();
    } else {
      nodeTimeoutRef.current = setTimeout(run, scheduleDelay - elapsed);
    }
  }, [scrollContainer, messageRefs]);

  // Listening to scrolling & layouts
  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;

    // Fast scroll updates (No bounding rect fetches!)
    const handleScroll = () => {
      updateScrollState();
    };

    el.addEventListener("scroll", handleScroll, { passive: true });

    // Slow layout resize updates (Throttled measuring!)
    const handleResize = () => {
      updateScrollState();
      throttleUpdateNodes();
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);

    // Run first layout computation
    handleResize();

    return () => {
      el.removeEventListener("scroll", handleScroll);
      ro.disconnect();
      if (nodeTimeoutRef.current) clearTimeout(nodeTimeoutRef.current);
      if (scrollUpdateFrameRef.current) cancelAnimationFrame(scrollUpdateFrameRef.current);
    };
  }, [scrollContainer, updateScrollState, throttleUpdateNodes]);

  // Re-measure when messages length changes (e.g. after a chunk finishes or a new round gets sent)
  useEffect(() => {
    updateScrollState();
    throttleUpdateNodes();
  }, [messages.length, updateScrollState, throttleUpdateNodes]);

  const scrollToMinimapRatio = useCallback((viewportTopRatio: number) => {
    const el = scrollContainer.current;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    if (scrollable <= 0) return;
    const clamped = Math.max(0, Math.min(1 - viewportRatio, viewportTopRatio));
    el.scrollTop = (clamped / (1 - viewportRatio)) * scrollable;
  }, [scrollContainer, viewportRatio]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!visible || !expanded) return;

    const el = scrollContainer.current;
    if (!el) return;

    draggingRef.current = true;
    const dragContainer = containerRef.current;
    if (!dragContainer) return;

    const rect = dragContainer.getBoundingClientRect();
    const clickRatio = (e.clientY - rect.top) / rect.height;

    const totalH = el.scrollHeight;
    const clientH = el.clientHeight;
    const scrollable = totalH - clientH;
    const currentViewportRatio = clientH / totalH;
    const currentScrollRatio = scrollable > 0 ? el.scrollTop / scrollable : 0;

    const grabOffset = clickRatio - currentScrollRatio * (1 - currentViewportRatio);
    const insideBox = grabOffset >= 0 && grabOffset <= currentViewportRatio;
    const offset = insideBox ? grabOffset : currentViewportRatio / 2;

    const scrollLocal = (ratio: number) => {
      const liveTotalH = el.scrollHeight;
      const liveClientH = el.clientHeight;
      const liveScrollable = liveTotalH - liveClientH;
      if (liveScrollable <= 0) return;
      const liveViewportRatio = liveClientH / liveTotalH;
      const clamped = Math.max(0, Math.min(1 - liveViewportRatio, ratio));
      el.scrollTop = (clamped / (1 - liveViewportRatio)) * liveScrollable;
    };

    scrollLocal(clickRatio - offset);

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const liveRect = dragContainer.getBoundingClientRect();
      const r = (ev.clientY - liveRect.top) / liveRect.height;
      scrollLocal(r - offset);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [visible, expanded, scrollContainer]);

  if (!visible) return null;

  const viewportBoxTop = scrollRatio * (1 - viewportRatio) * 100;
  const viewportBoxHeight = viewportRatio * 100;

  // Find the single node closest to the current mouse cursor vertical position
  const nearestIndex = mouseYRatio !== null && nodes.length > 0
    ? nodes.reduce((best, node) => {
        return Math.abs(node.topRatio - mouseYRatio) < Math.abs(nodes[best].topRatio - mouseYRatio) ? node.index : best;
      }, 0)
    : null;

  const nearestNode = nearestIndex !== null ? nodes[nearestIndex] : null;
  const minimapHeightPx = containerRef.current?.clientHeight ?? 500;

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setMinimapHovered(true)}
      onMouseLeave={() => { setMinimapHovered(false); setMouseYRatio(null); }}
      onMouseMove={(e) => {
        if (!expanded) return;
        const rect = e.currentTarget.getBoundingClientRect();
        setMouseYRatio((e.clientY - rect.top) / rect.height);
      }}
      style={{
        width: expanded ? MINIMAP_WIDTH : COLLAPSED_MINIMAP_WIDTH,
        flexShrink: 0,
        position: "relative",
        cursor: "default",
        userSelect: "none",
        borderLeft: "1px solid var(--border)",
        background: "var(--bg-panel)",
        overflow: "visible",
        transition: "width 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {/* Absolute Fold/Unfolds Floating Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleMinimap();
        }}
        title={expanded ? "收起缩略图 (Hide Minimap)" : "展开缩略图 (Show Minimap)"}
        style={{
          position: "absolute",
          top: 6,
          left: "50%",
          transform: "translateX(-50%)",
          width: 14,
          height: 14,
          borderRadius: 3,
          background: "var(--bg-hover)",
          border: "1px solid var(--border)",
          color: "var(--text-dim)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 8,
          zIndex: 10,
          opacity: minimapHovered ? 0.9 : 0.2,
          transition: "opacity 0.15s, background 0.1s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-selected)";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text-dim)";
        }}
      >
        {expanded ? "→" : "←"}
      </button>

      {expanded && (
        <>
          {/* Viewport indicator */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${viewportBoxTop}%`,
              height: `${viewportBoxHeight}%`,
              background: "rgba(100, 100, 100, 0.12)",
              borderTop: "1px solid rgba(100, 100, 100, 0.25)",
              borderBottom: "1px solid rgba(100, 100, 100, 0.25)",
              pointerEvents: "none",
              zIndex: 1,
            }}
          />

          {/* Message nodes */}
          {nodes.map((node) => {
            const color = getNodeColor(node.msg);
            const isNearest = minimapHovered && nearestIndex === node.index;
            const isUser = node.msg.role === "user";
            const dotTop = node.topRatio * 100;

            return (
              <div
                key={node.index}
                onMouseDown={(e) => {
                  // Click dot directly to scroll smoothly to center of that message
                  e.stopPropagation();
                  e.preventDefault();
                  const el = messageRefs.current?.[node.refIndex];
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "center" });
                  }
                }}
                style={{
                  position: "absolute",
                  top: `${dotTop}%`,
                  transform: "translate(-50%, -50%)",
                  left: "50%",
                  width: "16px",
                  height: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  zIndex: 3,
                }}
              >
                {/* Dot */}
                <div
                  style={{
                    width: isUser ? 8 : 6,
                    height: isUser ? 8 : 6,
                    borderRadius: isUser ? 2 : "50%",
                    background: isNearest ? color.border : color.bg + "44", // Semi-transparent when not nearest, beautifully highlighting hierarchy
                    border: `1.5px solid ${color.border}`,
                    flexShrink: 0,
                    transition: "transform 0.15s, background-color 0.15s",
                    transform: isNearest ? "scale(1.5)" : "scale(1)",
                    boxShadow: isNearest ? "0 0 6px var(--accent)" : "none",
                  }}
                />
              </div>
            );
          })}

          {/* Center vertical gutter line */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: 0,
              bottom: 0,
              width: 1,
              background: "var(--border)",
              transform: "translateX(-50%)",
              zIndex: 0,
              opacity: 0.5,
            }}
          />

          {/* Single, non-overlapping active hover tooltip */}
          {minimapHovered && nearestNode && (
            (() => {
              const preview = getMessagePreview(nearestNode.msg);
              if (!preview) return null;
              const color = getNodeColor(nearestNode.msg);
              const isUser = nearestNode.msg.role === "user";

              // Calculate precise pixel location matching mouse view height and constrain to bounds
              const idealTopPx = nearestNode.topRatio * minimapHeightPx - TOOLTIP_HEIGHT / 2;
              const constrainedTopPx = Math.max(0, Math.min(minimapHeightPx - TOOLTIP_HEIGHT - 12, idealTopPx));

              return (
                <div
                  style={{
                    position: "absolute",
                    top: constrainedTopPx,
                    right: "100%",
                    marginRight: 8,
                    background: "var(--bg)",
                    borderTop: "1px solid var(--border)",
                    borderRight: "1px solid var(--border)",
                    borderBottom: "1px solid var(--border)",
                    borderLeft: `3px solid ${color.border}`,
                    borderRadius: 6,
                    padding: "6px 10px",
                    width: 220,
                    zIndex: 100,
                    pointerEvents: "none",
                    opacity: 1,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.16), 0 2px 4px rgba(0,0,0,0.08)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    minHeight: TOOLTIP_HEIGHT,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: isUser ? "var(--accent)" : "var(--text)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      lineHeight: 1.2,
                    }}
                  >
                    <span>{isUser ? "🙋 用户提问" : "🤖 助理回答"}</span>
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text-muted)",
                      lineHeight: 1.4,
                      whiteSpace: "normal",
                      wordBreak: "break-all",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {preview}
                  </div>
                </div>
              );
            })()
          )}
        </>
      )}
    </div>
  );
}

// Hook to create a stable array of refs for messages
export function useMessageRefs(count: number): RefObject<(HTMLDivElement | null)[]> {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  refs.current = Array(count).fill(null).map((_, i) => refs.current[i] ?? null);
  return refs;
}
