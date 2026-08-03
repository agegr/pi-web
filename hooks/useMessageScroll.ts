"use client";

import { useCallback, useRef } from "react";
import { scrollIntoView } from "@/lib/scroll-into-view";

/**
 * Maintains a map of session entryId → DOM element so that ChatWindow
 * can scroll a specific message into view on demand.
 *
 * Used by ChatWindow for the click-to-jump feature:
 *   const { register, scrollTo } = useMessageScroll();
 *   ...
 *   <div ref={(el) => register(entry.id, el)}>...</div>
 *   ...
 *   // exposed via imperative handle:
 *   scrollToEntry: (entryId) => scrollTo(entryId)
 *
 * The map lives in a ref (not state) because:
 *   - We never need to re-render when the map changes (scroll is an
 *     imperative action, not declarative).
 *   - Registering during render would be a side effect; using a ref +
 *     callback registration is the standard pattern for this.
 *
 * Contract (locked by hooks/useMessageScroll.test.tsx):
 *  - scrollTo on an unregistered id → wrapper called with undefined.
 *  - register(el) attaches the element; register(null) removes it.
 *  - re-registering the same id replaces the element (last wins).
 *  - register / scrollTo references are stable across re-renders so
 *    they can go in dep arrays without retriggering effects.
 */
export function useMessageScroll(): {
  register: (entryId: string, element: HTMLElement | null) => void;
  scrollTo: (entryId: string) => void;
  hasEntry: (entryId: string) => boolean;
} {
  const refs = useRef(new Map<string, HTMLElement>());

  const register = useCallback((entryId: string, element: HTMLElement | null) => {
    if (element) refs.current.set(entryId, element);
    else refs.current.delete(entryId);
  }, []);

  const scrollTo = useCallback((entryId: string) => {
    const exact = refs.current.get(entryId);
    if (exact) {
      scrollIntoView(exact);
      return;
    }
    // Fallback: scroll to the most recently registered element.
    let latest: HTMLElement | undefined;
    for (const el of refs.current.values()) latest = el;
    scrollIntoView(latest);
  }, []);

  // 供 jumpTo polling 检查目标是否已 register（虚拟滚动渲染后才挂上）
  const hasEntry = useCallback((entryId: string) => refs.current.has(entryId), []);

  return { register, scrollTo, hasEntry };
}
