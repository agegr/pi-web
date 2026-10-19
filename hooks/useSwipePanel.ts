"use client";

import { useEffect, useRef, type RefObject } from "react";
import {
  SWIPE_VELOCITY_WINDOW_MS,
  readSwipeIntent,
  swipeCommits,
  swipeTravel,
  velocityOf,
  type SwipeIntent,
  type SwipeSample,
} from "@/lib/swipe-gesture";

/**
 * Touch gestures for the mobile drawers: a swipe from the screen's left edge
 * brings the sidebar in, a swipe left on the sidebar sends it away, and a
 * swipe from the left edge over the full-screen file panel goes back (closes
 * it). The panel follows the finger while the swipe is in progress and
 * settles one way or the other on release (lib/swipe-gesture.ts holds the
 * thresholds).
 *
 * The edge strip starts its swipe from pointer events: it is `touch-action:
 * none`, so the browser has nothing to take and the pointer stream stays
 * whole. A drawer's own close swipe runs on touch events instead: the drawer
 * scrolls vertically, so its `touch-action: pan-y` lets the browser start a
 * scroll, and Chrome answers the first sideways move with pointercancel. A
 * non-passive touchmove listener added with the touch can hold the gesture
 * back from the scroller instead. Either way the press stays a tap, and a
 * group header's long-press still picks the group up, until the swipe is
 * clearly sideways.
 */

export type SwipePanelSide = "left" | "right";

export interface SwipePanelOptions {
  /** Mobile only, and off while another overlay owns the edge. */
  enabled: boolean;
  open: boolean;
  /** Which way the panel leaves the screen: a left drawer slides left, a right panel slides right. */
  side: SwipePanelSide;
  /** The screen's left edge strip opens this panel; false makes it a back gesture that closes it. */
  edgeOpens: boolean;
  /** The panel itself answers a swipe away (the drawer); a full-screen panel only answers the edge. */
  panelSwipe: boolean;
  panelRef: RefObject<HTMLElement | null>;
  /** The dim layer behind a drawer, faded with the drag. */
  backdropRef?: RefObject<HTMLElement | null>;
  /** The fixed strip at the screen's left edge that starts the gesture. */
  edgeRef?: RefObject<HTMLElement | null>;
  /** The backdrop's opacity at rest when open; it is 1 behind a drawer the app already dims. */
  backdropOpacity?: number;
  onOpenChange(open: boolean): void;
}

/** A press starting here belongs to something else: a field's caret, a group's long-press, a menu on top. */
const IGNORE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[data-swipe-ignore]",
  // Long-press drags the group and a swipe closes the drawer; the drag wins.
  ".session-tree-group",
  // A sheet above the drawer: its own gestures are the sheet's.
  ".sidebar-sheet-layer",
].join(", ");

interface GestureState {
  kind: "pointer" | "touch";
  /** The pointerId, or the touch's identifier. */
  id: number;
  pointerType: string;
  mode: "open" | "close";
  /** The element that holds the pointer once the swipe is claimed. */
  captureTarget: Element;
  startX: number;
  startY: number;
  width: number;
  intent: SwipeIntent;
  travel: number;
  claimed: boolean;
  samples: SwipeSample[];
}

