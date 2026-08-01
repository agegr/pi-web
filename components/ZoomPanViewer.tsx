"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useI18n } from "@/hooks/useI18n";

const RELATIVE_ZOOM_STEP = 0.25;
const RELATIVE_ZOOM_MIN = 0.25;
const RELATIVE_ZOOM_MAX = 3;
const FIT_MARGIN = 0.9;
const DRAG_THRESHOLD_PX = 4;
/** Matches .mermaid-zoom-canvas padding(12)*2 + border(1)*2 */
const CANVAS_CHROME = 26;

export interface ZoomPanViewerProps {
  children: ReactNode;
  /** Logical content width in CSS pixels (e.g. SVG viewBox width). */
  contentWidth: number;
  /** Logical content height in CSS pixels (e.g. SVG viewBox height). */
  contentHeight: number;
  title?: string;
  ariaLabel?: string;
  onClose: () => void;
}

interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function fitScaleFor(viewportW: number, viewportH: number, contentW: number, contentH: number): number {
  if (contentW <= 0 || contentH <= 0 || viewportW <= 0 || viewportH <= 0) return 1;
  return Math.min((viewportW * FIT_MARGIN) / contentW, (viewportH * FIT_MARGIN) / contentH);
}

function centerTransform(scale: number, viewportW: number, viewportH: number, contentW: number, contentH: number): Transform {
  return {
    scale,
    tx: (viewportW - contentW * scale) / 2,
    ty: (viewportH - contentH * scale) / 2,
  };
}

/**
 * Fullscreen dialog with industry-standard zoom-to-cursor + drag-to-pan.
 * Scale is absolute; the toolbar shows relative zoom where 100% = fit-to-viewport.
 */
