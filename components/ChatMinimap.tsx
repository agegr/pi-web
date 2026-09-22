"use client";

import { memo, useEffect, useRef, useState, useCallback, useMemo, type RefObject } from "react";
import ReactMarkdown, { type Options as ReactMarkdownOptions } from "react-markdown";
import rehypeKatex from "rehype-katex";
import {
  markdownPreviewRemarkPlugins,
  normalizeDisplayMath,
} from "@/lib/markdown";
import { isMessageGroupAnchor, splitFinalAssistantBlocks } from "@/lib/message-display";
import type { AgentMessage, AssistantMessage, TextContent } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import styles from "./ChatMinimap.module.css";

export interface TimelineItem {
  entryId: string;
  role: "user" | "assistant" | "compaction";
  timestamp: string;
  preview: string;
  lineIndex: number;
  /** True when this entry was compacted away (not individually loadable). */
  compacted: boolean;
  /** When compacted, the compaction entry ID that summarizes this message. */
  compactionId?: string;
  /** Assistant node: number of collapsed tool-call messages in this reply. */
  toolCount?: number;
  /** Assistant node: whether the reply carries a text answer. */
  hasText?: boolean;
}

interface Props {
  messages: AgentMessage[];
  /** entry ids parallel to `messages` (messages themselves carry no id). */
  entryIds: string[];
  streamingMessage: Partial<AgentMessage> | null;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  onRevealHistory: () => void;
  /** Full timeline of all messages in the session (from /api/sessions/[id]/timeline). */
  timeline: TimelineItem[];
  /** Called when the user clicks a timeline node that hasn't been loaded yet. */
  onLoadTimelineEntry: (entryId: string) => void;
  /** Max number of nodes to display (0 = show all). Default: 50. */
  maxNodes: number;
}

const MINIMAP_WIDTH = 36;
const MAX_NODE_GAP = 50;
const MINIMAP_PADDING = 12;
const PREVIEW_HIDE_DELAY = 250;
const NAVIGATION_ACTIVE_LOCK_MS = 1600;

/**
 * A single timeline message rendered as one minimap node.
 * Loaded nodes carry a measured `scrollTop` (DOM offset within the scroll
 * container) so clicking them scrolls the chat precisely. Unloaded nodes
 * only have the lightweight `preview` text from the timeline API; clicking
 * them triggers `onLoadTimelineEntry` so the surrounding messages are fetched.
 */
interface NodeInfo {
  topRatio: number;
  index: number;
  entryId: string;
  role: "user" | "assistant" | "compaction";
  preview: string;
  timestamp: string;
  isLoaded: boolean;
  scrollTop: number | null;
  /** When compacted, the compaction entry that summarizes this message. */
  compacted: boolean;
  compactionId?: string;
  /** Collapsed tool-call count in this assistant reply. */
  toolCount?: number;
  /** Whether this assistant reply carries a text answer. */
  hasText?: boolean;
  /** Answer markdown for loaded assistant messages (drives the outline). */
  assistantMarkdown: string;
}


function getAssistantAnswerMarkdown(message: AgentMessage | Partial<AgentMessage>): string {
  if (message.role !== "assistant") return "";
  const { answerBlocks } = splitFinalAssistantBlocks(message as AssistantMessage);
  return answerBlocks
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

function PreviewHeading({
  level,
  children,
  headingIndex,
  onClick,
}: {
  level: 1 | 2 | 3;
  children: React.ReactNode;
  headingIndex: number | null;
  onClick?: (headingIndex: number) => void;
}) {
  return (
    <button
      type="button"
      className={styles.heading}
      data-level={level}
      data-preview-heading-index={headingIndex ?? undefined}
      disabled={headingIndex === null || !onClick}
      onClick={(event) => {
        event.stopPropagation();
        if (headingIndex !== null) onClick?.(headingIndex);
      }}
    >
      {children}
    </button>
  );
}

interface PreviewAstNode {
  type?: string;
  depth?: number;
  data?: {
    hProperties?: Record<string, unknown>;
  };
}

function remarkPreviewOutline() {
  return (tree: { children?: PreviewAstNode[] }) => {
    if (!Array.isArray(tree.children)) return;
    const headings = tree.children.filter((node) => (
      node.type === "heading" && typeof node.depth === "number" && node.depth <= 3
    ));
    if (headings.length > 0) {
      headings.forEach((node, headingIndex) => {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            "data-preview-heading-index": headingIndex,
          },
        };
      });
      tree.children = headings;
      return;
    }
    const firstParagraph = tree.children.find((node) => node.type === "paragraph");
    tree.children = firstParagraph ? [firstParagraph] : [];
  };
}