export function useSwipePanel(options: SwipePanelOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { enabled } = options;

  useEffect(() => {
    if (!enabled) return;
    const panel = optionsRef.current.panelRef.current;
    if (!panel) return;
    const edge = optionsRef.current.edgeRef?.current ?? null;
    let gesture: GestureState | null = null;

    const removeWindowListeners = () => {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("touchmove", onTouchMove, true);
      window.removeEventListener("touchend", onTouchEnd, true);
      window.removeEventListener("touchcancel", onTouchCancel, true);
    };

    const teardown = () => {
      const current = gesture;
      gesture = null;
      removeWindowListeners();
      if (!current || current.kind !== "pointer") return;
      try {
        if (current.captureTarget.hasPointerCapture(current.id)) current.captureTarget.releasePointerCapture(current.id);
      } catch {
        // The pointer was already released (or the element left the document).
      }
    };

    /** Immovable for the duration: the finger, not the CSS transition, places the panel. */
    const claim = (current: GestureState) => {
      current.claimed = true;
      const opts = optionsRef.current;
      const panelElement = opts.panelRef.current;
      if (panelElement) panelElement.style.transition = "none";
      const backdrop = opts.backdropRef?.current;
      if (backdrop) {
        backdrop.style.transition = "none";
        backdrop.style.pointerEvents = "none";
      }
      if (current.kind !== "pointer") return;
      try {
        current.captureTarget.setPointerCapture(current.id);
      } catch {
        // Touch already has an implicit capture; the window listeners still see the moves.
      }
    };

    const paint = (current: GestureState) => {
      const opts = optionsRef.current;
      const panelElement = opts.panelRef.current;
      if (!panelElement) return;
      const progress = current.width > 0 ? current.travel / current.width : 0;
      const offset = current.mode === "open"
        ? current.travel - current.width
        : opts.side === "left" ? -current.travel : current.travel;
      panelElement.style.transform = `translateX(${offset}px)`;
      const backdrop = opts.backdropRef?.current;
      if (backdrop) {
        const base = opts.backdropOpacity ?? 1;
        backdrop.style.opacity = String(base * (current.mode === "open" ? progress : 1 - progress));
      }
    };

    /** The destination of a drag: +1 when the finger moves right, -1 when it moves left. */
    const directionOf = (current: GestureState): 1 | -1 => {
      if (current.mode === "open") return 1;
      return optionsRef.current.side === "left" ? -1 : 1;
    };

    const settle = (current: GestureState, open: boolean) => {
      const opts = optionsRef.current;
      const panelElement = opts.panelRef.current;
      const backdrop = opts.backdropRef?.current;
      // Restore the panel's own transition, so it finishes the move from where the finger left it.
      if (panelElement) panelElement.style.transition = "";
      if (backdrop) {
        backdrop.style.transition = "";
        backdrop.style.pointerEvents = open ? "auto" : "none";
        backdrop.style.opacity = open ? String(opts.backdropOpacity ?? 1) : "0";
      }
      if (opts.open !== open) opts.onOpenChange(open);
      // The class (or React's style) now says where the panel belongs; dropping the inline
      // transform a frame later lets the restored transition carry it there.
      requestAnimationFrame(() => {
        if (panelElement) panelElement.style.transform = "";
      });
      teardown();
    };

    /** Reads a move: decides the axis, then drags the panel. Returns false when the gesture ended. */
    const moveTo = (current: GestureState, x: number, y: number, time: number, event: Event) => {
      const dx = x - current.startX;
      const dy = y - current.startY;
      if (current.intent === "pending") {
        const intent = readSwipeIntent(dx, dy);
        if (intent === "pending") return true;
        if (intent === "vertical" || swipeTravel(dx, directionOf(current)) <= 0) {
          // A scroll, or a swipe the wrong way: the press stays a press.
          teardown();
          return false;
        }
        current.intent = "horizontal";
        claim(current);
      }
      // Stop the browser's own scroll/selection attempts on this gesture.
      if (event.cancelable) event.preventDefault();
      current.travel = Math.max(0, Math.min(current.width, swipeTravel(dx, directionOf(current))));
      current.samples.push({ travel: current.travel, time });
      // Keep the one sample before the velocity window, so its speed is measured across it.
      while (current.samples.length > 2 && time - current.samples[1].time > SWIPE_VELOCITY_WINDOW_MS) {
        current.samples.shift();
      }
      paint(current);
      return true;
    };

    const endAt = (current: GestureState, time: number) => {
      if (!current.claimed) {
        teardown();
        return;
      }
      const velocity = velocityOf(current.samples, time);
      const committed = swipeCommits({ travel: current.travel, size: current.width, velocity });
      settle(current, current.mode === "open" ? committed : !committed);
    };

    function onPointerMove(event: PointerEvent) {
      const current = gesture;
      if (!current || current.kind !== "pointer" || event.pointerId !== current.id) return;
      moveTo(current, event.clientX, event.clientY, event.timeStamp, event);
    }

    function onPointerUp(event: PointerEvent) {
      const current = gesture;
      if (!current || current.kind !== "pointer" || event.pointerId !== current.id) return;
      endAt(current, event.timeStamp);
    }

    function onPointerCancel(event: PointerEvent) {
      const current = gesture;
      if (!current || current.kind !== "pointer" || event.pointerId !== current.id) return;
      if (current.claimed) settle(current, optionsRef.current.open);
      else teardown();
    }

    function onTouchMove(event: TouchEvent) {
      const current = gesture;
      if (!current || current.kind !== "touch") return;
      const point = Array.from(event.touches).find((touch) => touch.identifier === current.id);
      if (!point) return;
      moveTo(current, point.clientX, point.clientY, event.timeStamp, event);
    }

    function onTouchEnd(event: TouchEvent) {
      const current = gesture;
      if (!current || current.kind !== "touch") return;
      if (!Array.from(event.changedTouches).some((touch) => touch.identifier === current.id)) return;
      endAt(current, event.timeStamp);
    }

    function onTouchCancel(event: TouchEvent) {
      const current = gesture;
      if (!current || current.kind !== "touch") return;
      if (!Array.from(event.changedTouches).some((touch) => touch.identifier === current.id)) return;
      if (current.claimed) settle(current, optionsRef.current.open);
      else teardown();
    }

    const begin = (state: Omit<GestureState, "width" | "intent" | "travel" | "claimed" | "samples">, time: number) => {
      if (gesture) return;
      const opts = optionsRef.current;
      if (!opts.enabled) return;
      if (state.mode === "open" && opts.open) return;
      if (state.mode === "close" && !opts.open) return;
      const panelElement = opts.panelRef.current;
      if (!panelElement) return;
      const width = panelElement.getBoundingClientRect().width;
      if (width <= 0) return;
      gesture = {
        ...state,
        width,
        intent: "pending",
        travel: 0,
        claimed: false,
        samples: [{ travel: 0, time }],
      };
      if (state.kind === "pointer") {
        window.addEventListener("pointermove", onPointerMove, true);
        window.addEventListener("pointerup", onPointerUp, true);
        window.addEventListener("pointercancel", onPointerCancel, true);
      } else {
        // Not passive: the first clearly sideways move must be able to keep the gesture
        // away from the list's scroller.
        window.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
        window.addEventListener("touchend", onTouchEnd, true);
        window.addEventListener("touchcancel", onTouchCancel, true);
      }
    };

    const onEdgePointerDown = (event: PointerEvent) => {
      // Touch and pen only: a mouse would fight the resize handles and text selection.
      if (event.pointerType === "mouse" || !event.isPrimary || event.button !== 0) return;
      begin({
        kind: "pointer",
        id: event.pointerId,
        pointerType: event.pointerType,
        mode: optionsRef.current.edgeOpens ? "open" : "close",
        captureTarget: event.currentTarget as Element,
        startX: event.clientX,
        startY: event.clientY,
      }, event.timeStamp);
    };

    const onPanelTouchStart = (event: TouchEvent) => {
      if (!optionsRef.current.panelSwipe) return;
      if (gesture) {
        // A second finger is a pinch, not a swipe.
        if (event.touches.length > 1) {
          const current = gesture;
          if (current.claimed) settle(current, optionsRef.current.open);
          else teardown();
        }
        return;
      }
      if (event.touches.length !== 1) return;
      const target = event.target;
      if (target instanceof Element && target.closest(IGNORE_SELECTOR)) return;
      const touch = event.touches[0];
      begin({
        kind: "touch",
        id: touch.identifier,
        pointerType: "touch",
        mode: "close",
        captureTarget: panel,
        startX: touch.clientX,
        startY: touch.clientY,
      }, event.timeStamp);
    };

    // Safari's own back-swipe starts from the same edge; the strip exists to take that gesture.
    const blockEdgeNativeGesture = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };

    edge?.addEventListener("pointerdown", onEdgePointerDown);
    edge?.addEventListener("touchstart", blockEdgeNativeGesture, { passive: false });
    if (optionsRef.current.panelSwipe) panel.addEventListener("touchstart", onPanelTouchStart, { passive: true });
    return () => {
      edge?.removeEventListener("pointerdown", onEdgePointerDown);
      edge?.removeEventListener("touchstart", blockEdgeNativeGesture);
      panel.removeEventListener("touchstart", onPanelTouchStart);
      // A gesture cut short by an unmount or a breakpoint change leaves the
      // panel where the finger had it: hand it back to its own styles.
      if (gesture?.claimed) {
        const panelElement = optionsRef.current.panelRef.current;
        if (panelElement) {
          panelElement.style.transition = "";
          panelElement.style.transform = "";
        }
        const backdrop = optionsRef.current.backdropRef?.current;
        if (backdrop) {
          backdrop.style.transition = "";
          backdrop.style.opacity = "";
        }
      }
      teardown();
    };
  }, [enabled]);
}
