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

function getMessagePreview(msg: AgentMessage | Partial<AgentMessage>): string {
  if (msg.role === "user") {
    const content = msg.content;
    if (typeof content === "string") return content.slice(0, 200);
    if (Array.isArray(content)) {
      return (content as { type: string; text?: string }[])
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("\n")
        .slice(0, 200);
    }
    return "";
  }
  if (msg.role === "assistant") {
    const blocks = (msg as Partial<AssistantMessage>).content ?? [];
    const text = blocks
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join(" ");
    if (text) return text.slice(0, 200);
    const toolNames = blocks
      .filter((b) => b.type === "toolCall")
      .map((b) => (b as { type: string; toolName: string }).toolName);
    if (toolNames.length) return toolNames.join(", ");
    return "";
  }
  return "";
}

function getNodeColor(msg: AgentMessage | Partial<AgentMessage>): { bg: string; border: string } {
  if (msg.role === "user") {
    return { bg: "rgba(37,99,235,0.18)", border: "rgba(37,99,235,0.7)" };
  }
  return { bg: "rgba(107,114,128,0.12)", border: "rgba(107,114,128,0.5)" };
}

function hasTextContent(msg: AgentMessage | Partial<AgentMessage>): boolean {
  if (msg.role === "user") return true;
  if (msg.role === "assistant") {
    const blocks = (msg as Partial<AssistantMessage>).content ?? [];
    return blocks.some((b) => b.type === "text");
  }
  return false;
}

interface NodeInfo {
  topRatio: number;   // 0–1 within total scroll height
  heightRatio: number;
  msg: AgentMessage | Partial<AgentMessage>;
  index: number;
}

