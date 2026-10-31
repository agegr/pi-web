"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  buildLineOffsets,
  lineAtOffset,
  scrollTopForLine,
  visibleLineRange,
  SOURCE_LINE_HEIGHT,
  SOURCE_OVERSCAN_LINES,
  type LineWindow,
} from "@/lib/source-window";

interface UseVirtualLinesOptions {
  totalLines: number;
  /** The viewer's own `overflow: auto` box. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Only while the source lines are what is on screen (not a diff or a preview). */
  enabled?: boolean;
  /** Resets measured row heights when the file's content is replaced. */
  resetKey?: string;
  estimate?: number;
  overscan?: number;
}

export interface VirtualLines {
  range: LineWindow;
  /** `offsets[i]` is the top of line `i`, `offsets[totalLines]` the full height. */
  offsets: Float64Array;
  totalHeight: number;
  scrollToLine: (line: number, align?: "start" | "center") => void;
}

/**
 * Windowing for the file viewer's source lines: it keeps a map of measured row
 * heights (wrapped lines are not one row tall), derives line offsets from it and
 * reports the slice around the viewport. Unknown rows use the average measured
 * height, so a scrollbar is honest enough before a row has ever rendered.
 *
 * Scrolling to a line far outside the measured region lands on an estimate;
 * once those rows render, the anchor effect moves the scroll position by the
 * height the space above it actually gained or lost, so the target line stays
 * where it was put instead of sliding away.
 */
export function useVirtualLines({
  totalLines,
  scrollRef,
  enabled = true,
  resetKey = "",
  estimate = SOURCE_LINE_HEIGHT,
  overscan = SOURCE_OVERSCAN_LINES,
}: UseVirtualLinesOptions): VirtualLines {
  const heightsRef = useRef(new Map<number, number>());
  const [measured, setMeasured] = useState(0);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
  // The scroller mounts after the viewer's loading state, so an effect that
  // looked for it once would stay unattached. Bump until the ref is filled.
  const [elementVersion, setElementVersion] = useState(0);
  const anchorRef = useRef<{ index: number; offset: number; scrollTop: number } | null>(null);
  const offsetsRef = useRef<Float64Array>(new Float64Array(1));
  const resetRef = useRef(resetKey);

  // `measured` is not read here, but every measurement batch must rebuild the
  // offsets, and clearing the map would not otherwise reach this memo.
  const offsets = useMemo(() => {
    const heights = heightsRef.current;
    let sum = 0;
    let count = 0;
    heights.forEach((height) => {
      if (!Number.isFinite(height) || height <= 0) return;
      sum += height;
      count += 1;
    });
    const fallback = count > 0 ? sum / count : estimate;
    return buildLineOffsets(totalLines, (index) => heights.get(index), fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalLines, measured, estimate]);
  offsetsRef.current = offsets;

  useEffect(() => {
    if (resetRef.current === resetKey) return;
    resetRef.current = resetKey;
    heightsRef.current.clear();
    setMeasured((value) => value + 1);
  }, [resetKey]);

  useEffect(() => {
    if (!enabled || scrollRef.current) return;
    const frame = requestAnimationFrame(() => setElementVersion((value) => value + 1));
    return () => cancelAnimationFrame(frame);
  }, [elementVersion, enabled, scrollRef]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !enabled) return;
    let frame = 0;
    const publish = () => {
      frame = 0;
      const scrollTop = element.scrollTop;
      const height = element.clientHeight;
      setViewport((current) => (
        current.scrollTop === scrollTop && current.height === height ? current : { scrollTop, height }
      ));
      const offsetsNow = offsetsRef.current;
      const index = lineAtOffset(offsetsNow, scrollTop);
      anchorRef.current = { index, offset: offsetsNow[index], scrollTop };
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(publish);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    publish();
    return () => {
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [elementVersion, enabled, scrollRef]);

  // Rows report their own height; a height that differs from the stored one
  // recomputes the offsets once per commit, not once per row.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!enabled) return;
    const element = scrollRef.current;
    if (!element) return;
    const heights = heightsRef.current;
    let changed = false;
    element.querySelectorAll<HTMLElement>("[data-line-number]").forEach((row) => {
      const index = Number(row.dataset.lineNumber) - 1;
      if (!Number.isInteger(index) || index < 0) return;
      const height = row.getBoundingClientRect().height;
      if (!Number.isFinite(height) || height <= 0) return;
      const known = heights.get(index);
      // A web font that replaces the fallback moves every row by a fraction of
      // a pixel. That is small per row and thousands of pixels over a long file,
      // so any measurable change counts.
      if (known === undefined || Math.abs(known - height) > 0.01) {
        heights.set(index, height);
        changed = true;
      }
    });
    if (changed) setMeasured((value) => value + 1);
  });

  useLayoutEffect(() => {
    if (!enabled) return;
    const element = scrollRef.current;
    const anchor = anchorRef.current;
    if (!element || !anchor) return;
    // The user scrolled after the anchor was captured: leave their position.
    if (Math.abs(element.scrollTop - anchor.scrollTop) > 1) return;
    const target = offsets[Math.min(anchor.index, totalLines)];
    const delta = target - anchor.offset;
    if (Math.abs(delta) <= 0.5) return;
    element.scrollTop = Math.max(0, anchor.scrollTop + delta);
    anchorRef.current = { index: anchor.index, offset: target, scrollTop: element.scrollTop };
  }, [offsets, enabled, scrollRef, totalLines]);

  const range = useMemo(() => (
    enabled
      ? visibleLineRange(offsets, viewport.scrollTop, viewport.height, overscan)
      : { start: 0, end: totalLines }
  ), [enabled, offsets, overscan, totalLines, viewport]);

  const scrollToLine = useCallback((line: number, align: "start" | "center" = "center") => {
    const element = scrollRef.current;
    if (!element) return;
    const offsetsNow = offsetsRef.current;
    const total = offsetsNow.length - 1;
    if (total <= 0) return;
    const index = Math.max(0, Math.min(Math.floor(line), total - 1));
    const top = scrollTopForLine(offsetsNow, index, element.clientHeight, align);
    element.scrollTop = top;
    anchorRef.current = { index, offset: offsetsNow[index], scrollTop: element.scrollTop };
    setViewport({ scrollTop: element.scrollTop, height: element.clientHeight });
  }, [scrollRef]);

  return { range, offsets, totalHeight: offsets[totalLines] ?? 0, scrollToLine };
}