const previewRemarkPlugins = [
  ...(markdownPreviewRemarkPlugins ?? []),
  remarkPreviewOutline,
];
const previewRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  [rehypeKatex, { throwOnError: false, strict: false }],
];

function getPreviewHeadingIndex(node: unknown): number | null {
  const properties = (node as { properties?: Record<string, unknown> } | undefined)?.properties;
  const value = properties?.dataPreviewHeadingIndex ?? properties?.["data-preview-heading-index"];
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

export const AssistantOutline = memo(function AssistantOutline({
  markdown,
  onHeadingClick,
  onAnswerClick,
}: {
  markdown: string;
  onHeadingClick?: (headingIndex: number) => void;
  onAnswerClick?: () => void;
}) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(markdown), [markdown]);
  if (!markdown) return null;
  return (
    <div className={styles.outline}>
      <ReactMarkdown
        remarkPlugins={previewRemarkPlugins}
        rehypePlugins={previewRehypePlugins}
        components={{
          h1: ({ children, node }) => <PreviewHeading level={1} headingIndex={getPreviewHeadingIndex(node)} onClick={onHeadingClick}>{children}</PreviewHeading>,
          h2: ({ children, node }) => <PreviewHeading level={2} headingIndex={getPreviewHeadingIndex(node)} onClick={onHeadingClick}>{children}</PreviewHeading>,
          h3: ({ children, node }) => <PreviewHeading level={3} headingIndex={getPreviewHeadingIndex(node)} onClick={onHeadingClick}>{children}</PreviewHeading>,
          h4: () => null,
          h5: () => null,
          h6: () => null,
          p: ({ children }) => (
            <button
              type="button"
              className={styles.paragraph}
              onClick={onAnswerClick}
            >
              {children}
            </button>
          ),
          blockquote: () => null,
          ul: () => null,
          ol: () => null,
          pre: () => null,
          table: () => null,
          hr: () => null,
          a: ({ children }) => <>{children}</>,
          code: ({ children }) => <>{children}</>,
        }}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
});

interface NodeLayout {
  nodes: NodeInfo[];
  gap: number;
  height: number;
  fillsHeight: boolean;
}

/** Compute topRatio from index/gap/height — never read from stored node objects. */
function nodeTopRatio(index: number, gap: number, height: number): number {
  return (MINIMAP_PADDING + index * gap) / Math.max(1, height);
}

function layoutNodes(allNodes: NodeInfo[], minimapHeight: number): NodeLayout {
  if (allNodes.length === 0) {
    return { nodes: [], gap: MAX_NODE_GAP, height: Math.max(1, minimapHeight), fillsHeight: false };
  }

  const height = Math.max(1, minimapHeight);
  const usableHeight = Math.max(0, height - MINIMAP_PADDING * 2);
  if (allNodes.length === 1) {
    return {
      nodes: [{ ...allNodes[0], topRatio: MINIMAP_PADDING / height }],
      gap: MAX_NODE_GAP,
      height,
      fillsHeight: false,
    };
  }

  const naturalGap = usableHeight / (allNodes.length - 1);
  const gap = Math.min(MAX_NODE_GAP, naturalGap);
  return {
    nodes: allNodes.map((node, index) => ({
      ...node,
      topRatio: (MINIMAP_PADDING + index * gap) / height,
    })),
    gap,
    height,
    fillsHeight: naturalGap <= MAX_NODE_GAP,
  };
}

