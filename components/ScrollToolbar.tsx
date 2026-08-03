import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentMessage } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";

const SCROLL_ANCHOR_THRESHOLD = 80;
const CHAT_MINIMAP_WIDTH = 4;

export interface ScrollToolbarProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  messageRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  /** user/assistant-filtered messages, index-aligned with messageRefs */
  visibleMessages: AgentMessage[];
  /** total messages (lazy pagination check) */
  messagesLength: number;
  agentRunning: boolean;
  isMobile: boolean;
  setVisibleCount: (updater: (current: number) => number) => void;
  /**
   * Long-press on the 'latest' button toggles follow-streaming. True → the
   * list scrolls with the latest message even while the agent runs; clicking
   * any scroll-navigation button clears it.
   */
  followStreamingRef: React.RefObject<boolean | null>;
}

export function ScrollToolbar({
  scrollContainerRef,
  messagesEndRef,
  messageRefs,
  visibleMessages,
  messagesLength,
  agentRunning,
  isMobile,
  setVisibleCount,
  followStreamingRef,
}: ScrollToolbarProps) {
  const { t } = useI18n();

  // Draggable toolbar position. Default: bottom-right (aligned to the message
  // column). Stored in localStorage so the user's hand preference survives
  // reloads. Coordinates are viewport-relative (left/top of the button
  // column).
  const DEFAULT_POS = { align: "right" as "left" | "right", y: 12 };
  const [pos, setPos] = useState<{ align: "left" | "right"; y: number }>(() => {
    try {
      const raw = localStorage.getItem("pi-scroll-toolbar-pos");
      if (raw) {
        const parsed = JSON.parse(raw) as { align?: "left" | "right"; y: number };
        if (typeof parsed.y === "number" && (parsed.align === "left" || parsed.align === "right")) return { align: parsed.align, y: parsed.y };
      }
    } catch { /* ignore */ }
    return DEFAULT_POS;
  });
  const dragRef = useRef<{ startX: number; startY: number; startY0: number; moved: boolean; pointerId: number; startTime: number } | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const dragModeRef = useRef(false);
  // Set when a tap (touch pointerup without drag) already navigated, so the
  // trailing click doesn't navigate twice.
  const tapNavigatedRef = useRef(false);
  // Mirror of pos so the pointer-up handler can persist the LATEST dragged
  // position (the pos state captured in its closure would be stale).
  const posRef = useRef(pos);
  const setPosAndRef = useCallback((p: { align: "left" | "right"; y: number }) => {
    posRef.current = p;
    setPos(p);
  }, []);

  // Track whether the message list is at the top / bottom so the buttons only
  // appear when there is something to scroll to. Buttons show while scrolling
  // and hide shortly after it stops; hovering keeps them visible.
  const [scrollAnchors, setScrollAnchors] = useState<{ atTop: boolean; atBottom: boolean }>({ atTop: true, atBottom: true });
  const [scrollActive, setScrollActive] = useState(false);
  const [scrollBtnsHovered, setScrollBtnsHovered] = useState(false);
  const [scrollTooltip, setScrollTooltip] = useState<"earliest" | "prevUser" | "nextUser" | "latest" | null>(null);
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Brief "auto-scroll follow on" toast after a successful long-press.
  const [followToast, setFollowToast] = useState(false);
  const followToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [followStreaming, setFollowStreaming] = useState(false);
  const updateFollowStreaming = useCallback((v: boolean) => {
    if (followStreamingRef) followStreamingRef.current = v;
    setFollowStreaming(v);
  }, [followStreamingRef]);

  // Long-press on the 'latest' button toggles follow-streaming.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef(false);
  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  }, []);

  // --- Drag-to-reposition the whole toolbar (long-press + move) ---
  // Horizontal position snaps to LEFT or RIGHT edge only (the user chooses
  // which side by dragging across the screen midpoint). Vertical position is
  // free. Both are persisted; on reload the horizontal edge is recomputed
  // against the current viewport and the saved vertical offset is applied.
  // Drag via window-level native listeners: once the pointer goes down on the
  // toolbar, ALL subsequent pointermove/up are tracked globally so the drag
  // never stops when the finger leaves the small button column (real touch
  // pointer events do not bubble after leaving the element).
  const dragMoveHandlerRef = useRef<((e: PointerEvent) => void) | null>(null);
  const dragUpHandlerRef = useRef<(() => void) | null>(null);

  const onToolbarPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startY0: pos.y,
      moved: false,
      pointerId: e.pointerId,
      startTime: Date.now(),
    };
    dragModeRef.current = true;

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || ev.pointerId !== drag.pointerId) return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 8) return;
      drag.moved = true;
      // Stop the browser from hijacking the gesture as scroll/touch panning.
      try { ev.preventDefault(); } catch { /* ignore */ }
      clearLongPress();
      const el = toolbarRef.current;
      if (!el) return;
      const maxY = Math.max(8, window.innerHeight - el.offsetHeight - 8);
      const ny = Math.min(Math.max(8, drag.startY0 + dy), maxY);
      const nx = ev.clientX < window.innerWidth / 2 ? "left" : "right";
      setPosAndRef({ align: nx, y: ny });
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      const wasDrag = drag.moved;
      dragRef.current = null;
      dragModeRef.current = false;
      if (wasDrag) {
        try {
          localStorage.setItem("pi-scroll-toolbar-pos", JSON.stringify({ align: posRef.current.align, y: posRef.current.y }));
        } catch { /* ignore */ }
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      dragMoveHandlerRef.current = null;
      dragUpHandlerRef.current = null;
    };
    dragMoveHandlerRef.current = onMove;
    dragUpHandlerRef.current = onUp;
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [pos.y, clearLongPress, setPosAndRef]);

  const handleScrollAnchorChange = useCallback(() => {
    const c = scrollContainerRef.current;
    if (!c) return;
    const atTop = c.scrollTop <= SCROLL_ANCHOR_THRESHOLD;
    const atBottom = c.scrollHeight - c.scrollTop - c.clientHeight <= SCROLL_ANCHOR_THRESHOLD;
    setScrollAnchors((prev) => (prev.atTop === atTop && prev.atBottom === atBottom ? prev : { atTop, atBottom }));
    setScrollActive(true);
    if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
    scrollIdleTimerRef.current = setTimeout(() => setScrollActive(false), 2000);
  }, [scrollContainerRef]);

  // Bind the scroll-position tracking to the container so ChatWindow does
  // not need an onScroll handler for it.
  useEffect(() => {
    const c = scrollContainerRef.current;
    if (!c) return;
    c.addEventListener("scroll", handleScrollAnchorChange, { passive: true });
    return () => c.removeEventListener("scroll", handleScrollAnchorChange);
  }, [handleScrollAnchorChange, scrollContainerRef]);

  useEffect(() => () => {
    if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
  }, []);

  // Touch devices have no real hover: a tap fires mouseenter but the matching
  // mouseleave never arrives, so scrollBtnsHovered would stay true forever and
  // the buttons would never auto-hide. On mobile ignore hover entirely.
  const showScrollButtons = (!scrollAnchors.atTop || !scrollAnchors.atBottom) && (scrollActive || (!isMobile && scrollBtnsHovered));

  const scrollToEarliest = useCallback(() => {
    updateFollowStreaming(false);
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [scrollContainerRef, updateFollowStreaming]);

  const scrollToLatest = useCallback(() => {
    updateFollowStreaming(false);
    const c = scrollContainerRef.current;
    if (!c) return;
    // Scroll so the LAST MESSAGE's bottom sits at the viewport bottom.
    //
    // Layout (top → bottom):
    //   [...messages]
    //   [agent-running spacer, height = clientHeight]  ← only when agentRunning
    //   <div ref={messagesEndRef}/>
    //
    // messagesEndRef.offsetTop already includes the spacer, but offsetTop is
    // relative to the nearest positioned ancestor (not necessarily the scroll
    // container). Compute the end sentinel's position inside the container
    // via getBoundingClientRect, then back off by the spacer height AND the
    // viewport height so the last message lands at the bottom and the spacer
    // stays below the fold (no blank screen). Keep ~100px of breathing room
    // below the last message (sentinel is 28px tall → extra 100-28).
    const end = messagesEndRef.current;
    if (end) {
      const endInContainer =
        end.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop;
      const spacerH = agentRunning ? 96 : 0;
      // ≈40px visual keep-out below the last message (sentinel 28px + the
      // last message's own ~16px bottom margin → extra 40-28-16 = -4).
      const target = Math.max(0, endInContainer - spacerH - c.clientHeight - 4);
      c.scrollTo({ top: target, behavior: "smooth" });
      return;
    }
    c.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
  }, [agentRunning, messagesEndRef, scrollContainerRef, updateFollowStreaming]);

  /**
   * Scroll to the previous/next user message relative to the current viewport.
   * Buttons sit between "earliest" and "latest" and jump from question to
   * question, skipping assistant/tool content.
   */
  // Latest reference so the lazy-load retry can re-invoke navigation.
  const scrollToUserMessageRef = useRef<((dir: -1 | 1) => void) | null>(null);
  const scrollToUserMessage = useCallback((dir: -1 | 1) => {
    updateFollowStreaming(false);
    const c = scrollContainerRef.current;
    if (!c) return;
    const refs = messageRefs.current;
    if (!refs || refs.length === 0) return;
    // How many messages are actually RENDERED (refs filled). Lazy pagination
    // renders only a window of the list; navigation needs all user messages
    // to be present, so load more when the rendered count is short of the
    // full list.
    const renderedCount = refs.filter(Boolean).length;
    let anchor = -1;
    if (dir === -1) {
      // prev: anchor = the last user message at/above the VIEWPORT TOP (the
      // question we're currently reading). If it sits above the viewport,
      // jump TO it; if it's at the top already, go one earlier.
      const limit = c.scrollTop + 8;
      for (let i = 0; i < refs.length; i++) {
        const el = refs[i];
        if (!el || visibleMessages[i]?.role !== "user") continue;
        const elTop = el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop;
        if (elTop <= limit + 4) { anchor = i; continue; }
        if (anchor === -1) anchor = i;
        break;
      }
      if (anchor === -1) anchor = refs.length - 1;
      const anchorEl = refs[anchor];
      const anchorTop = anchorEl
        ? anchorEl.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop
        : -1;
      const anchorVisible = anchorTop >= c.scrollTop;
      // Search before the anchor (start = anchor - 1) if the anchor is on
      // screen; otherwise jump to the anchor itself.
      const start = anchorVisible ? anchor - 1 : anchor;
      for (let i = start; i >= 0; i--) {
        if (visibleMessages[i]?.role !== "user") continue;
        const el = refs[i];
        if (!el) continue;
        const elTop = el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop;
        c.scrollTo({ top: Math.max(0, elTop - 24), behavior: "smooth" });
        // Reveal the target message's action menu (copy/edit/new-session) —
        // the same state a real mouse-over produces. The synthetic mouseover
        // must bubble THROUGH the message container that owns onMouseEnter;
        // messageRefs points at the wrapper div around the message, so target
        // its first child (the actual message container).
        (el.firstElementChild ?? el).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        return;
      }
    } else {
      // next: anchor = the FIRST message at/at-below the VIEWPORT TOP (any
      // role). "Next user" = the user message after that first visible one,
      // so we never re-select the question sitting at the top of the screen.
      for (let i = 0; i < refs.length; i++) {
        const el = refs[i];
        if (!el) continue;
        const elTop = el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop;
        if (elTop >= c.scrollTop) { anchor = i; break; }
      }
      if (anchor === -1) anchor = refs.length - 1;
      for (let i = anchor + 1; i < visibleMessages.length; i++) {
        if (visibleMessages[i]?.role !== "user") continue;
        const el = refs[i];
        if (!el) continue;
        const elTop = el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop;
        c.scrollTo({ top: Math.max(0, elTop - 24), behavior: "smooth" });
        // Reveal the target message's action menu (see prev branch).
        (el.firstElementChild ?? el).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        return;
      }
    }
    // No user message found within the loaded window — there may be older/
    // newer messages hidden by lazy pagination. Load more and retry so the
    // button eventually works even on a long history.
    if (setVisibleCount && renderedCount < messagesLength) {
      setVisibleCount((current) => Math.max(current, messagesLength * 2));
      setTimeout(() => scrollToUserMessageRef.current?.(dir), 250);
    }
  }, [messageRefs, visibleMessages, messagesLength, scrollContainerRef, setVisibleCount, updateFollowStreaming]);
  scrollToUserMessageRef.current = scrollToUserMessage;

  return (
    <>
      {showScrollButtons && (
        <div
          ref={toolbarRef}
          onPointerDown={onToolbarPointerDown}
          style={{
          position: "absolute",
          // Horizontal snaps to the left or right edge (dragged choice);
          // vertical uses the saved offset. Right edge aligns to the message
          // column on large screens.
          left: pos.align === "left" ? 12 : undefined,
          right: pos.align === "right" ? (isMobile
            ? 12
            : `max(${CHAT_MINIMAP_WIDTH + 12}px, calc((100% - 820px) / 2 - 12px))`)
            : undefined,
          top: pos.y,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          zIndex: 30,
          pointerEvents: "auto",
          cursor: dragModeRef.current ? "grabbing" : "grab",
          touchAction: "none",
        }}
          onMouseEnter={() => setScrollBtnsHovered(true)}
          onMouseLeave={() => setScrollBtnsHovered(false)}
        >
          {(
            <button
              onClick={scrollToEarliest}
              aria-label="scrollToEarliest"
              onMouseEnter={(e) => {
                setScrollTooltip("earliest");
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                setScrollTooltip(null);
                e.currentTarget.style.background = "color-mix(in srgb, var(--bg-panel) 92%, transparent)";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
              style={{
                pointerEvents: "auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 44,
                height: 44,
                borderRadius: "50%",
                border: "1px solid var(--border)",
                background: "color-mix(in srgb, var(--bg-panel) 92%, transparent)",
                color: "var(--text-muted)",
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(15,23,42,0.18)",
                transition: "color 0.12s, background 0.12s",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
          )}
          {(
            <button
              onClick={() => {
                if (tapNavigatedRef.current) { tapNavigatedRef.current = false; return; }
                scrollToUserMessage(-1);
              }}
              onPointerUp={(e) => {
                // Touch fallback: some touch environments swallow the click
                // after our container's pointer handlers. If this was a tap
                // (no drag movement) and click hasn't fired yet, navigate
                // directly. alert proves the handler runs on your phone.
                const drag = dragRef.current;
                if (drag && !drag.moved) {
                  tapNavigatedRef.current = true;
                  
                  scrollToUserMessage(-1);
                }
              }}
              aria-label="scrollToPrevUser"
              onMouseEnter={(e) => {
                setScrollTooltip("prevUser");
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                setScrollTooltip(null);
                e.currentTarget.style.background = "color-mix(in srgb, var(--bg-panel) 92%, transparent)";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
              style={{
                pointerEvents: "auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 44,
                height: 44,
                borderRadius: "50%",
                border: "1px solid var(--border)",
                background: "color-mix(in srgb, var(--bg-panel) 92%, transparent)",
                color: "var(--text-muted)",
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(15,23,42,0.18)",
                transition: "color 0.12s, background 0.12s",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="1.6" />
                <path d="M12 8v6" />
                <path d="M8 13h8" />
              </svg>
            </button>
          )}
          {(
            <button
              onClick={() => {
                if (tapNavigatedRef.current) { tapNavigatedRef.current = false; return; }
                scrollToUserMessage(1);
              }}
              onPointerUp={(e) => {
                const drag = dragRef.current;
                if (drag && !drag.moved) {
                  tapNavigatedRef.current = true;
                  
                  scrollToUserMessage(1);
                }
              }}
              aria-label="scrollToNextUser"
              onMouseEnter={(e) => {
                setScrollTooltip("nextUser");
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                setScrollTooltip(null);
                e.currentTarget.style.background = "color-mix(in srgb, var(--bg-panel) 92%, transparent)";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
              style={{
                pointerEvents: "auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 44,
                height: 44,
                borderRadius: "50%",
                border: "1px solid var(--border)",
                background: "color-mix(in srgb, var(--bg-panel) 92%, transparent)",
                color: "var(--text-muted)",
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(15,23,42,0.18)",
                transition: "color 0.12s, background 0.12s",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="19" r="1.6" />
                <path d="M12 16v-6" />
                <path d="M8 11h8" />
              </svg>
            </button>
          )}
          {(
            // 60px hit-area wrapper for the long-press gesture (visual button
            // stays 44px inside).
            <div
              style={{
                pointerEvents: "auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 60,
                height: 60,
                margin: -8,
                userSelect: "none",
                WebkitUserSelect: "none",
              }}
              onPointerDown={(e) => {
                // Long-press (>600ms) toggles follow-streaming; a quick
                // press/click still jumps to the latest message. Bound on
                // the hit-area wrapper so the gesture is easy to land on and
                // small screens don't trigger text selection. NOTE: do NOT
                // preventDefault here — on mobile that suppresses the
                // subsequent click, so follow could never be unlocked again.
                // stopPropagation: a long-press must not also start a toolbar
                // drag when the finger wiggles a few px.
                e.stopPropagation();
                clearLongPress();
                longPressTimerRef.current = setTimeout(() => {
                  didLongPressRef.current = true;
                  // Toggle: long-press again turns follow OFF.
                  const nowOn = !(followStreamingRef.current ?? false);
                  updateFollowStreaming(nowOn);
                  document.getSelection()?.removeAllRanges();
                  const prev = document.body.style.userSelect;
                  document.body.style.userSelect = "none";
                  // The "following on" toast is only useful the first few
                  // times; after that it's noise (it fires on every
                  // long-press). Show it at most 3 times, tracked in
                  // localStorage.
                  if (nowOn) {
                    let shown = 0;
                    try { shown = parseInt(localStorage.getItem("pi-follow-toast-shown") ?? "0", 10) || 0; } catch { /* ignore */ }
                    if (shown < 3) {
                      try { localStorage.setItem("pi-follow-toast-shown", String(shown + 1)); } catch { /* ignore */ }
                      setFollowToast(true);
                    }
                  }
                  if (followToastTimerRef.current) clearTimeout(followToastTimerRef.current);
                  followToastTimerRef.current = setTimeout(() => {
                    setFollowToast(false);
                    document.body.style.userSelect = prev;
                  }, 2000);
                }, 600);
              }}
              onPointerUp={clearLongPress}
              onPointerCancel={clearLongPress}
              onPointerLeave={clearLongPress}
              onContextMenu={(e) => e.preventDefault()}
            >
              <button
                onClick={() => {
                  // A long-press just enabled follow — the click that follows
                  // the gesture must not unlock it (nor jump). Check this
                  // FIRST: otherwise the click would immediately disable the
                  // follow the long-press just turned on.
                  if (didLongPressRef.current) { didLongPressRef.current = false; return; }
                  // Locked (long-press enabled follow): a normal click now
                  // UNLOCKS follow (does not jump — you're already at latest).
                  if (followStreaming) {
                    updateFollowStreaming(false);
                    return;
                  }
                  scrollToLatest();
                }}
                aria-label="scrollToLatest"
                onMouseEnter={(e) => {
                  setScrollTooltip("latest");
                  e.currentTarget.style.background = followStreaming
                    ? "color-mix(in srgb, var(--accent) 26%, var(--bg-panel))"
                    : "var(--bg-hover)";
                  e.currentTarget.style.color = followStreaming ? "var(--accent)" : "var(--text)";
                }}
                onMouseLeave={(e) => {
                  setScrollTooltip(null);
                  e.currentTarget.style.background = followStreaming
                    ? "color-mix(in srgb, var(--accent) 18%, var(--bg-panel))"
                    : "color-mix(in srgb, var(--bg-panel) 92%, transparent)";
                  e.currentTarget.style.color = followStreaming ? "var(--accent)" : "var(--text-muted)";
                }}
                style={{
                  pointerEvents: "auto",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  border: followStreaming
                    ? "1px solid color-mix(in srgb, var(--accent) 55%, var(--border))"
                    : "1px solid var(--border)",
                  background: followStreaming
                    ? "color-mix(in srgb, var(--accent) 18%, var(--bg-panel))"
                    : "color-mix(in srgb, var(--bg-panel) 92%, transparent)",
                  color: followStreaming ? "var(--accent)" : "var(--text-muted)",
                  cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(15,23,42,0.22)",
                  transition: "color 0.12s, background 0.12s",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
          )}
          {scrollTooltip && (
            <div style={{
              position: "absolute",
              // Show on the left side of the buttons, toward the message
              // column, instead of the viewport edge.
              right: "calc(100% + 10px)",
              top: scrollTooltip === "earliest" ? 17
                : scrollTooltip === "prevUser" ? 71
                : scrollTooltip === "nextUser" ? 125
                : 179,
              whiteSpace: "nowrap",
              fontSize: 12,
              color: "var(--text)",
              background: "color-mix(in srgb, var(--bg-panel) 96%, transparent)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 8px",
              boxShadow: "0 2px 10px rgba(15,23,42,0.25)",
              pointerEvents: "none",
              zIndex: 31,
            }}>
              {scrollTooltip === "earliest" ? t("chat.scrollToEarliest")
                : scrollTooltip === "prevUser" ? t("chat.scrollToPrevUser")
                : scrollTooltip === "nextUser" ? t("chat.scrollToNextUser")
                : t("chat.scrollToLatestFollowHint")}
            </div>
          )}
        </div>
      )}
      {followToast && (
        <div style={{
          position: "absolute",
          bottom: 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 40,
          fontSize: 13,
          color: "var(--text)",
          background: "color-mix(in srgb, var(--bg-panel) 96%, transparent)",
          border: "1px solid color-mix(in srgb, var(--accent) 50%, var(--border))",
          borderRadius: 8,
          padding: "6px 14px",
          boxShadow: "0 2px 12px rgba(15,23,42,0.25)",
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}>
          {t("chat.followStreamingOn")}
        </div>
      )}
    </>
  );
}
