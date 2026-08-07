"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent,
} from "react";

interface DragState {
  pointerId: number;
  startY: number;
  startHeight: number;
  moved: boolean;
  previousCursor: string;
  previousUserSelect: string;
}

interface UseResizableHeightOptions {
  /** aria-label for the separator (drag handle) */
  ariaLabel: string;
  /** hard floor for the manual height (px) */
  minHeight: number;
  /** viewport-aware ceiling for the manual height (px) */
  getMaxHeight: () => number;
  /** localStorage key for persisting the manual height */
  storageKey: string;
  /** element whose height is controlled (the composer shell) */
  targetRef: MutableRefObject<HTMLDivElement | null>;
}

/** Pointer travel (px) before a drag is considered real — prevents a plain
 *  click on the handle from pinning the composer to its current auto height. */
const DRAG_ACTIVATE_THRESHOLD_PX = 3;

function readStoredHeight(storageKey: string): number | null {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) return null;
    const parsed = Number.parseInt(stored, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredHeight(storageKey: string, height: number): void {
  try {
    window.localStorage.setItem(storageKey, String(height));
  } catch {
    // Resizing remains available when storage is unavailable.
  }
}

function clearStoredHeight(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore storage failures — the manual height simply resets for this mount.
  }
}

function clampHeight(candidate: number, minHeight: number, maxHeight: number): number {
  const finiteHeight = Number.isFinite(candidate) ? candidate : minHeight;
  const effectiveMax = Math.max(minHeight, maxHeight);
  return Math.round(Math.max(minHeight, Math.min(effectiveMax, finiteHeight)));
}

/**
 * Vertical counterpart of `useResizablePanel`: lets the user resize a target
 * element's height by dragging a horizontal separator handle placed on its
 * top edge (dragging up grows the element). Returns `height: null` when the
 * element should keep its natural (content-driven) height — i.e. the same
 * "auto" semantics the composer relies on — and a pixel value once the user
 * has taken manual control. The value is persisted across mounts so a
 * resized composer survives session switches.
 */
export function useResizableHeight(options: UseResizableHeightOptions) {
  const { ariaLabel, minHeight, getMaxHeight, storageKey, targetRef } = options;
  const dragRef = useRef<DragState | null>(null);
  const restoredRef = useRef(false);
  // null = auto height (content-driven); a number = fixed manual height.
  const [height, setHeight] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const heightRef = useRef<number | null>(null);
  heightRef.current = height;

  const effectiveMaxHeight = useCallback(
    () => Math.max(minHeight, getMaxHeight()),
    [getMaxHeight, minHeight],
  );

  const restoreBodyState = useCallback((drag: DragState) => {
    document.body.style.cursor = drag.previousCursor;
    document.body.style.userSelect = drag.previousUserSelect;
  }, []);

  const finishResize = useCallback((pointerId: number) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    restoreBodyState(drag);
    setIsResizing(false);
    const current = heightRef.current;
    if (current !== null) writeStoredHeight(storageKey, current);
  }, [restoreBodyState, storageKey]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const activeDrag = dragRef.current;
    if (activeDrag) finishResize(activeDrag.pointerId);

    const target = event.currentTarget;
    target.focus({ preventScroll: true });
    target.setPointerCapture(event.pointerId);

    // Manual mode is only entered once the pointer actually moves (see the
    // dead zone in onPointerMove), but capture the starting height now so the
    // transition is seamless.
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: clampHeight(
        targetRef.current?.offsetHeight ?? minHeight,
        minHeight,
        effectiveMaxHeight(),
      ),
      moved: false,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    setIsResizing(true);
  }, [effectiveMaxHeight, finishResize, minHeight, targetRef]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      finishResize(event.pointerId);
      return;
    }
    event.preventDefault();
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(deltaY) < DRAG_ACTIVATE_THRESHOLD_PX) return;
    drag.moved = true;
    // The handle sits on the top edge: moving up (smaller clientY) grows the
    // composer, moving down shrinks it.
    const nextHeight = drag.startHeight - deltaY;
    const clamped = clampHeight(nextHeight, minHeight, effectiveMaxHeight());
    setHeight(clamped);
    event.currentTarget.setAttribute("aria-valuenow", String(clamped));
    event.currentTarget.setAttribute("aria-valuetext", `${clamped} px`);
  }, [effectiveMaxHeight, finishResize, minHeight]);

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    finishResize(event.pointerId);
  }, [finishResize]);

  const onPointerCancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
    finishResize(event.pointerId);
  }, [finishResize]);

  const onLostPointerCapture = useCallback((event: PointerEvent<HTMLDivElement>) => {
    finishResize(event.pointerId);
  }, [finishResize]);

  const resetHeight = useCallback(() => {
    dragRef.current = null;
    setIsResizing(false);
    setHeight(null);
    clearStoredHeight(storageKey);
  }, [storageKey]);

  const setHeightTo = useCallback((next: number) => {
    const clamped = clampHeight(next, minHeight, effectiveMaxHeight());
    setHeight(clamped);
    writeStoredHeight(storageKey, clamped);
  }, [effectiveMaxHeight, minHeight, storageKey]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 24;
    const current = heightRef.current ?? targetRef.current?.offsetHeight ?? minHeight;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHeightTo(current + step);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHeightTo(current - step);
    } else if (event.key === "Home") {
      event.preventDefault();
      setHeightTo(minHeight);
    } else if (event.key === "End") {
      event.preventDefault();
      setHeightTo(effectiveMaxHeight());
    } else if (event.key === "Enter") {
      event.preventDefault();
      resetHeight();
    }
  }, [effectiveMaxHeight, minHeight, resetHeight, setHeightTo, targetRef]);

  // Restore the persisted manual height once on mount, clamped to the
  // current viewport ceiling.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const stored = readStoredHeight(storageKey);
    if (stored !== null) {
      setHeight(clampHeight(stored, minHeight, effectiveMaxHeight()));
    }
  }, [effectiveMaxHeight, minHeight, storageKey]);

  // Re-clamp the manual height when the viewport changes the ceiling.
  useEffect(() => {
    const onResize = () => {
      if (heightRef.current === null) return;
      const clamped = clampHeight(heightRef.current, minHeight, effectiveMaxHeight());
      if (clamped !== heightRef.current) setHeight(clamped);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [effectiveMaxHeight, minHeight]);

  // Cancel an in-flight drag when the window loses focus or the tab hides.
  useEffect(() => {
    if (!isResizing) return;
    const cancelResize = () => {
      const drag = dragRef.current;
      if (drag) finishResize(drag.pointerId);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") cancelResize();
    };
    window.addEventListener("blur", cancelResize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", cancelResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [finishResize, isResizing]);

  useEffect(() => () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    restoreBodyState(drag);
  }, [restoreBodyState]);

  return {
    height,
    isResizing,
    resetHeight,
    separatorProps: {
      "aria-label": ariaLabel,
      "aria-orientation": "horizontal" as const,
      "aria-valuemax": effectiveMaxHeight(),
      "aria-valuemin": minHeight,
      "aria-valuenow": height ?? minHeight,
      "aria-valuetext": height !== null ? `${height} px` : undefined,
      onDoubleClick: resetHeight,
      onKeyDown,
      onLostPointerCapture,
      onPointerCancel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      role: "separator" as const,
      tabIndex: 0,
    },
    setHeight: setHeightTo,
  };
}