export function ChatMinimap({
  messages,
  entryIds,
  streamingMessage,
  scrollContainer,
  messageRefs,
  onRevealHistory,
  timeline,
  onLoadTimelineEntry,
  maxNodes,
}: Props) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [allNodes, setAllNodes] = useState<NodeInfo[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [minimapHeight, setMinimapHeight] = useState(600);
  const [minimapHovered, setMinimapHovered] = useState(false);
  const [mouseYRatio, setMouseYRatio] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const allNodesRef = useRef<NodeInfo[]>([]);
  const nodeLayoutRef = useRef<NodeLayout>({
    nodes: [],
    gap: MAX_NODE_GAP,
    height: 1,
    fillsHeight: false,
  });
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const previewItemRefs = useRef(new Map<number, HTMLDivElement>());
  const previewHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeNodeLockRef = useRef<{ index: number; until: number } | null>(null);
  const pendingNavigationRef = useRef<{ nodeIndex: number } | null>(null);
  /** entryId -> DOM element for loaded messages, populated during measurement. */
  const elementByEntryIdRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const allMessages = useMemo(
    () => (streamingMessage ? [...messages, streamingMessage] : messages) as (AgentMessage | Partial<AgentMessage>)[],
    [messages, streamingMessage],
  );
  const allMessagesRef = useRef(allMessages);
  allMessagesRef.current = allMessages;
  // entry ids parallel to `messages` (the streaming message has none). Kept
  // in a ref so measureNodes (a setTimeout callback) reads current values.
  const entryIdsRef = useRef(entryIds);
  entryIdsRef.current = entryIds;

  // Build one node per timeline item. Loaded items are marked so measurement
  // and click-to-scroll can target them; unloaded items keep their preview
  // text so the hover panel never shows a bare serial number.
  const timelineNodes = useMemo(() => {
    const limit = maxNodes > 0 ? Math.min(maxNodes, timeline.length) : timeline.length;
    // Show the NEWEST items (the loaded tail overlaps these), not the oldest.
    const items = timeline.slice(-limit);
    // messages carry no entryId of their own — the ids live in the parallel
    // `entryIds` array, so a timeline item is "loaded" iff its id is in it.
    const loadedIds = new Set(entryIds);
    return items.map((item, index) => ({
      topRatio: 0,
      index,
      entryId: item.entryId,
      role: item.role,
      preview: item.preview,
      timestamp: item.timestamp,
      isLoaded: loadedIds.has(item.entryId),
      scrollTop: null as number | null,
      compacted: item.compacted,
      compactionId: item.compactionId,
      toolCount: item.toolCount,
      hasText: item.hasText,
      assistantMarkdown: "",
    }));
  }, [timeline, maxNodes, entryIds]);

  // Layout the MEASURED nodes (allNodes, populated by measureNodes) so that
  // findNearestNode -> scrollToNode reads a real scrollTop. The previous
  // version laid out the unmeasured `timelineNodes` (scrollTop always null)
  // AND overwrote allNodesRef with it on every render, so clicks could never
  // scroll. measureNodes preserves isLoaded/role/preview via spread, so the
  // dot rail still styles correctly off the measured array.
  const nodeLayout = useMemo(
    () => layoutNodes(allNodes, minimapHeight),
    [allNodes, minimapHeight],
  );
  const { nodes: positionedNodes, gap: nodeGap, height: layoutHeight } = nodeLayout;
  nodeLayoutRef.current = nodeLayout;

  const lockActiveNode = useCallback((index: number) => {
    activeNodeLockRef.current = {
      index,
      until: Date.now() + NAVIGATION_ACTIVE_LOCK_MS,
    };
    setActiveIndex(index);
  }, []);

  const syncActiveNode = useCallback((scrollEl: HTMLDivElement, nextNodes: NodeInfo[]) => {
    const activeLock = activeNodeLockRef.current;
    if (activeLock && Date.now() < activeLock.until) {
      setActiveIndex(activeLock.index);
      return;
    }
    activeNodeLockRef.current = null;

    const measuredNodes = nextNodes.filter((node) => node.scrollTop !== null);
    if (measuredNodes.length === 0) {
      setActiveIndex(null);
      return;
    }
    const focusTop = scrollEl.scrollTop + scrollEl.clientHeight * 0.3;
    const nextActiveNode = measuredNodes.reduce((bestNode, node) => (
      Math.abs((node.scrollTop ?? 0) - focusTop)
        < Math.abs((bestNode.scrollTop ?? 0) - focusTop)
        ? node
        : bestNode
    ), measuredNodes[0]);
    setActiveIndex(nextActiveNode.index);
  }, []);

  const updateScroll = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const currentNodes = allNodesRef.current;
    setVisible(scrollEl.scrollHeight - scrollEl.clientHeight > 20 || currentNodes.length > 0);
    syncActiveNode(scrollEl, currentNodes);
  }, [scrollContainer, syncActiveNode]);

  // Measure DOM offsets for loaded nodes. We walk the loaded messages with
  // the SAME ref-indexing rule ChatWindow uses (anchor || assistant) so that
  // messageRefs.current[refIndex] lines up with the right message element —
  // the previous version indexed messageRefs by the allMessages index, which
  // never matched, so scrollTop stayed null and clicks could not scroll.
  const measureThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureNodes = useCallback(() => {
    if (measureThrottleRef.current) return;
    measureThrottleRef.current = setTimeout(() => {
      measureThrottleRef.current = null;
      const scrollEl = scrollContainer.current;
      const minimapEl = containerRef.current;
      if (!scrollEl || !minimapEl) return;

      const refs = messageRefs.current;
      const containerRect = scrollEl.getBoundingClientRect();
      const elementByEntryId = elementByEntryIdRef.current;
      elementByEntryId.clear();

      // Walk the loaded messages with the SAME ref-indexing rule ChatWindow
      // uses (anchor || assistant) so messageRefs.current[refIndex] lines up
      // with the right message element. entry ids come from the parallel
      // `entryIds` array (messages themselves carry no id), so we track the
      // message index to look each one up.
      const ids = entryIdsRef.current;
      const msgs = allMessagesRef.current;
      let refIndex = 0;
      for (let msgIndex = 0; msgIndex < msgs.length; msgIndex++) {
        const message = msgs[msgIndex];
        const isAnchor = isMessageGroupAnchor(message);
        if (!isAnchor && message.role !== "assistant") continue;
        const element = refs?.[refIndex] ?? null;
        const entryId = msgIndex < ids.length ? ids[msgIndex] : undefined;
        if (element && typeof entryId === "string") {
          elementByEntryId.set(entryId, element);
        }
        refIndex++;
      }

      // Apply measurements to the timeline nodes (loaded ones only).
      const updated = timelineNodes.map((node) => {
        const element = elementByEntryId.get(node.entryId);
        if (!element) return node;
        const elementRect = element.getBoundingClientRect();
        const scrollTop = elementRect
          ? elementRect.top - containerRect.top + scrollEl.scrollTop
          : null;
        let assistantMarkdown = node.assistantMarkdown;
        if (node.role === "assistant" && !assistantMarkdown) {
          // Find the loaded message for this entry via the parallel ids array.
          const msgIdx = ids.indexOf(node.entryId);
          if (msgIdx >= 0) {
            assistantMarkdown = getAssistantAnswerMarkdown(msgs[msgIdx]);
          }
        }
        return { ...node, scrollTop, assistantMarkdown };
      });

      setMinimapHeight(minimapEl.clientHeight);
      allNodesRef.current = updated;
      setAllNodes(updated);
      setVisible(scrollEl.scrollHeight - scrollEl.clientHeight > 20 || updated.length > 0);
      syncActiveNode(scrollEl, updated);

      // Resolve a pending navigation (e.g. user clicked an unloaded node that
      // has since been fetched). As soon as the node reports loaded, scroll to
      // it — exactly if we measured its DOM offset, proportionally otherwise.
      const pending = pendingNavigationRef.current;
      if (pending) {
        const node = updated[pending.nodeIndex];
        if (node && node.isLoaded) {
          pendingNavigationRef.current = null;
          lockActiveNode(node.index);
          const scrollable = scrollEl.scrollHeight - scrollEl.clientHeight;
          const { gap: navGap, height: navH } = nodeLayoutRef.current;
          // Prefer an exact DOM offset; fall back to a direct element lookup
          // (measurement may still be throttled); last resort is the
          // proportional estimate through the layout.
          let targetTop: number;
          if (node.scrollTop !== null) {
            targetTop = Math.max(0, node.scrollTop - scrollEl.clientHeight * 0.3);
          } else {
            const element = elementByEntryIdRef.current.get(node.entryId);
            if (element) {
              const containerRect = scrollEl.getBoundingClientRect();
              const elementRect = element.getBoundingClientRect();
              targetTop = Math.max(
                0,
                elementRect.top - containerRect.top + scrollEl.scrollTop - scrollEl.clientHeight * 0.3,
              );
            } else {
              targetTop = Math.max(0, nodeTopRatio(node.index, navGap, navH) * scrollable);
            }
          }
          scrollEl.scrollTo({ top: targetTop, behavior: "smooth" });
        }
      }
    }, 150);
  }, [timelineNodes, lockActiveNode, messageRefs, scrollContainer, syncActiveNode]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    el.addEventListener("scroll", updateScroll, { passive: true });
    return () => el.removeEventListener("scroll", updateScroll);
  }, [scrollContainer, updateScroll]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    const syncLayout = () => {
      measureNodes();
      updateScroll();
    };
    const ro = new ResizeObserver(syncLayout);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    syncLayout();
    return () => {
      ro.disconnect();
      if (measureThrottleRef.current) {
        clearTimeout(measureThrottleRef.current);
        measureThrottleRef.current = null;
      }
    };
  }, [measureNodes, scrollContainer, updateScroll]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      measureNodes();
      updateScroll();
    }, 50);
    return () => clearTimeout(timeout);
  }, [messages.length, timeline.length, measureNodes, updateScroll]);

  // Click a node: scroll the chat to that message. Unloaded nodes trigger a
  // fetch via onLoadTimelineEntry; once loaded, measureNodes will resolve the
  // pending navigation and perform the smooth scroll.
  // Compacted nodes scroll to their compaction summary instead.
  const scrollToNode = useCallback((node: NodeInfo, behavior: ScrollBehavior) => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    lockActiveNode(node.index);

    // Compacted entries can't be loaded individually — scroll to the summary's
    // DOM element directly (compaction summaries are group anchors, so they
    // always carry a ref when loaded).
    if (node.compacted && node.compactionId) {
      const compElement = elementByEntryIdRef.current.get(node.compactionId);
      if (compElement) {
        const containerRect = scrollEl.getBoundingClientRect();
        const elementRect = compElement.getBoundingClientRect();
        const targetTop = Math.max(
          0,
          elementRect.top - containerRect.top + scrollEl.scrollTop - scrollEl.clientHeight * 0.3,
        );
        scrollEl.scrollTo({ top: targetTop, behavior });
        return;
      }
      // Compaction summary not loaded yet — scroll to the top where older
      // summaries live; do NOT try to page back into compacted history.
      scrollEl.scrollTo({ top: 0, behavior });
      return;
    }

    if (!node.isLoaded) {
      pendingNavigationRef.current = { nodeIndex: node.index };
      onLoadTimelineEntry(node.entryId);
      return;
    }
    const scrollable = scrollEl.scrollHeight - scrollEl.clientHeight;
    if (node.scrollTop === null) {
      // Loaded but not yet measured — look up the element directly so a
      // 150 ms measurement throttle doesn't degrade positioning.
      const element = elementByEntryIdRef.current.get(node.entryId);
      if (element) {
        const containerRect = scrollEl.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const targetTop = Math.max(
          0,
          elementRect.top - containerRect.top + scrollEl.scrollTop - scrollEl.clientHeight * 0.3,
        );
        scrollEl.scrollTo({ top: targetTop, behavior });
        return;
      }
      // Truly unknown position — proportional estimate through the layout.
      const { gap, height } = nodeLayoutRef.current;
      const fallbackTop = Math.max(0, nodeTopRatio(node.index, gap, height) * scrollable);
      scrollEl.scrollTo({ top: fallbackTop, behavior });
      return;
    }
    const targetTop = Math.max(0, node.scrollTop - scrollEl.clientHeight * 0.3);
    scrollEl.scrollTo({ top: targetTop, behavior });
  }, [lockActiveNode, scrollContainer, onLoadTimelineEntry]);

  const scrollToHeading = useCallback((node: NodeInfo, headingIndex: number) => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const answerElement = elementByEntryIdRef.current.get(node.entryId);
    if (!answerElement) {
      if (!node.isLoaded) {
        pendingNavigationRef.current = { nodeIndex: node.index };
        onLoadTimelineEntry(node.entryId);
        return;
      }
      pendingNavigationRef.current = { nodeIndex: node.index };
      onRevealHistory();
      return;
    }
    const heading = answerElement.querySelectorAll<HTMLElement>("h1, h2, h3").item(headingIndex);
    if (!heading) return;
    const containerRect = scrollEl.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const targetTop = (
      headingRect.top
      - containerRect.top
      + scrollEl.scrollTop
      - scrollEl.clientHeight * 0.3
    );
    lockActiveNode(node.index);
    scrollEl.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  }, [lockActiveNode, onRevealHistory, scrollContainer, onLoadTimelineEntry]);

  const findNearestNode = useCallback((ratio: number): NodeInfo | null => {
    const { nodes, gap, height: layoutH } = nodeLayoutRef.current;
    if (nodes.length === 0 || layoutH <= 0) return null;

    const containerH = containerRef.current?.clientHeight ?? layoutH;
    // Ratio relative to the container, but node positions are relative to layoutH.
    // Map pointer ratio through the layout height for consistent indexing.
    const pointerY = Math.max(0, Math.min(layoutH, ratio * containerH));
    const firstNodeY = MINIMAP_PADDING;
    const rawIndex = gap > 0 ? Math.round((pointerY - firstNodeY) / gap) : 0;
    const nodeIndex = Math.max(0, Math.min(nodes.length - 1, rawIndex));
    return nodes[nodeIndex];
  }, []);

  const cancelPreviewHide = useCallback(() => {
    if (previewHideTimerRef.current) {
      clearTimeout(previewHideTimerRef.current);
      previewHideTimerRef.current = null;
    }
  }, []);

  const showPreview = useCallback(() => {
    cancelPreviewHide();
    setMinimapHovered(true);
  }, [cancelPreviewHide]);

  const schedulePreviewHide = useCallback(() => {
    cancelPreviewHide();
    previewHideTimerRef.current = setTimeout(() => {
      previewHideTimerRef.current = null;
      setMinimapHovered(false);
      setMouseYRatio(null);
    }, PREVIEW_HIDE_DELAY);
  }, [cancelPreviewHide]);

  useEffect(() => () => cancelPreviewHide(), [cancelPreviewHide]);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!visible) return;

    draggingRef.current = true;
    showPreview();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerRatio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setMouseYRatio(pointerRatio);
    const jumpToPointer = (clientY: number, behavior: ScrollBehavior) => {
      const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const node = findNearestNode(ratio);
      if (node) {
        scrollToNode(node, behavior);
      }
    };

    jumpToPointer(event.clientY, "smooth");
    const onMove = (moveEvent: MouseEvent) => {
      if (!draggingRef.current) return;
      jumpToPointer(moveEvent.clientY, "auto");
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [findNearestNode, scrollToNode, showPreview, visible]);

  const nearestNode = mouseYRatio === null ? null : findNearestNode(mouseYRatio);
  const nearestNodeIndex = nearestNode?.index ?? null;

  useEffect(() => {
    if (!minimapHovered || nearestNodeIndex === null) return;
    const previewBox = previewBoxRef.current;
    const previewItem = previewItemRefs.current.get(nearestNodeIndex);
    if (!previewBox || !previewItem) return;
    const targetTop = previewItem.offsetTop
      - (previewBox.clientHeight - previewItem.offsetHeight) / 2;
    previewBox.scrollTop = Math.max(0, targetTop);
  }, [allNodes, minimapHovered, nearestNodeIndex]);

  if (!visible) return null;

  const lastNodeTop = positionedNodes.length > 0
    ? positionedNodes[positionedNodes.length - 1].topRatio * minimapHeight
    : MINIMAP_PADDING;
  const railHeight = Math.max(1, lastNodeTop - MINIMAP_PADDING);

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseEnter={showPreview}
      onMouseLeave={schedulePreviewHide}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setMouseYRatio((event.clientY - rect.top) / rect.height);
      }}
      style={{
        width: MINIMAP_WIDTH,
        flexShrink: 0,
        position: "relative",
        cursor: "pointer",
        userSelect: "none",
        borderLeft: "1px solid var(--border)",
        background: "var(--bg-panel)",
        overflow: "visible",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: MINIMAP_PADDING,
          height: railHeight,
          width: 1,
          background: "var(--border)",
          transform: "translateX(-50%)",
          zIndex: 0,
        }}
      />

      {positionedNodes.map((node) => {
        const isNearest = minimapHovered && nearestNode?.index === node.index;
        const isActive = activeIndex === node.index;
        const isLoaded = node.isLoaded;
        const isUser = node.role === "user";

        return (
          <div
            key={node.index}
            data-minimap-node-index={node.index}
            data-minimap-node-active={isActive ? "" : undefined}
            data-minimap-node-loaded={isLoaded ? "" : undefined}
            style={{
              position: "absolute",
              top: `${nodeTopRatio(node.index, nodeGap, layoutHeight) * 100}%`,
              transform: "translateY(-50%)",
              left: 0,
              right: 0,
              height: Math.max(1, nodeGap),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: node.role === "compaction" ? 24 : isUser ? 8 : 6,
                height: node.role === "compaction" ? 2 : isUser ? 8 : 6,
                borderRadius: node.role === "compaction" ? 1 : isUser ? 2 : 4,
                background: node.role === "compaction"
                  ? "rgba(128,128,128,0.35)"
                  : isActive
                    ? "rgba(128,128,128,0.42)"
                    : isLoaded
                      ? "rgba(128,128,128,0.16)"
                      : "transparent",
                border: node.role === "compaction"
                  ? "none"
                  : node.compacted
                    ? `1px dashed rgba(128,128,128,0.25)`
                    : !isUser && !node.hasText
                      ? `1.5px dotted rgba(128,128,128,0.45)`
                      : `1.5px solid ${
                      isActive
                        ? "rgba(128,128,128,0.95)"
                        : isLoaded
                          ? "rgba(128,128,128,0.58)"
                          : "rgba(128,128,128,0.3)"
                    }`,
                boxShadow: isActive ? "0 0 0 2px var(--bg-panel)" : "none",
                transition: "transform 0.1s, background 0.1s",
                transform: isNearest ? "scale(1.25)" : "scale(1)",
                opacity: node.compacted ? 0.4 : isLoaded ? 1 : 0.5,
              }}
            />
          </div>
        );
      })}

      {minimapHovered && allNodes.length > 0 && (
        <div
          ref={previewBoxRef}
          className={styles.preview}
          data-minimap-preview-box=""
          onMouseEnter={showPreview}
          onMouseDown={(event) => event.stopPropagation()}
          onMouseMove={(event) => event.stopPropagation()}
        >
          {allNodes.map((node) => {
            const isLocated = nearestNodeIndex === node.index;
            const isLoaded = node.isLoaded;
            const previewText = node.preview.trim() || "…";
            return (
              <div
                key={node.index}
                ref={(element) => {
                  if (element) previewItemRefs.current.set(node.index, element);
                  else previewItemRefs.current.delete(node.index);
                }}
                className={styles.turn}
                data-minimap-preview-index={node.index}
                data-located={isLocated ? "true" : undefined}
                data-minimap-preview-loaded={isLoaded ? "" : undefined}
              >
                <span className={styles.number} aria-hidden="true">
                  {String(node.index + 1).padStart(2, "0")}
                </span>
                <div className={styles.content}>
                  <button
                    type="button"
                    className={styles.user}
                    data-minimap-preview-user={node.index}
                    onClick={() => {
                      scrollToNode(node, "smooth");
                    }}
                  >
                    <span className={styles.userText}>{previewText}</span>
                    {node.role === "assistant" && node.toolCount ? (
                      <span
                        className={styles.toolBadge}
                        data-minimap-tool-count={node.toolCount}
                      >
                        {t("chatMinimap.toolCount", { count: node.toolCount })}
                      </span>
                    ) : null}
                  </button>

                  {node.role === "assistant" && node.assistantMarkdown && (
                    <div className={styles.assistant}>
                      <button
                        type="button"
                        className={styles.assistantJump}
                        data-minimap-preview-assistant={node.index}
                        onClick={() => scrollToNode(node, "smooth")}
                        aria-label={t("chatMinimap.locateAssistant")}
                        title={t("chatMinimap.locateAssistant")}
                      >
                        A
                      </button>
                      <AssistantOutline
                        markdown={node.assistantMarkdown}
                        onAnswerClick={() => scrollToNode(node, "smooth")}
                        onHeadingClick={(headingIndex) => (
                          scrollToHeading(node, headingIndex)
                        )}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
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
