"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  baseLineColor,
  beginMinimapDrag,
  canvasOffsetForFraction,
  computeMinimapGeometry,
  computeMinimapWidth,
  diffLineKindToColor,
  fractionForBoxTop,
  fractionForPointer,
  fractionForScrollTop,
  hasMinimapOverflow,
  MINIMAP_DEFAULT_WIDTH,
  MINIMAP_MAX_LINE_CHARS,
  MINIMAP_MAX_SAMPLED_LINES,
  MINIMAP_VIEWPORT_MIN_HEIGHT,
  scrollTopForFraction,
  shouldEngageMinimapDrag,
  viewportBoxGeometry,
  type DiffLineKind,
  type MinimapDragState,
  type MinimapLineSegment,
} from "@/lib/file-minimap";

const SAMPLE_DEBOUNCE_MS = 150;
// Resize storms (sidebar open/close animation) must not repaint the canvas
// per frame; only the cheap transform sync runs until the resize settles.
const RESIZE_DEBOUNCE_MS = 150;

interface Props {
  /** The scrollable file-content element the minimap mirrors and drives. */
  scrollContainer: RefObject<HTMLDivElement | null>;
  /** Rendered document rows (source text lines, or DiffView's collapsed diff rows). */
  lines: string[];
  /** Per-line diff classification; present in diff mode only. */
  lineKinds?: DiffLineKind[];
  /**
   * Word-wrap state of the viewer. The minimap does not render wraps, but a
   * wrap toggle reflows the content without necessarily firing a scroll or
   * resize event, so it is a signal to re-sync visibility and the box.
   */
  wrapLines: boolean;
  /** Source mode with full syntax highlighting: sample token colors from the DOM. */
  sampleFromDom: boolean;
  isDark: boolean;
}

