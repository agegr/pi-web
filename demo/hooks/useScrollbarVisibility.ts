import { useEffect, type RefObject } from "react";

const HIDE_DELAY_MS = 500;

export function useScrollbarVisibility(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    let element: HTMLElement | null = null;
    let attachFrame: number | null = null;
    let disposed = false;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const clearHideTimer = () => {
      if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    };
    const show = () => {
      if (!element) return;
      clearHideTimer();
      element.classList.add("scrollbar-visible");
    };
    const hideSoon = () => {
      if (!element) return;
      clearHideTimer();
      hideTimer = setTimeout(() => {
        hideTimer = null;
        element?.classList.remove("scrollbar-visible");
      }, HIDE_DELAY_MS);
    };
    const onScroll = () => {
      show();
      hideSoon();
    };

    const attach = () => {
      if (disposed) return;
      element = ref.current;
      if (!element) {
        attachFrame = requestAnimationFrame(attach);
        return;
      }
      element.addEventListener("pointerenter", show);
      element.addEventListener("pointerleave", hideSoon);
      element.addEventListener("scroll", onScroll);
    };
    attach();

    return () => {
      disposed = true;
      if (attachFrame !== null) cancelAnimationFrame(attachFrame);
      element?.removeEventListener("pointerenter", show);
      element?.removeEventListener("pointerleave", hideSoon);
      element?.removeEventListener("scroll", onScroll);
      clearHideTimer();
      element?.classList.remove("scrollbar-visible");
    };
  }, [enabled, ref]);
}
