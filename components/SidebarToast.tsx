"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CloseIcon } from "./SidebarIcons";

/**
 * The session sidebar's one-line toast: "Archived “…”" with Undo and View, or
 * a failed save. One at a time; a new one (a new `id`) replaces the last. It
 * sits at the bottom of the sidebar, inside it (the sidebar root is
 * `position: relative`), not portaled: it belongs to the sidebar and closes
 * with the mobile drawer.
 */

export interface SidebarToastAction {
  id: string;
  label: string;
  onClick: () => void;
}

export interface SidebarToastData {
  id: number;
  message: string;
  /**
   * Text after `message` that stays in view when the line is too long: only
   * `message` is cut (a fork's name before its suffix, "Forked “PR#1030 状态…"
   * then " · 3f9a”").
   */
  tail?: string;
  actions: SidebarToastAction[];
}

export interface SidebarToastProps {
  toast: SidebarToastData | null;
  onDismiss: () => void;
  /** The × button's accessible name. */
  dismissLabel: string;
  /** How long the toast stays while nobody points at or focuses it. */
  durationMs?: number;
}

/** Long enough to read the message and reach Undo; hovering or focusing it pauses the countdown. */
const DEFAULT_TOAST_DURATION_MS = 10_000;

interface ToastCardProps {
  toast: SidebarToastData;
  dismissLabel: string;
  durationMs: number;
  onDismissRef: { readonly current: () => void };
}

/**
 * One toast. Keyed by its id, so a new toast is a new element: its entrance
 * animation and its timer start once, and a re-render of the same toast
 * restarts neither.
 */
function SidebarToastCard({ toast, dismissLabel, durationMs, onDismissRef }: ToastCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  // A toast that replaces another under a still mouse gets no pointerenter
  // until the mouse moves; it is hovered all the same. (A touch screen keeps
  // `:hover` on whatever was tapped last, so it does not count there.)
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (card && window.matchMedia?.("(hover: hover)").matches && card.matches(":hover")) setHovered(true);
  }, []);

  // The countdown starts over whenever the pointer or focus leaves.
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => onDismissRef.current(), durationMs);
    return () => window.clearTimeout(timer);
  }, [paused, durationMs, onDismissRef]);

  return (
    <div
      ref={cardRef}
      className="sidebar-toast"
      // Only a mouse pauses it: a tap would leave it "hovered" until the next
      // tap elsewhere, and the toast would never go.
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {toast.tail ? (
        <span className="sidebar-toast-message has-tail" title={toast.message + toast.tail}>
          <span className="sidebar-toast-message-head">{toast.message}</span>
          <span className="sidebar-toast-message-tail">{toast.tail}</span>
        </span>
      ) : (
        <span className="sidebar-toast-message" title={toast.message}>{toast.message}</span>
      )}
      {toast.actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="sidebar-toast-action"
          onClick={() => {
            // Dismissed first, so a toast the action shows itself (Undo
            // failed) replaces this one instead of being dismissed with it.
            onDismissRef.current();
            action.onClick();
          }}
        >
          {action.label}
        </button>
      ))}
      <button
        type="button"
        className="sidebar-toast-dismiss"
        aria-label={dismissLabel}
        title={dismissLabel}
        onClick={() => onDismissRef.current()}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}

export function SidebarToast({ toast, onDismiss, dismissLabel, durationMs = DEFAULT_TOAST_DURATION_MS }: SidebarToastProps): ReactNode {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // The live region stays on the page while empty, so a screen reader is
  // already watching it when a toast appears in it.
  return (
    <div className="sidebar-toast-region" role="status" aria-live="polite">
      {toast ? (
        <SidebarToastCard
          key={toast.id}
          toast={toast}
          dismissLabel={dismissLabel}
          durationMs={durationMs}
          onDismissRef={onDismissRef}
        />
      ) : null}
    </div>
  );
}
