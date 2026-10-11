import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The sidebar's two motions (components/SessionSidebar.tsx, app/sidebar.css):
 * the files section below the sessions folding to its header row and back,
 * and the archive view sliding in over the session tree and away again. CSS
 * runs both this long (SessionSidebar.test.mjs checks that the two agree).
 */
export const SIDEBAR_MOTION_MS = 180;

/**
 * A phase ends on its element's own end event (transitionend,
 * animationend), else this long after it should have: an element that never
 * moved (a sidebar not shown, a transition the browser skipped) fires none,
 * and a view left inert or mounted would wait for it forever.
 */
export const SIDEBAR_MOTION_GRACE_MS = 120;

/**
 * "in": what moves is arriving (the files unfolding, the archive view
 * opening); "out": it is leaving (the files folding, the archive closing).
 */
export type SidebarMotionPhase = "in" | "out" | null;

/** The user asked for less motion: nothing moves, every change is instant. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

export interface SidebarMotion {
  phase: SidebarMotionPhase;
  /** A change the user made that should move: never a restore, a drag or a layout switch. */
  start: (phase: "in" | "out") => void;
  /** Its element's end event. */
  end: () => void;
}

/**
 * One motion's phase. The caller starts it with the change it animates (in
 * the same event, so both render together) and ends it from the moving
 * element's end event; the timer ends it if no event comes. A start during
 * a phase replaces it (a fold undone halfway turns back from where it is).
 * Under prefers-reduced-motion no phase starts.
 */
export function useSidebarMotion(): SidebarMotion {
  const [phase, setPhase] = useState<SidebarMotionPhase>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  const end = useCallback(() => {
    clearTimer();
    setPhase(null);
  }, [clearTimer]);
  const start = useCallback((next: "in" | "out") => {
    clearTimer();
    if (prefersReducedMotion()) {
      setPhase(null);
      return;
    }
    setPhase(next);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setPhase(null);
    }, SIDEBAR_MOTION_MS + SIDEBAR_MOTION_GRACE_MS);
  }, [clearTimer]);
  useEffect(() => clearTimer, [clearTimer]);
  return { phase, start, end };
}

/** The files section below the sessions, folded or open, and on its way. */
export interface FilesFoldState {
  /** The body under the header row: `hidden` once folded, never while it folds away. */
  bodyHidden: boolean;
  /** Inert while it folds away: nothing in it takes focus or a click on its way out. */
  bodyInert: boolean;
  /** The height transition is on (`.is-files-folding`): a fold only, never a drag, keys, a resize or a layout switch. */
  moving: boolean;
  /** Open and done unfolding: the separator shows, and focus asked for in the files goes there. */
  open: boolean;
}

/** Still (phase null), what shows is what showed before the motion: the body hidden iff folded. */
export function filesFoldState(collapsed: boolean, phase: SidebarMotionPhase): FilesFoldState {
  const folding = collapsed && phase === "out";
  const unfolding = !collapsed && phase === "in";
  return {
    bodyHidden: collapsed && !folding,
    bodyInert: folding,
    moving: folding || unfolding,
    open: !collapsed && !unfolding,
  };
}

/** The main session tree and the archive view over it. */
export interface ArchiveViewState {
  /** The main tree: hidden under the open archive once it has slid in. */
  mainHidden: boolean;
  /** Inert while the archive slides in over it. */
  mainInert: boolean;
  /** The archive view is rendered: open, or on its way out. */
  archiveMounted: boolean;
  /** Inert on its way out: nothing in it is clicked twice. */
  archiveInert: boolean;
  /** The archive view's animation (app/sidebar.css). */
  archiveClass: "is-entering" | "is-leaving" | null;
}

/** Still (phase null), what shows is what showed before the motion: the archive alone while open, the tree alone after. */
export function archiveViewState(open: boolean, phase: SidebarMotionPhase): ArchiveViewState {
  const entering = open && phase === "in";
  const leaving = !open && phase === "out";
  return {
    mainHidden: open && !entering,
    mainInert: entering,
    archiveMounted: open || leaving,
    archiveInert: leaving,
    archiveClass: entering ? "is-entering" : leaving ? "is-leaving" : null,
  };
}
