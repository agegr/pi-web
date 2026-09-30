"use client";

import { useCallback, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useIsMobile } from "./useIsMobile";

// Both extension dialog variants stay inside their existing padded chat overlay.
export function useDraggableDialog(collapsed: boolean) {
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    offset: { x: number; y: number };
    target: HTMLDivElement;
    cursor: string;
    userSelect: string;
  } | null>(null);

  const place = useCallback(() => {
    const container = containerRef.current;
    const dialog = dialogRef.current;
    if (isMobile) {
      offsetRef.current = { x: 0, y: 0 };
      dialog?.style.removeProperty("transform");
      return;
    }
    if (!container || !dialog) return;
    const padding = getComputedStyle(container);
    const { width, height } = dialog.getBoundingClientRect();
    const centeredX = (container.clientWidth - width) / 2;
    const centeredY = (container.clientHeight - height) / 2;
    const requested = offsetRef.current;
    const x = Math.max(parseFloat(padding.paddingLeft) - centeredX,
      Math.min(container.clientWidth - parseFloat(padding.paddingRight) - width - centeredX, requested.x));
    const y = Math.max(parseFloat(padding.paddingTop) - centeredY,
      Math.min(container.clientHeight - parseFloat(padding.paddingBottom) - height - centeredY, requested.y));
    offsetRef.current = { x, y };
    dialog.style.transform = x || y ? `translate(${x}px, ${y}px)` : "";
  }, [isMobile]);

  const finishDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    document.body.style.cursor = drag.cursor;
    document.body.style.userSelect = drag.userSelect;
    dialogRef.current?.removeAttribute("data-dragging");
    if (drag.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
  }, []);

  const reset = useCallback(() => {
    finishDrag();
    offsetRef.current = { x: 0, y: 0 };
    place();
  }, [finishDrag, place]);

  useLayoutEffect(() => {
    // Collapse unmounts the surface; observe its replacement without losing the offset.
    place();
    const observer = new ResizeObserver(place);
    if (containerRef.current) observer.observe(containerRef.current);
    if (dialogRef.current) observer.observe(dialogRef.current);
    const onVisibilityChange = () => { if (document.visibilityState !== "visible") finishDrag(); };
    window.addEventListener("blur", finishDrag);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      observer.disconnect();
      window.removeEventListener("blur", finishDrag);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      finishDrag();
    };
  }, [collapsed, isMobile, place, finishDrag]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (isMobile || event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offset: { ...offsetRef.current },
      target,
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    dialogRef.current?.setAttribute("data-dragging", "");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.pointerType === "mouse" && event.buttons === 0) { finishDrag(); return; }
    event.preventDefault();
    offsetRef.current = {
      x: drag.offset.x + event.clientX - drag.x,
      y: drag.offset.y + event.clientY - drag.y,
    };
    place();
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) finishDrag();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isMobile || event.nativeEvent.isComposing) return;
    if (["Home", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      reset();
      return;
    }
    const step = event.shiftKey ? 32 : 12;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    if (!delta[event.key]) return;
    event.preventDefault();
    event.stopPropagation();
    offsetRef.current = { x: offsetRef.current.x + delta[event.key][0], y: offsetRef.current.y + delta[event.key][1] };
    place();
  };

  return {
    containerRef,
    dialogRef,
    enabled: !isMobile,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onLostPointerCapture: onPointerEnd,
      onDoubleClick: isMobile ? undefined : reset,
    },
    gripProps: {
      role: isMobile ? undefined : "button",
      tabIndex: isMobile ? undefined : 0,
      onKeyDown,
    },
  };
}