function collectSegments(node: ChildNode, inheritedColor: string | null, out: MinimapLineSegment[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (text) out.push({ text, color: inheritedColor });
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  const color = node.style.color || inheritedColor;
  for (const child of node.childNodes) collectSegments(child, color, out);
}

/**
 * Reads per-token colors out of the rendered `.file-source-line` DOM. The
 * syntax highlighter writes token colors as inline styles, so this is a cheap
 * `style.color` read — no getComputedStyle per token. Returns null when the
 * file is too large to sample; the caller then falls back to a single base
 * color per line.
 */
function sampleLineColors(root: HTMLElement): Map<number, MinimapLineSegment[]> | null {
  const lineElements = root.querySelectorAll<HTMLElement>(".file-source-line[data-line-number]");
  if (lineElements.length === 0 || lineElements.length > MINIMAP_MAX_SAMPLED_LINES) return null;

  const segmentsByLine = new Map<number, MinimapLineSegment[]>();
  for (const lineElement of lineElements) {
    const lineNumber = Number(lineElement.dataset.lineNumber);
    if (!Number.isInteger(lineNumber)) continue;
    const content = lineElement.querySelector(".file-source-line-content") ?? lineElement;
    const segments: MinimapLineSegment[] = [];
    for (const child of content.childNodes) collectSegments(child, null, segments);
    segmentsByLine.set(lineNumber, segments);
  }
  return segmentsByLine;
}

export function FileMinimap({ scrollContainer, lines, lineKinds, wrapLines, sampleFromDom, isDark }: Props) {
  const isMobile = useIsMobile();
  const [visible, setVisible] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasShiftRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Mutable mirrors so the stable callbacks below always see fresh values and
  // scrolling never has to round-trip through React state.
  const linesRef = useRef(lines);
  const lineKindsRef = useRef(lineKinds);
  const sampleFromDomRef = useRef(sampleFromDom);
  const isDarkRef = useRef(isDark);
  const visibleRef = useRef(false);
  const segmentsRef = useRef<Map<number, MinimapLineSegment[]> | null>(null);
  const canvasHeightRef = useRef(0);
  const dragRef = useRef<MinimapDragState | null>(null);
  const rafRef = useRef(0);
  const sampleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  linesRef.current = lines;
  lineKindsRef.current = lineKinds;
  sampleFromDomRef.current = sampleFromDom;
  isDarkRef.current = isDark;

  const syncFromScroll = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const overflow = hasMinimapOverflow(scrollEl.scrollHeight, scrollEl.clientHeight);
    visibleRef.current = overflow;
    setVisible(overflow);
    if (!overflow) return;

    // The track is the minimap strip itself: as a stretched flex sibling it
    // spans the scroll container's full outer height, including the band
    // beside a horizontal scrollbar that scrollEl.clientHeight excludes.
    // Pointer handlers measure this same element, so both stay in agreement.
    const containerHeight = containerRef.current?.clientHeight || scrollEl.clientHeight;
    // Computed fresh instead of reading canvasHeightRef: the ref is still 0 on
    // the first sync before draw() runs, which would briefly confine the box
    // to a 1px track.
    const canvasHeight = computeMinimapGeometry(linesRef.current.length, containerHeight).canvasHeight;
    const fraction = fractionForScrollTop(scrollEl.scrollTop, scrollEl.scrollHeight, scrollEl.clientHeight);

    const box = boxRef.current;
    if (box) {
      const boxGeometry = viewportBoxGeometry(
        scrollEl.scrollTop,
        scrollEl.scrollHeight,
        scrollEl.clientHeight,
        containerHeight,
        canvasHeight,
      );
      box.style.height = `${boxGeometry.height}px`;
      box.style.transform = `translateY(${boxGeometry.top}px)`;
    }

    const shift = canvasShiftRef.current;
    if (shift) {
      shift.style.transform = `translateY(${canvasOffsetForFraction(fraction, canvasHeightRef.current, containerHeight)}px)`;
    }
  }, [scrollContainer]);

  const scheduleSync = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      syncFromScroll();
    });
  }, [syncFromScroll]);

  const draw = useCallback(() => {
    const scrollEl = scrollContainer.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!scrollEl || !canvas || !container || !visibleRef.current) return;

    const containerHeight = container.clientHeight || scrollEl.clientHeight;
    const width = computeMinimapWidth();
    container.style.width = `${width}px`;

    const linesValue = linesRef.current;
    const geometry = computeMinimapGeometry(linesValue.length, containerHeight);
    canvasHeightRef.current = geometry.canvasHeight;

    // 1x resolution is plenty for a thumbnail and keeps the backing store
    // roughly 4x smaller than a retina-sized one.
    const dpr = 1;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(geometry.canvasHeight * dpr));
    // Reassigning canvas.width/height reallocates and clears the backing
    // store even when the value is unchanged, so only touch it on a real
    // size change; otherwise clear explicitly.
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    canvas.style.height = `${geometry.canvasHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, geometry.canvasHeight);

    const dark = isDarkRef.current;
    const baseColor = baseLineColor(dark);
    const kinds = lineKindsRef.current;
    const segmentsByLine = segmentsRef.current;

    if (geometry.stripMode) {
      // Sub-pixel lines: text glyphs are meaningless, so each line becomes a
      // color strip whose width is proportional to the line length.
      const stripHeight = Math.max(1, geometry.lineHeightPx);
      for (let i = 0; i < linesValue.length; i++) {
        const kind = kinds?.[i];
        const segments = segmentsByLine?.get(i + 1);
        let color = kind ? diffLineKindToColor(kind, dark) : null;
        color ??= segments?.find((segment) => segment.color)?.color ?? null;
        ctx.fillStyle = color ?? baseColor;
        ctx.globalAlpha = kind === "unchanged" ? 0.5 : 0.9;
        const stripWidth = Math.max(
          2,
          (Math.min(linesValue[i].length, MINIMAP_MAX_LINE_CHARS) / MINIMAP_MAX_LINE_CHARS) * width,
        );
        ctx.fillRect(0, i * geometry.lineHeightPx, stripWidth, stripHeight);
      }
      ctx.globalAlpha = 1;
      return;
    }

    const fontPx = Math.max(2, Math.min(6, geometry.lineHeightPx * 1.6));
    // Sample the mono font from an actual code element — the scroll container
    // itself only carries the inherited UI font, whose proportional glyphs
    // would misalign with the fixed per-character advance used below.
    const fontSource = scrollEl.querySelector<HTMLElement>(".file-source-line-content, .file-diff-view") ?? scrollEl;
    const fontFamily = getComputedStyle(fontSource).fontFamily || "monospace";
    ctx.font = `${fontPx}px ${fontFamily}`;
    ctx.textBaseline = "alphabetic";
    const charWidth = ctx.measureText("M").width || fontPx * 0.6;
    ctx.globalAlpha = 0.85;

    for (let i = 0; i < linesValue.length; i++) {
      const baseline = i * geometry.lineHeightPx + fontPx * 0.8;
      const kind = kinds?.[i];
      if (kind) {
        ctx.fillStyle = diffLineKindToColor(kind, dark);
        ctx.globalAlpha = kind === "unchanged" ? 0.5 : 0.9;
        ctx.fillText(linesValue[i].slice(0, MINIMAP_MAX_LINE_CHARS), 0, baseline);
        ctx.globalAlpha = 0.85;
        continue;
      }
      const segments = segmentsByLine?.get(i + 1);
      if (!segments || segments.length === 0) {
        ctx.fillStyle = baseColor;
        ctx.fillText(linesValue[i].slice(0, MINIMAP_MAX_LINE_CHARS), 0, baseline);
        continue;
      }
      let x = 0;
      let remaining = MINIMAP_MAX_LINE_CHARS;
      for (const segment of segments) {
        if (remaining <= 0 || x >= width) break;
        const text = segment.text.slice(0, remaining);
        if (text.trim()) {
          ctx.fillStyle = segment.color ?? baseColor;
          ctx.fillText(text, x, baseline);
        }
        x += text.length * charWidth;
        remaining -= text.length;
      }
    }
    ctx.globalAlpha = 1;
  }, [scrollContainer]);

  const sampleThenRedraw = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    segmentsRef.current = sampleFromDomRef.current ? sampleLineColors(scrollEl) : null;
    draw();
    syncFromScroll();
  }, [draw, scrollContainer, syncFromScroll]);

  const scheduleSample = useCallback(() => {
    if (sampleTimerRef.current) clearTimeout(sampleTimerRef.current);
    sampleTimerRef.current = setTimeout(() => {
      sampleTimerRef.current = null;
      sampleThenRedraw();
    }, SAMPLE_DEBOUNCE_MS);
  }, [sampleThenRedraw]);

  // Debounced repaint for resize storms: while a sidebar open/close animation
  // resizes the scroll container every frame, only the rAF-throttled transform
  // sync runs; the canvas bitmap is repainted once after the resize settles.
  const scheduleResizeDraw = useCallback(() => {
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = setTimeout(() => {
      resizeTimerRef.current = null;
      draw();
      syncFromScroll();
    }, RESIZE_DEBOUNCE_MS);
  }, [draw, syncFromScroll]);

  // Content / mode / theme changes: resample (DOM token colors follow the
  // theme) and redraw, debounced so live-watch bursts coalesce.
  useEffect(() => {
    scheduleSample();
    return () => {
      if (sampleTimerRef.current) {
        clearTimeout(sampleTimerRef.current);
        sampleTimerRef.current = null;
      }
    };
  }, [lines, lineKinds, sampleFromDom, isDark, scheduleSample]);

  // Scroll + resize tracking. Registered regardless of visibility so the
  // minimap appears as soon as the content starts overflowing.
  useEffect(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    scrollEl.addEventListener("scroll", scheduleSync, { passive: true });
    const observer = new ResizeObserver(() => {
      scheduleSync();
      scheduleResizeDraw();
    });
    observer.observe(scrollEl);
    syncFromScroll();
    return () => {
      scrollEl.removeEventListener("scroll", scheduleSync);
      observer.disconnect();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
  }, [scheduleResizeDraw, scheduleSync, scrollContainer, syncFromScroll]);

  // Becoming visible mounts a fresh canvas — repaint it and re-apply the
  // viewport box / parallax positions.
  useEffect(() => {
    if (!visible) return;
    draw();
    syncFromScroll();
  }, [visible, draw, syncFromScroll]);

  // Wrap toggling reflows the content; when scrollTop survives unchanged no
  // scroll event fires and the ResizeObserver (border-box only) stays quiet,
  // so re-sync explicitly or overflow visibility and the box go stale.
  useEffect(() => {
    scheduleSync();
  }, [wrapLines, scheduleSync]);

  const scrollToFraction = useCallback((fraction: number, behavior: ScrollBehavior) => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    scrollEl.scrollTo({
      top: scrollTopForFraction(fraction, scrollEl.scrollHeight, scrollEl.clientHeight),
      behavior,
    });
  }, [scrollContainer]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const scrollEl = scrollContainer.current;
    const container = containerRef.current;
    if (!scrollEl || !container || !visibleRef.current) return;
    event.preventDefault();
    container.setPointerCapture(event.pointerId);

    const rect = container.getBoundingClientRect();
    const containerHeight = rect.height;
    const canvasHeight = computeMinimapGeometry(linesRef.current.length, containerHeight).canvasHeight;
    const pointerY = event.clientY - rect.top;
    const boxGeometry = viewportBoxGeometry(
      scrollEl.scrollTop,
      scrollEl.scrollHeight,
      scrollEl.clientHeight,
      containerHeight,
      canvasHeight,
    );
    const onBox = pointerY >= boxGeometry.top && pointerY <= boxGeometry.top + boxGeometry.height;
    dragRef.current = beginMinimapDrag(onBox, pointerY, boxGeometry);
    if (!onBox) {
      scrollToFraction(fractionForPointer(pointerY, containerHeight, boxGeometry.height, canvasHeight), "smooth");
    }
  }, [scrollContainer, scrollToFraction]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const scrollEl = scrollContainer.current;
    const container = containerRef.current;
    if (!drag || !scrollEl || !container) return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const pointerY = event.clientY - rect.top;
    // Below the threshold this is a track click, not a drag: an instant
    // scroll here would cancel the smooth scroll started on pointerdown.
    if (!shouldEngageMinimapDrag(drag, pointerY)) return;
    drag.engaged = true;
    const boxHeight = boxRef.current?.offsetHeight || MINIMAP_VIEWPORT_MIN_HEIGHT;
    const canvasHeight = computeMinimapGeometry(linesRef.current.length, rect.height).canvasHeight;
    scrollToFraction(fractionForBoxTop(pointerY - drag.grabOffset, rect.height, boxHeight, canvasHeight), "auto");
  }, [scrollContainer, scrollToFraction]);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (containerRef.current?.hasPointerCapture(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }
  }, []);

  if (isMobile || !visible) return null;

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        // Flex sibling of the scroll container (not an overlay): the strip
        // takes real layout width so text never flows underneath it.
        position: "relative",
        flexShrink: 0,
        alignSelf: "stretch",
        width: MINIMAP_DEFAULT_WIDTH,
        cursor: "pointer",
        userSelect: "none",
        touchAction: "none",
        overflow: "hidden",
        borderLeft: "1px solid var(--border)",
        background: "var(--bg)",
      }}
    >
      <div ref={canvasShiftRef} style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
        <canvas ref={canvasRef} style={{ display: "block", width: "100%" }} />
      </div>
      <div
        ref={boxRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: MINIMAP_VIEWPORT_MIN_HEIGHT,
          background: "rgba(128, 128, 128, 0.22)",
          border: "1px solid rgba(128, 128, 128, 0.45)",
          boxSizing: "border-box",
          cursor: "grab",
        }}
      />
    </div>
  );
}
