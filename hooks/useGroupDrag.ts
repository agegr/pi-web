"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  autoScrollDelta,
  ghostTopFor,
  groupBlocks,
  groupDropAt,
  type GroupBlock,
  type GroupDrop,
  type SidebarLayout,
  type SidebarRow,
} from "@/lib/session-tree";
import type { ProjectMovePosition } from "@/lib/session-ui-state-shared";

/**
 * Dragging a project group's header to reorder the session tree's groups
 * (components/SessionTree.tsx). Pointer events, not HTML5 drag and drop:
 * that never starts from a touch on iOS and gives no say over scrolling a
 * virtualized list. A mouse picks the group up once it has moved
 * DRAG_START_PX; touch and pen hold it LONG_PRESS_MS first, so a swipe still
 * scrolls the list and a tap still toggles the group. The drop target comes
 * from the model's rows and offsets (groupDropAt), never from the DOM, so
 * rows the virtualizer has not mounted count as well.
 */

/** A mouse drag starts once the pointer has moved this far. */
export const DRAG_START_PX = 4;
/** Touch and pen: a press held this long picks the group up. */
export const LONG_PRESS_MS = 350;
/** A finger that moves farther before that is scrolling: the press is let go. */
export const LONG_PRESS_SLOP_PX = 8;
/** How near the list's top or bottom edge a drag scrolls it. */
export const AUTO_SCROLL_EDGE: Record<SidebarLayout, number> = { desktop: 32, mobile: 48 };
/** Most pixels auto-scroll moves the list in one frame. */
export const AUTO_SCROLL_MAX_STEP = 14;
/** Room the ghost keeps from the pointer: a finger or pen hides more than a cursor. */
export const GHOST_GAP_PX = { mouse: 8, touch: 28 } as const;
/** Room the ghost keeps from the drop line, whatever the pointer. */
export const GHOST_LINE_GAP_PX = 8;
/** The ghost's left edge, in from the header's (the rows' left inset). */
const GHOST_INDENT_PX = 4;
/** The click a release produces follows it at once; one later than this is the user's own. */
const CLICK_SUPPRESS_MS = 600;

type DragPhase = "pending" | "armed" | "dragging" | "cancelled";

interface DragState {
  pointerId: number;
  pointerType: string;
  projectKey: string;
  /** The header row: it holds a mouse or pen's pointer capture and gives the ghost its left edge. */
  element: HTMLElement;
  startX: number;
  startY: number;
  /** Where a long-press picked the group up; the drag starts DRAG_START_PX from there. */
  armX: number;
  armY: number;
  clientX: number;
  clientY: number;
  phase: DragPhase;
  timer: number | null;
  frame: number | null;
  /** The list's scrollTop as the drag left it: any other value means the browser scrolled it. */
  expectedScrollTop: number;
  drop: GroupDrop | null;
  ghost: { left: number } | null;
}

export interface GroupDragView {
  projectKey: string;
  /** "armed": a long-press picked the group up; "dragging": it follows the pointer. */
  phase: "armed" | "dragging";
  drop: GroupDrop | null;
  /** The dragged group's block while dragging, else null. */
  source: GroupBlock | null;
}

/** Stable: a header calls these from its own listeners. */
export interface GroupDragHandlers {
  onPointerDown(event: ReactPointerEvent<HTMLElement>, projectKey: string): void;
  /** From the header's non-passive touchmove listener: holds the list still while a group is picked up. */
  onTouchMove(event: TouchEvent): void;
}

export interface GroupDragOptions {
  rows: SidebarRow[];
  offsets: number[];
  layout: SidebarLayout;
  /** False while loading or without onMove: a drag under way is cancelled. */
  enabled: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** `.session-tree-inner`: content coordinates are relative to its top. */
  innerRef: RefObject<HTMLDivElement | null>;
  /** `.session-tree`, the ghost's positioned parent (outside the scroll box). */
  treeRef: RefObject<HTMLDivElement | null>;
  ghostRef: RefObject<HTMLDivElement | null>;
  onMove(projectKey: string, anchorKey: string, position: ProjectMovePosition): void;
}