export function ZoomPanViewer({
  children,
  contentWidth,
  contentHeight,
  title,
  ariaLabel,
  onClose,
}: ZoomPanViewerProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // World box includes canvas padding + border so fit math matches painted size.
  const worldWidth = contentWidth + CANVAS_CHROME;
  const worldHeight = contentHeight + CANVAS_CHROME;

  const [fitScale, setFitScale] = useState(1);
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });
  const [dragging, setDragging] = useState(false);
  // Select mode: toolbar toggle that hands the mouse to the browser so SVG
  // text can be selected and copied. Default (off) = drag to pan.
  const [selectMode, setSelectMode] = useState(false);
  // Timestamp of the last finished pan drag; suppresses the click that the
  // browser fires after a drag so it cannot close the dialog.
  const dragEndedAtRef = useRef(0);

  const fitScaleRef = useRef(fitScale);
  const transformRef = useRef(transform);
  fitScaleRef.current = fitScale;
  transformRef.current = transform;

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originTx: number;
    originTy: number;
    moved: boolean;
    capturing: boolean;
  } | null>(null);

  const applyScaleAtPoint = useCallback(
    (nextScale: number, pivotX: number, pivotY: number) => {
      const { scale, tx, ty } = transformRef.current;
      const fs = fitScaleRef.current;
      const minS = fs * RELATIVE_ZOOM_MIN;
      const maxS = fs * RELATIVE_ZOOM_MAX;
      const s = clamp(nextScale, minS, maxS);
      if (s === scale) return;
      // Keep content point under the pivot fixed: c = (p - t) / s → t' = p - c * s'
      setTransform({
        scale: s,
        tx: pivotX - ((pivotX - tx) * s) / scale,
        ty: pivotY - ((pivotY - ty) * s) / scale,
      });
    },
    [],
  );

  const zoomByRelativeStep = useCallback(
    (deltaSteps: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const pivotX = rect.width / 2;
      const pivotY = rect.height / 2;
      const fs = fitScaleRef.current;
      const currentRelative = transformRef.current.scale / fs;
      const nextRelative = currentRelative + deltaSteps * RELATIVE_ZOOM_STEP;
      applyScaleAtPoint(nextRelative * fs, pivotX, pivotY);
    },
    [applyScaleAtPoint],
  );

  const fitToViewport = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { clientWidth: vw, clientHeight: vh } = viewport;
    const fs = fitScaleFor(vw, vh, worldWidth, worldHeight);
    setFitScale(fs);
    setTransform(centerTransform(fs, vw, vh, worldWidth, worldHeight));
  }, [worldWidth, worldHeight]);

  // Open dialog, lock body scroll, initial fit.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();

    // Measure after layout so clientWidth/Height are valid.
    const frame = requestAnimationFrame(() => {
      fitToViewport();
    });

    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, [fitToViewport]);

  // Recalculate fit baseline on viewport resize; preserve relative zoom & center.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;

    let ready = false;
    const ro = new ResizeObserver(() => {
      // Skip the first callback — initial fit is handled by the open effect.
      if (!ready) {
        ready = true;
        return;
      }
      const { clientWidth: vw, clientHeight: vh } = viewport;
      if (vw <= 0 || vh <= 0) return;

      const prevFs = fitScaleRef.current;
      const prev = transformRef.current;
      const relative = prev.scale / prevFs;
      const nextFs = fitScaleFor(vw, vh, worldWidth, worldHeight);
      const nextScale = clamp(relative * nextFs, nextFs * RELATIVE_ZOOM_MIN, nextFs * RELATIVE_ZOOM_MAX);

      // Keep the content point that was at viewport center still centered.
      const cx = vw / 2;
      const cy = vh / 2;
      const contentX = (cx - prev.tx) / prev.scale;
      const contentY = (cy - prev.ty) / prev.scale;

      setFitScale(nextFs);
      setTransform({
        scale: nextScale,
        tx: cx - contentX * nextScale,
        ty: cy - contentY * nextScale,
      });
    });

    ro.observe(viewport);
    return () => ro.disconnect();
  }, [worldWidth, worldHeight]);

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const pivotX = event.clientX - rect.left;
    const pivotY = event.clientY - rect.top;

    // Smooth multiplicative zoom from wheel delta (trackpad + mouse).
    const factor = Math.exp(-event.deltaY * 0.0015);
    applyScaleAtPoint(transformRef.current.scale * factor, pivotX, pivotY);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // In select mode, leave the gesture entirely to the browser so SVG text
    // can be selected and copied (no capture, no tracking).
    if (selectMode) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originTx: transformRef.current.tx,
      originTy: transformRef.current.ty,
      moved: false,
      capturing: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      drag.capturing = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    setTransform((prev) => ({
      ...prev,
      tx: drag.originTx + dx,
      ty: drag.originTy + dy,
    }));
  };

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.capturing && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const wasDrag = drag.moved;
    dragRef.current = null;
    setDragging(false);

    // The browser may still fire a click after a pan drag; swallow it so a
    // drag can never close the dialog.
    if (wasDrag) dragEndedAtRef.current = Date.now();
  };

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() - dragEndedAtRef.current < 500) return;
    // Click on empty viewport chrome closes, unless the user just selected
    // text (a selection means this was a text-drag, not a plain click).
    if (event.target !== event.currentTarget) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    onClose();
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // In select mode, leave double-click word selection to the browser.
    if (selectMode) return;
    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const pivotX = event.clientX - rect.left;
    const pivotY = event.clientY - rect.top;
    const fs = fitScaleRef.current;
    const relative = transformRef.current.scale / fs;
    // Toggle fit (100%) ↔ 200%.
    const targetRelative = Math.abs(relative - 1) < 0.05 ? 2 : 1;
    if (targetRelative === 1) {
      fitToViewport();
    } else {
      applyScaleAtPoint(targetRelative * fs, pivotX, pivotY);
    }
  };

  const relativePercent = Math.round((transform.scale / fitScale) * 100);
  const minScale = fitScale * RELATIVE_ZOOM_MIN;
  const maxScale = fitScale * RELATIVE_ZOOM_MAX;

  return (
    <dialog
      ref={dialogRef}
      className="mermaid-zoom-dialog"
      aria-label={ariaLabel}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="mermaid-zoom-layout">
        <div className="mermaid-zoom-toolbar">
          {title ? <span className="mermaid-zoom-title">{title}</span> : null}
          {!selectMode && (
            <span className="mermaid-zoom-hint">{t("i18n.zoomPanHint")}</span>
          )}
          <div className="mermaid-zoom-actions">
            <button
              type="button"
              className={[
                "mermaid-zoom-icon-button",
                "mermaid-zoom-select-button",
                selectMode ? "is-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setSelectMode((value) => !value)}
              title={t("i18n.selectText")}
              aria-label={t("i18n.selectText")}
              aria-pressed={selectMode}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 6V4h16v2M4 18v2h16v-2M12 4v16" />
              </svg>
            </button>
            <div className="mermaid-zoom-stepper">
              <button
                type="button"
                onClick={() => zoomByRelativeStep(-1)}
                disabled={transform.scale <= minScale + 1e-9}
                title={t("i18n.zoomOut")}
                aria-label={t("i18n.zoomOut")}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M5 12h14" />
                </svg>
              </button>
              <button
                type="button"
                className="mermaid-zoom-value"
                onClick={() => {
                  // Click percentage → restore fit (100%).
                  fitToViewport();
                }}
                title={t("i18n.resetZoom")}
                aria-label={`${relativePercent}%`}
              >
                {relativePercent}%
              </button>
              <button
                type="button"
                onClick={() => zoomByRelativeStep(1)}
                disabled={transform.scale >= maxScale - 1e-9}
                title={t("i18n.zoomIn")}
                aria-label={t("i18n.zoomIn")}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              className="mermaid-zoom-icon-button"
              onClick={fitToViewport}
              title={t("i18n.fitToViewport")}
              aria-label={t("i18n.fitToViewport")}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
              </svg>
            </button>
            <button
              type="button"
              className="mermaid-zoom-icon-button"
              onClick={onClose}
              title={t("i18n.close")}
              aria-label={t("i18n.close")}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>
        <div
          ref={viewportRef}
          className={[
            "mermaid-zoom-viewport",
            selectMode ? "is-selecting" : "",
            dragging ? "is-dragging" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
        >
          <div
            className="mermaid-zoom-world"
            style={{
              // Re-render at scale: fold the zoom factor into the layout size instead
              // of GPU-scaling a rasterized layer, so vector content stays crisp.
              // Canvas chrome (padding/border) stays fixed; only content scales.
              width: contentWidth * transform.scale + CANVAS_CHROME,
              height: contentHeight * transform.scale + CANVAS_CHROME,
              // left/top instead of transform: a composited transform layer can
              // break Chromium's native SVG text selection in select mode.
              left: transform.tx,
              top: transform.ty,
            }}
          >
            <div className="mermaid-zoom-canvas">{children}</div>
          </div>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Parse a Mermaid-rendered SVG string into logical size + cleaned markup.
 * Prefer viewBox; fall back to width/height attributes. Strip max-width forcing.
 */
export function prepareSvgForZoomPan(svg: string): {
  html: string;
  width: number;
  height: number;
} {
  if (typeof DOMParser === "undefined") {
    return { html: svg, width: 800, height: 600 };
  }

  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const el = doc.documentElement;
  if (!el || el.tagName.toLowerCase() !== "svg") {
    return { html: svg, width: 800, height: 600 };
  }

  let width = 0;
  let height = 0;

  const viewBox = el.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      width = parts[2];
      height = parts[3];
    }
  }

  if (!(width > 0 && height > 0)) {
    width = parseFloat(el.getAttribute("width") || "");
    height = parseFloat(el.getAttribute("height") || "");
  }

  if (!(width > 0 && height > 0)) {
    width = 800;
    height = 600;
  }

  // Resolution-independent: drop the fixed pixel size and stretch constraints.
  // The viewer re-renders the SVG at scale via CSS width/height, so the browser
  // vector-draws it at the final resolution (crisp at any zoom level).
  el.removeAttribute("width");
  el.removeAttribute("height");
  el.style.maxWidth = "none";
  // Ensure viewBox exists so height:auto keeps the aspect ratio.
  if (!el.getAttribute("viewBox")) {
    el.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  return { html: el.outerHTML, width, height };
}
