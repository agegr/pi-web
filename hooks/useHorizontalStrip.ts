"use client";

import { useEffect, useRef } from "react";

/**
 * A one-row strip that scrolls sideways with its scrollbar hidden (TabBar's
 * `.tabbar-scroll`): a vertical wheel scrolls it, non-passive so the page does
 * not scroll as well, and the element matching `currentSelector` is brought
 * into view whenever `revealKey` changes, by moving the strip only
 * (scrollIntoView could also scroll the panels around it). Returns the ref for
 * the scrolling element. Used by TabBar and the Agents strip.
 */
export function useHorizontalStrip<T extends HTMLElement>(currentSelector: string, revealKey: string) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || list.scrollWidth <= list.clientWidth) return;
      event.preventDefault();
      list.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientWidth : 1);
    };
    list.addEventListener("wheel", onWheel, { passive: false });
    return () => list.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const list = ref.current;
    const current = list?.querySelector<HTMLElement>(currentSelector);
    if (!list || !current) return;
    const strip = list.getBoundingClientRect();
    const { left, right } = current.getBoundingClientRect();
    if (left < strip.left) list.scrollLeft -= strip.left - left;
    else if (right > strip.right) list.scrollLeft += right - strip.right;
  }, [currentSelector, revealKey]);

  return ref;
}
