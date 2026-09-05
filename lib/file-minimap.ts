/**
 * Pure geometry and color logic for the file viewer minimap
 * (components/FileMinimap.tsx). Kept DOM-free so it can be unit-tested with
 * plain node:test.
 */

/** One drawable run of text on a line, with an optional explicit color. */
export interface MinimapLineSegment {
  text: string;
  /** Inline-style color sampled from the highlighted DOM; null = inherit base. */
  color: string | null;
}

export type DiffLineKind = "added" | "removed" | "unchanged";

export interface MinimapGeometry {
  /** Effective minimap pixels per document line. */
  lineHeightPx: number;
  /** Total canvas height in CSS px (before parallax translation). */
  canvasHeight: number;
  /** True when lines are denser than 1px — draw color strips, not text. */
  stripMode: boolean;
}

export interface ViewportBoxGeometry {
  top: number;
  height: number;
}

export const MINIMAP_DEFAULT_WIDTH = 96;
export const MINIMAP_MIN_WIDTH = 64;
export const MINIMAP_MAX_WIDTH = 110;
/** Minimap width as a fraction of the scroll container width. */
export const MINIMAP_WIDTH_RATIO = 0.12;
export const MINIMAP_LINE_HEIGHT = 2;
/** Canvas height cap as a multiple of the container height. */
export const MINIMAP_MAX_CANVAS_FACTOR = 8;
export const MINIMAP_VIEWPORT_MIN_HEIGHT = 15;
/** Do not sample DOM token colors above this many rendered lines. */
export const MINIMAP_MAX_SAMPLED_LINES = 4000;
/** Per-line character cap for drawing (canvas clips anyway). */
export const MINIMAP_MAX_LINE_CHARS = 300;
/** Show the minimap only when the scrollable overflow exceeds this many px. */
export const MINIMAP_MIN_OVERFLOW = 20;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Minimap width adapts to the container, clamped to a usable range. */
export function computeMinimapWidth(containerWidth: number): number {
  const target = Math.round(containerWidth * MINIMAP_WIDTH_RATIO);
  return Math.max(MINIMAP_MIN_WIDTH, Math.min(MINIMAP_MAX_WIDTH, target || MINIMAP_DEFAULT_WIDTH));
}

/**
 * Canvas height follows the document length at MINIMAP_LINE_HEIGHT px per
 * line, capped at containerHeight × MINIMAP_MAX_CANVAS_FACTOR. Past the cap
 * the per-line height shrinks; below 1px per line the renderer should switch
 * to strip mode because text glyphs become meaningless.
 */
export function computeMinimapGeometry(lineCount: number, containerHeight: number): MinimapGeometry {
  const lines = Math.max(0, Math.floor(lineCount));
  const viewport = Math.max(1, containerHeight);
  const maxCanvas = viewport * MINIMAP_MAX_CANVAS_FACTOR;
  const natural = lines * MINIMAP_LINE_HEIGHT;

  if (natural <= maxCanvas) {
    return { lineHeightPx: MINIMAP_LINE_HEIGHT, canvasHeight: Math.max(0, natural), stripMode: false };
  }

  const lineHeightPx = maxCanvas / lines;
  return { lineHeightPx, canvasHeight: maxCanvas, stripMode: lineHeightPx < 1 };
}

/** The minimap is only useful once the content actually overflows. */
export function hasMinimapOverflow(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight > MINIMAP_MIN_OVERFLOW;
}

/** scrollTop → fraction of the total scrollable range, clamped to [0, 1]. */
export function fractionForScrollTop(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const range = scrollHeight - clientHeight;
  if (range <= 0) return 0;
  return clamp01(scrollTop / range);
}

/** fraction → scrollTop. Inverse of fractionForScrollTop. */
export function scrollTopForFraction(fraction: number, scrollHeight: number, clientHeight: number): number {
  const range = Math.max(0, scrollHeight - clientHeight);
  return clamp01(fraction) * range;
}

/**
 * Viewport box position inside the minimap track. The box height is the
 * visible fraction of the document (min VIEWPORT_MIN_HEIGHT), and its top
 * tracks the scroll fraction so both ends glue to the track ends.
 */
export function viewportBoxGeometry(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  containerHeight: number,
): ViewportBoxGeometry {
  const track = Math.max(1, containerHeight);
  if (scrollHeight <= 0) return { top: 0, height: track };
  const height = Math.max(
    MINIMAP_VIEWPORT_MIN_HEIGHT,
    Math.min(track, (clientHeight / scrollHeight) * track),
  );
  const fraction = fractionForScrollTop(scrollTop, scrollHeight, clientHeight);
  return { top: fraction * (track - height), height };
}

/**
 * Fraction from a viewport-box top offset (dragging the box). Both box ends
 * glue to the track ends, matching viewportBoxGeometry.
 */
export function fractionForBoxTop(
  boxTop: number,
  containerHeight: number,
  boxHeight: number,
): number {
  const usable = Math.max(1, containerHeight) - boxHeight;
  if (usable <= 0) return 0;
  return clamp01(boxTop / usable);
}

/**
 * Fraction whose viewport box is centered on a pointer position (used for
 * click-on-track jumps and drags that started on the track).
 */
export function fractionForPointer(
  pointerY: number,
  containerHeight: number,
  boxHeight: number,
): number {
  return fractionForBoxTop(pointerY - boxHeight / 2, containerHeight, boxHeight);
}

/**
 * One segment of the rendered diff view: either a collapsed unchanged region
 * (a single "... N unchanged lines ..." row) or a block of visible lines.
 * Structurally compatible with DiffView's segment type.
 */
export type MinimapDiffSegment =
  | { hidden: true }
  | { hidden: false; lines: { type: DiffLineKind; text: string }[] };

/**
 * Collapse-aware mapping from the diff view's rendered rows to minimap rows:
 * one row per visible diff line plus one row per collapsed unchanged region.
 * Without this, painted change strips scale to the full (uncollapsed) diff
 * and no longer line up with real scroll positions.
 */
export function diffSegmentsToMinimapRows(
  segments: MinimapDiffSegment[],
): { lines: string[]; kinds: DiffLineKind[] } {
  const lines: string[] = [];
  const kinds: DiffLineKind[] = [];
  for (const segment of segments) {
    if (segment.hidden) {
      lines.push("…");
      kinds.push("unchanged");
      continue;
    }
    for (const line of segment.lines) {
      lines.push(line.text);
      kinds.push(line.type);
    }
  }
  return { lines, kinds };
}

/** Canvas parallax offset: how far the canvas translates up for a fraction. */
export function canvasOffsetForFraction(
  fraction: number,
  canvasHeight: number,
  containerHeight: number,
): number {
  const overflow = Math.max(0, canvasHeight - containerHeight);
  const offset = clamp01(fraction) * overflow;
  // Normalize -0 so callers never write `translateY(-0px)` and strict-equal
  // comparisons against 0 behave.
  return offset === 0 ? 0 : -offset;
}

/** Colors for diff-mode lines, matching DiffView's added/removed palette. */
export function diffLineKindToColor(kind: DiffLineKind, isDark: boolean): string {
  if (kind === "added") return "rgba(74, 222, 128, 0.9)";
  if (kind === "removed") return "rgba(248, 113, 113, 0.9)";
  return isDark ? "rgba(212, 212, 212, 0.55)" : "rgba(80, 80, 80, 0.5)";
}

/** Fallback line color when no sampled token color exists. */
export function baseLineColor(isDark: boolean): string {
  return isDark ? "rgba(212, 212, 212, 0.75)" : "rgba(60, 60, 60, 0.7)";
}