export function ChatMinimap({ messages, streamingMessage, scrollContainer, messageRefs }: Props) {
  const [scrollRatio, setScrollRatio] = useState(0);
  const [viewportRatio, setViewportRatio] = useState(1);
  const [visible, setVisible] = useState(false);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [minimapHovered, setMinimapHovered] = useState(false);
  const [mouseYRatio, setMouseYRatio] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const allMessages = useMemo(
    () => (streamingMessage ? [...messages, streamingMessage] : messages) as (AgentMessage | Partial<AgentMessage>)[],
    [messages, streamingMessage]
  );

  const updatePositions = useCallback(() => {
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

    // Build node positions from real DOM refs
    const refs = messageRefs.current;
    const newNodes: NodeInfo[] = [];
    let refIndex = 0;

    for (let i = 0; i < allMessages.length; i++) {
      const msg = allMessages[i];
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      if (!hasTextContent(msg)) continue;

      const el = refs?.[refIndex];
      refIndex++;

      if (el && totalH > 0) {
        const top = el.offsetTop;
        const h = el.offsetHeight;
        newNodes.push({
          topRatio: top / totalH,
          heightRatio: h / totalH,
          msg,
          index: newNodes.length,
        });
      }
    }
    setNodes(newNodes);
  }, [scrollContainer, messageRefs, allMessages]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    el.addEventListener("scroll", updatePositions, { passive: true });
    const ro = new ResizeObserver(updatePositions);
    ro.observe(el);
    // Also observe the scroll content for height changes
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    updatePositions();
    return () => {
      el.removeEventListener("scroll", updatePositions);
      ro.disconnect();
    };
  }, [scrollContainer, updatePositions]);

  // Re-measure when messages change (new messages arrive)
  useEffect(() => {
    const t = setTimeout(updatePositions, 50);
    return () => clearTimeout(t);
  }, [messages.length, streamingMessage, updatePositions]);

  const scrollToMinimapRatio = useCallback((viewportTopRatio: number) => {
    const el = scrollContainer.current;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    if (scrollable <= 0) return;
    const clamped = Math.max(0, Math.min(1 - viewportRatio, viewportTopRatio));
    el.scrollTop = (clamped / (1 - viewportRatio)) * scrollable;
  }, [scrollContainer, viewportRatio]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!visible) return;
    // Don't initiate drag if clicking a node button
    if ((e.target as HTMLElement).closest("[data-minimap-node]")) return;
    draggingRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickRatio = (e.clientY - rect.top) / rect.height;
    const grabOffset = clickRatio - scrollRatio * (1 - viewportRatio);
    const insideBox = grabOffset >= 0 && grabOffset <= viewportRatio;
    const offset = insideBox ? grabOffset : viewportRatio / 2;

    scrollToMinimapRatio(clickRatio - offset);

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const r = (ev.clientY - rect.top) / rect.height;
      scrollToMinimapRatio(r - offset);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [visible, viewportRatio, scrollRatio, scrollToMinimapRatio]);

  const scrollToNode = useCallback((node: NodeInfo) => {
    const refs = messageRefs.current;
    const el = refs?.[node.index];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [messageRefs]);

  if (!visible) return null;

  const viewportBoxTop = scrollRatio * (1 - viewportRatio) * 100;
  const viewportBoxHeight = viewportRatio * 100;

  // Find the node closest to the current mouse position
  const nearestIndex = mouseYRatio !== null && nodes.length > 0
    ? nodes.reduce((best, node) => {
        const nodeMid = node.topRatio + node.heightRatio / 2;
        const bestMid = nodes[best].topRatio + nodes[best].heightRatio / 2;
        return Math.abs(nodeMid - mouseYRatio) < Math.abs(bestMid - mouseYRatio) ? node.index : best;
      }, 0)
    : null;

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setMinimapHovered(true)}
      onMouseLeave={() => { setMinimapHovered(false); setMouseYRatio(null); }}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setMouseYRatio((e.clientY - rect.top) / rect.height);
      }}
      style={{
        width: MINIMAP_WIDTH,
        flexShrink: 0,
        position: "relative",
        cursor: "ns-resize",
        userSelect: "none",
        borderLeft: "1px solid var(--border)",
        background: "var(--bg-panel)",
        overflow: "visible",
      }}
    >
      {/* Viewport indicator */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${viewportBoxTop}%`,
          height: `${viewportBoxHeight}%`,
          background: "rgba(100,100,100,0.1)",
          borderTop: "1px solid rgba(100,100,100,0.2)",
          borderBottom: "1px solid rgba(100,100,100,0.2)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {/* Message nodes */}
      {nodes.map((node) => {
        const color = getNodeColor(node.msg);
        const isNearest = minimapHovered && nearestIndex === node.index;
        const preview = getMessagePreview(node.msg);
        const isUser = node.msg.role === "user";
        const dotTop = node.topRatio * 100;

        return (
          <div
            key={node.index}
            data-minimap-node="1"
            onClick={() => scrollToNode(node)}
            style={{
              position: "absolute",
              top: `${dotTop}%`,
              left: 0,
              right: 0,
              height: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              zIndex: 2,
            }}
          >
            {/* Dot */}
            <div
              style={{
                width: isUser ? 8 : 6,
                height: isUser ? 8 : 6,
                borderRadius: isUser ? 2 : "50%",
                background: color.bg,
                border: `1.5px solid ${color.border}`,
                flexShrink: 0,
                transition: "transform 0.1s",
                transform: isNearest ? "scale(1.6)" : "scale(1)",
              }}
            />

            {/* Tooltip — shown for all nodes when minimap is hovered */}
            {minimapHovered && preview && (
              <div
                style={{
                  position: "absolute",
                  right: "100%",
                  marginRight: 6,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "var(--bg)",
                  borderTop: `1px solid ${isNearest ? color.border : "var(--border)"}`,
                  borderRight: `1px solid ${isNearest ? color.border : "var(--border)"}`,
                  borderBottom: `1px solid ${isNearest ? color.border : "var(--border)"}`,
                  borderLeft: `2px solid ${color.border}`,
                  borderRadius: 4,
                  padding: "3px 7px",
                  width: 200,
                  zIndex: 100,
                  pointerEvents: "none",
                  opacity: isNearest ? 1 : 0.45,
                  transition: "opacity 0.1s",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: isNearest ? "var(--text)" : "var(--text-muted)",
                    lineHeight: 1.4,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {preview}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Center line */}
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
        }}
      />
    </div>
  );
}

// Hook to create a stable array of refs for messages
export function useMessageRefs(count: number): RefObject<(HTMLDivElement | null)[]> {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  refs.current = Array(count).fill(null).map((_, i) => refs.current[i] ?? null);
  return refs;
}