export interface GroupDragApi {
  view: GroupDragView | null;
  handlers: GroupDragHandlers;
  /** On the scroll box: eats the click a drag's (or a long-press's) release produces. */
  onClickCapture(event: ReactMouseEvent): void;
  /** On the scroll box: a new press means the next click is the user's. */
  onPointerDownCapture(): void;
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

function sameDrop(a: GroupDrop | null, b: GroupDrop | null): boolean {
  return a === b || (a !== null && b !== null && a.anchorKey === b.anchorKey && a.position === b.position && a.lineY === b.lineY);
}

/** Laid out: not display: none itself or inside something that is (the archive view, the files tab). */
function isRendered(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

export function useGroupDrag(options: GroupDragOptions): GroupDragApi {
  const { rows, offsets, enabled } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const blocks = useMemo(() => groupBlocks(rows, offsets), [rows, offsets]);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const dragRef = useRef<DragState | null>(null);
  // Event time (timeStamp) until which a click is the release's own; 0 = none.
  const suppressClickUntilRef = useRef(0);
  // Set only when the phase or the drop target changes, never per pointermove.
  const [state, setState] = useState<Omit<GroupDragView, "source"> | null>(null);

  const machine = useMemo(() => {
    const scrollElement = () => optionsRef.current.scrollRef.current;

    const publish = (drag: DragState) => {
      setState(drag.phase === "armed" || drag.phase === "dragging"
        ? { projectKey: drag.projectKey, phase: drag.phase, drop: drag.drop }
        : null);
    };

    const dropFor = (drag: DragState): GroupDrop | null => {
      const inner = optionsRef.current.innerRef.current;
      if (!inner) return null;
      return groupDropAt(blocksRef.current, drag.projectKey, drag.clientY - inner.getBoundingClientRect().top);
    };

    // The ghost follows the pointer through its style, not through React
    // state: just above it, moved only as far as keeping clear of the
    // pointer and the drop line and inside the list's box takes
    // (ghostTopFor). Its left edge stays at the rows' inset, not under the
    // pointer.
    const placeGhost = () => {
      const drag = dragRef.current;
      const ghost = optionsRef.current.ghostRef.current;
      const tree = optionsRef.current.treeRef.current;
      const inner = optionsRef.current.innerRef.current;
      const scroll = scrollElement();
      if (!drag?.ghost || !ghost || !tree || !scroll) return;
      const treeTop = tree.getBoundingClientRect().top;
      const box = scroll.getBoundingClientRect();
      const height = ghost.offsetHeight;
      const top = ghostTopFor({
        pointerY: drag.clientY,
        lineY: drag.drop && inner ? inner.getBoundingClientRect().top + drag.drop.lineY : null,
        ghostHeight: height,
        pointerGap: drag.pointerType === "mouse" ? GHOST_GAP_PX.mouse : GHOST_GAP_PX.touch,
        lineGap: GHOST_LINE_GAP_PX,
        minTop: box.top,
        maxTop: box.bottom - height,
      });
      ghost.style.top = `${top - treeTop}px`;
      ghost.style.left = `${drag.ghost.left}px`;
    };

    const stopMotion = (drag: DragState) => {
      if (drag.timer !== null) window.clearTimeout(drag.timer);
      if (drag.frame !== null) cancelAnimationFrame(drag.frame);
      drag.timer = null;
      drag.frame = null;
      scrollElement()?.removeEventListener("scroll", onScroll);
      try {
        if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
      } catch {
        // Already released with the pointer.
      }
    };

    /** Ends the gesture: timers, frames, capture, listeners and the view. */
    const teardown = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      stopMotion(drag);
      removeListeners();
      setState(null);
    };

    /**
     * A picked-up group goes back without moving, but the gesture waits for
     * its release, whose click must not toggle the group. A press not picked
     * up yet just ends.
     */
    const cancel = () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.phase !== "armed" && drag.phase !== "dragging") {
        if (drag.phase === "pending") teardown();
        return;
      }
      drag.phase = "cancelled";
      drag.drop = null;
      stopMotion(drag);
      setState(null);
    };

    const updateDrag = (force = false) => {
      const drag = dragRef.current;
      if (!drag || drag.phase !== "dragging") return;
      const scroll = scrollElement();
      if (!scroll || !isRendered(scroll)) {
        cancel();
        return;
      }
      const drop = dropFor(drag);
      const changed = force || !sameDrop(drop, drag.drop);
      // The ghost keeps clear of the line where it is now.
      drag.drop = drop;
      placeGhost();
      if (changed) publish(drag);
    };

    function onScroll() {
      updateDrag();
    }

    // Each frame of a drag near an edge scrolls the list, up to the rows' own
    // height (not scrollHeight: nothing the drag draws may make room to scroll into).
    const autoScroll = () => {
      const drag = dragRef.current;
      if (!drag || drag.phase !== "dragging") return;
      drag.frame = null;
      const scroll = scrollElement();
      if (!scroll || !isRendered(scroll)) {
        cancel();
        return;
      }
      const box = scroll.getBoundingClientRect();
      const delta = autoScrollDelta(drag.clientY, box.top, box.bottom, AUTO_SCROLL_EDGE[optionsRef.current.layout], AUTO_SCROLL_MAX_STEP);
      if (delta !== 0) {
        const contentHeight = optionsRef.current.offsets[optionsRef.current.offsets.length - 1] ?? 0;
        const next = Math.min(Math.max(0, contentHeight - scroll.clientHeight), Math.max(0, scroll.scrollTop + delta));
        if (next !== scroll.scrollTop) {
          scroll.scrollTop = next;
          drag.expectedScrollTop = scroll.scrollTop;
          updateDrag();
        }
      }
      if (dragRef.current === drag && drag.phase === "dragging") drag.frame = requestAnimationFrame(autoScroll);
    };

    const startDragging = (drag: DragState) => {
      const scroll = scrollElement();
      const tree = optionsRef.current.treeRef.current;
      if (!scroll || !tree || !isRendered(scroll) || !drag.element.isConnected) {
        cancel();
        return;
      }
      drag.phase = "dragging";
      // A release outside the window still reaches the header. Touch has an implicit capture.
      if (drag.pointerType !== "touch") {
        try {
          drag.element.setPointerCapture(drag.pointerId);
        } catch {
          // The window listeners still see the pointer.
        }
      }
      drag.ghost = { left: drag.element.getBoundingClientRect().left - tree.getBoundingClientRect().left + GHOST_INDENT_PX };
      drag.expectedScrollTop = scroll.scrollTop;
      scroll.addEventListener("scroll", onScroll, { passive: true });
      drag.frame = requestAnimationFrame(autoScroll);
      updateDrag(true);
    };

    const arm = () => {
      const drag = dragRef.current;
      if (!drag || drag.phase !== "pending") return;
      drag.timer = null;
      drag.phase = "armed";
      drag.armX = drag.clientX;
      drag.armY = drag.clientY;
      drag.expectedScrollTop = scrollElement()?.scrollTop ?? 0;
      publish(drag);
    };

    function onPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      // A release outside the window before the drag took the capture: no pointerup came.
      if (drag.pointerType === "mouse" && event.buttons === 0) {
        teardown();
        return;
      }
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      const moved = distance(drag.startX, drag.startY, event.clientX, event.clientY);
      switch (drag.phase) {
        case "pending":
          if (drag.pointerType === "mouse") {
            if (moved >= DRAG_START_PX) startDragging(drag);
          } else if (moved > LONG_PRESS_SLOP_PX) {
            // A swipe: the list scrolls as usual.
            teardown();
          }
          break;
        case "armed":
          if (distance(drag.armX, drag.armY, event.clientX, event.clientY) >= DRAG_START_PX) startDragging(drag);
          break;
        case "dragging":
          updateDrag();
          break;
      }
    }

