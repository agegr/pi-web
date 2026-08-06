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

    const update = () => {
      const keyboardOpen = shouldUseVisualViewportHeight({
        hasFocusedEditable: hasFocusedEditableElement(),
        innerHeight: window.innerHeight,
        viewportHeight: viewport.height,
        viewportScale: viewport.scale,
      });
      if (keyboardOpen) {
        root.style.setProperty("--app-viewport-height", `${viewport.height}px`);
        if (window.scrollX !== 0 || window.scrollY !== 0) {
          window.scrollTo(0, 0);
        }
      } else {
        root.style.removeProperty("--app-viewport-height");
      }
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);

    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      root.style.removeProperty("--app-viewport-height");
    };
  }, []);
}
