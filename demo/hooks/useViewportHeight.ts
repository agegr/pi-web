"use client";

import { useEffect } from "react";

interface ViewportHeightState {
  hasFocusedEditable: boolean;
  innerHeight: number;
  viewportHeight: number;
  viewportScale: number;
}

export function shouldUseVisualViewportHeight({
  hasFocusedEditable,
  innerHeight,
  viewportHeight,
  viewportScale,
}: ViewportHeightState): boolean {
  const isUnscaled = Math.abs(viewportScale - 1) < 0.01;
  return hasFocusedEditable && isUnscaled && innerHeight - viewportHeight > 1;
}

function hasFocusedEditableElement(): boolean {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;

  return activeElement.isContentEditable
    || activeElement.tagName === "INPUT"
    || activeElement.tagName === "SELECT"
    || activeElement.tagName === "TEXTAREA";
}

/**
 * Keep the app height aligned with the visual viewport while a mobile keyboard
 * is open. iOS standalone PWAs can leave 100dvh at the layout viewport height,
 * which puts the composer behind the keyboard and may scroll the page itself.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;
    let frameId: number | null = null;

    const update = () => {
      frameId = null;
      const keyboardOpen = shouldUseVisualViewportHeight({
        hasFocusedEditable: hasFocusedEditableElement(),
        innerHeight: window.innerHeight,
        viewportHeight: viewport.height,
        viewportScale: viewport.scale,
      });
      if (keyboardOpen) {
        root.style.setProperty("--app-viewport-height", `${viewport.height}px`);
      } else {
        root.style.removeProperty("--app-viewport-height");
      }

      const pageWasShifted = window.scrollX !== 0 || window.scrollY !== 0;
      const isUnscaled = Math.abs(viewport.scale - 1) < 0.01;
      if (pageWasShifted && isUnscaled) {
        window.scrollTo(0, 0);
      }
    };

    // WebKit can dispatch the resize event before visualViewport.height has
    // settled, especially when an installed PWA dismisses the keyboard. Reading
    // it on the next animation frame prevents the keyboard-height CSS value
    // from remaining after the keyboard has closed.
    const scheduleUpdate = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(update);
    };

    scheduleUpdate();
    viewport.addEventListener("resize", scheduleUpdate);
    viewport.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("focusin", scheduleUpdate);
    window.addEventListener("focusout", scheduleUpdate);
    window.addEventListener("pageshow", scheduleUpdate);

    return () => {
      viewport.removeEventListener("resize", scheduleUpdate);
      viewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("focusin", scheduleUpdate);
      window.removeEventListener("focusout", scheduleUpdate);
      window.removeEventListener("pageshow", scheduleUpdate);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      root.style.removeProperty("--app-viewport-height");
    };
  }, []);
}