    function onPointerUp(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (drag.phase === "dragging") {
        drag.clientX = event.clientX;
        drag.clientY = event.clientY;
        const drop = dropFor(drag);
        if (drop) optionsRef.current.onMove(drag.projectKey, drop.anchorKey, drop.position);
      }
      // A plain click (still pending) toggles the group; after a pick-up it must not.
      if (drag.phase !== "pending") suppressClickUntilRef.current = event.timeStamp + CLICK_SUPPRESS_MS;
      teardown();
    }

    function onPointerCancel(event: PointerEvent) {
      if (dragRef.current && event.pointerId === dragRef.current.pointerId) teardown();
    }

    // A second finger (or pointer) is not a drag.
    function onOtherPointerDown(event: PointerEvent) {
      if (dragRef.current && event.pointerId !== dragRef.current.pointerId) cancel();
    }

    // Escape puts a picked-up group back. In the capture phase, marked handled,
    // so the window-level Escape that stops a running agent (handleGlobalEscape)
    // leaves it alone. A press not picked up yet lets Escape through.
    function onKeyDown(event: KeyboardEvent) {
      const drag = dragRef.current;
      if (!drag || event.key !== "Escape" || (drag.phase !== "armed" && drag.phase !== "dragging")) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }

    // Android's long-press menu, or a Ctrl+click: a press not picked up yet
    // ends; once picked up the menu is held back.
    function onContextMenu(event: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.phase === "pending") {
        teardown();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    }

