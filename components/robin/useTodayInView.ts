"use client";

import { useEffect, useRef } from "react";

/**
 * Keep today's column visible in a horizontally scrolling calendar grid.
 *
 * Seven columns do not fit a narrow window, so the grids scroll sideways rather
 * than crushing each day into an unreadable sliver. The cost is that today can
 * sit outside the visible slice — on a Sunday it is the last column, so a
 * narrow screen opens showing only days that have already passed.
 *
 * Scrolling is horizontal only and computed directly rather than through
 * `scrollIntoView`, which would also move the page vertically.
 *
 * Runs once per anchor rather than on every render: the panel re-renders on
 * each poll, and re-centring then would yank the grid back while the user is
 * reading another part of the week.
 */
export function useTodayInView(anchor: string, today: string) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const centredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!anchor || !today) return;
    if (centredFor.current === anchor) return;

    const scroller = scrollerRef.current;
    if (!scroller) return;
    // Nothing to do when the whole grid already fits.
    if (scroller.scrollWidth <= scroller.clientWidth) {
      centredFor.current = anchor;
      return;
    }

    const cell = scroller.querySelector<HTMLElement>(`[data-date="${today}"]`);
    if (!cell) {
      // Today is outside this window — a deliberate navigation, so leave the
      // scroll position alone.
      centredFor.current = anchor;
      return;
    }

    centredFor.current = anchor;
    const target = cell.offsetLeft - (scroller.clientWidth - cell.offsetWidth) / 2;
    scroller.scrollLeft = Math.max(0, Math.min(target, scroller.scrollWidth - scroller.clientWidth));
  }, [anchor, today]);

  return scrollerRef;
}