    function onBlur() {
      teardown();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") teardown();
    }

    function addListeners() {
      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("pointerup", onPointerUp, true);
      window.addEventListener("pointercancel", onPointerCancel, true);
      window.addEventListener("pointerdown", onOtherPointerDown, true);
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("contextmenu", onContextMenu, true);
      window.addEventListener("blur", onBlur);
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    function removeListeners() {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("pointerdown", onOtherPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }

    const handlers: GroupDragHandlers = {
      // Never preventDefault here: a plain click or tap must still toggle the group.
      onPointerDown(event, projectKey) {
        if (!optionsRef.current.enabled || dragRef.current) return;
        if (!event.isPrimary || event.button !== 0 || event.ctrlKey) return;
        // "+" and ⋯ keep their own clicks.
        if (event.target instanceof Element && event.target.closest(".session-tree-group-actions")) return;
        const element = event.currentTarget;
        const drag: DragState = {
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          projectKey,
          element,
          startX: event.clientX,
          startY: event.clientY,
          armX: event.clientX,
          armY: event.clientY,
          clientX: event.clientX,
          clientY: event.clientY,
          phase: "pending",
          timer: null,
          frame: null,
          expectedScrollTop: 0,
          drop: null,
          ghost: null,
        };
        dragRef.current = drag;
        addListeners();
        // Touch and pen scroll the list natively: they pick a group up with a long-press.
        if (event.pointerType !== "mouse") drag.timer = window.setTimeout(arm, LONG_PRESS_MS);
      },
      onTouchMove(event) {
        const drag = dragRef.current;
        // Before the long-press the list scrolls as usual (pointercancel ends the press).
        if (!drag || (drag.phase !== "armed" && drag.phase !== "dragging")) return;
        if (event.cancelable) {
          event.preventDefault();
          return;
        }
        // Not cancelable: Chrome sends such moves inside its touch slop too.
        // Only a list the browser really scrolled ends the drag.
        const scroll = scrollElement();
        if (scroll && scroll.scrollTop !== drag.expectedScrollTop) teardown();
      },
    };

    return { handlers, cancel, teardown, updateDrag, placeGhost };
  }, []);

  // New rows (a refresh, the poll, the virtual window): the dragged group may
  // be gone (archived or deleted in another window), else the target moved.
  useLayoutEffect(() => {
    const drag = dragRef.current;
    if (!drag || (drag.phase !== "armed" && drag.phase !== "dragging")) return;
    if (!rows.some((row) => row.kind === "group" && row.project.key === drag.projectKey)) machine.cancel();
    else machine.updateDrag();
  }, [rows, offsets, machine]);

  useEffect(() => {
    if (!enabled) machine.cancel();
  }, [enabled, machine]);

  const dragging = state?.phase === "dragging";
  // The ghost mounts with the drag; it gets its place before it is painted.
  useLayoutEffect(() => {
    if (dragging) machine.placeGhost();
  }, [dragging, machine]);

  useEffect(() => () => machine.teardown(), [machine]);

  const onClickCapture = useCallback((event: ReactMouseEvent) => {
    const until = suppressClickUntilRef.current;
    if (until === 0) return;
    suppressClickUntilRef.current = 0;
    if (event.timeStamp > until) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);
  const onPointerDownCapture = useCallback(() => {
    suppressClickUntilRef.current = 0;
  }, []);

  const view = useMemo<GroupDragView | null>(() => {
    if (!state) return null;
    const source = state.phase === "dragging" ? blocks.find((block) => block.key === state.projectKey) ?? null : null;
    return { ...state, source };
  }, [state, blocks]);

  return { view, handlers: machine.handlers, onClickCapture, onPointerDownCapture };
}
