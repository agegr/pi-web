/**
 * One free window: a tab dragged out of the workbench floating over the
 * conversation area at viewport coordinates (rendered inside the panel host,
 * so desktop-shell transforms can never hijack its fixed containing block).
 *
 * The header drags the window with the panel-resize pattern — pointer
 * capture + per-frame direct DOM writes + a store commit on release — and
 * doubling as the DOCK-BACK gesture: while the pointer is over a workbench
 * pane ([data-dsh-pane], either panel), that pane highlights live and
 * releasing docks the tab into it (center merge); releasing anywhere else
 * just moves the window. The SE corner resizes, any press raises (the
 * floats array's order is the stacking order), the header right-click menu
 * and the X button dock / close. The tab content reuses the regular tab
 * renderer, so every tab type (terminal, editor, plugin tabs) floats
 * unchanged.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconCloseFill14, Menu } from "./ui-primitives"
import type { FloatWindow, SidebarTab } from './state'
import { FLOAT_MIN_H, FLOAT_MIN_W } from './state'
import { t } from './locales'
import css from './sidebar.module.css'

/** A drag's mutable bookkeeping (start geometry + the last applied values). */
interface DragState {
  /** Which handle owns the drag (the abort path reads it from this ref —
   *  the React `dragging` state lags a render behind pointerdown). */
  mode: 'move' | 'resize'
  pointerX: number
  pointerY: number
  startX: number
  startY: number
  startW: number
  startH: number
  /** Last geometry actually written to the DOM (the cancel-path fallback). */
  applied: { x: number; y: number; w: number; h: number }
  /** Settled after the final pointer event (the up position wins over the
   * rAF-pending value — a fast flick coalesces its tail into the up event). */
  committed: boolean
}

/** The pane under a viewport point, if any (rect hit-test; the dragged
 *  window itself is not a pane, so it cannot shadow the targets). */
function paneAt(x: number, y: number): HTMLElement | null {
  for (const pane of document.querySelectorAll<HTMLElement>('[data-dsh-pane]')) {
    const rect = pane.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return pane
  }
  return null
}

/** Pointer-capture helpers tolerant of environments without the API (jsdom
 *  lacks setPointerCapture — component tests dispatch plain MouseEvents, so
 *  the optional calls keep them driving the drag; real browsers always have
 *  it and a missing pointerId can never occur there). */
const capturePointer = (element: HTMLElement, pointerId: number): void => {
  element.setPointerCapture?.(pointerId)
}

const releasePointer = (element: HTMLElement, pointerId: number): void => {
  element.releasePointerCapture?.(pointerId)
}

/** Whether the element holds the pointer (assumed true without the API). */
const holdsPointer = (element: HTMLElement, pointerId: number): boolean => {
  return element.hasPointerCapture?.(pointerId) !== false
}

export function FreeWindow(props: {
  float: FloatWindow
  renderTab: (tab: SidebarTab, active: boolean, paneId: string) => ReactNode
  getTabIcon?: (tab: SidebarTab) => ReactNode
  onRaise: () => void
  onMove: (x: number, y: number) => void
  onResize: (w: number, h: number) => void
  /** Dock the tab back; the pane id, or null for the active pane. */
  onDock: (paneId: string | null) => void
  onClose: () => void
}) {
  const { float, renderTab, getTabIcon, onRaise, onMove, onResize, onDock, onClose } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  // The pane currently highlighted as the dock target (a direct DOM write:
  // per-frame React state would re-render every mounted tab at drag cadence).
  const dockTargetRef = useRef<HTMLElement | null>(null)
  // rAF coalescing: pointermove outruns the display, one write per frame.
  const frameRef = useRef<number | null>(null)
  const pendingRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const [dragging, setDragging] = useState<'move' | 'resize' | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    dockTargetRef.current?.removeAttribute('data-dsh-float-dock-over')
  }, [])

  /** Apply the pending geometry to the DOM (one rAF per frame at most). */
  const scheduleApply = (geo: { x: number; y: number; w: number; h: number }): void => {
    pendingRef.current = geo
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const pending = pendingRef.current
      const drag = dragRef.current
      const root = rootRef.current
      if (pending === null || drag === null || root === null) return
      drag.applied = pending
      root.style.left = `${pending.x}px`
      root.style.top = `${pending.y}px`
      root.style.width = `${pending.w}px`
      root.style.height = `${pending.h}px`
    })
  }

  /** Flush the pending frame synchronously (the release path's last write). */
  const flushNow = (): void => {
    const pending = pendingRef.current
    const drag = dragRef.current
    const root = rootRef.current
    if (pending === null || drag === null || root === null) return
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    pendingRef.current = null
    drag.applied = pending
    root.style.left = `${pending.x}px`
    root.style.top = `${pending.y}px`
    root.style.width = `${pending.w}px`
    root.style.height = `${pending.h}px`
  }

  const clearDockHighlight = (): void => {
    dockTargetRef.current?.removeAttribute('data-dsh-float-dock-over')
    dockTargetRef.current = null
  }

  /** Release a drag: `pane` (when set) docks instead of moving. */
  const finishDrag = (mode: 'move' | 'resize', geo: { x: number; y: number; w: number; h: number }, pane: HTMLElement | null): void => {
    const drag = dragRef.current
    if (drag === null || drag.committed) return
    drag.committed = true
    dragRef.current = null
    setDragging(null)
    const target = pane ?? dockTargetRef.current
    clearDockHighlight()
    if (mode === 'move' && target !== null) {
      onDock(target.getAttribute('data-dsh-pane'))
    } else if (mode === 'move') {
      onMove(geo.x, geo.y)
    } else {
      onResize(geo.w, geo.h)
    }
  }

  /** Cancel-path settle (pointercancel / lostpointercapture): the last
   * APPLIED geometry is the user-visible truth — commit it, never roll back
   * (the panel drags' issue-#247 semantics). The mode comes from the ref —
   * the React `dragging` state can still be null when the cancel lands
   * before the pointerdown re-render commits. */
  const abortDrag = (): void => {
    const drag = dragRef.current
    if (drag === null || drag.committed) return
    flushNow()
    finishDrag(drag.mode, drag.applied, null)
  }

  const clampMove = (x: number, y: number): { x: number; y: number; w: number; h: number } => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    return {
      x: Math.min(Math.max(x, 0), Math.max(0, vw - float.w)),
      y: Math.min(Math.max(y, 0), Math.max(0, vh - float.h)),
      w: float.w,
      h: float.h,
    }
  }

  const clampResize = (w: number, h: number): { x: number; y: number; w: number; h: number } => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    return {
      x: float.x,
      y: float.y,
      w: Math.round(Math.min(Math.max(w, FLOAT_MIN_W), Math.max(FLOAT_MIN_W, vw - float.x))),
      h: Math.round(Math.min(Math.max(h, FLOAT_MIN_H), Math.max(FLOAT_MIN_H, vh - float.y))),
    }
  }

  return (
    <div
      ref={rootRef}
      className={clsx(css.floatWindow, dragging !== null && css.floatWindowDragging)}
      data-dsh-float-window
      data-dsh-float-id={float.id}
      style={{ left: float.x, top: float.y, width: float.w, height: float.h }}
      onPointerDown={() => { onRaise() }}
    >
      <div
        className={css.floatHeader}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          // Portaled overlays (the header Menu) live at document.body in the
          // DOM, yet their events still bubble through the React tree into
          // this handler — without the containment guard a menu-row click
          // would start a drag, preventDefault (killing the row's compat
          // mousedown) and capture the pointer (retargeting the release at
          // the header, so the row's click never fires). Buttons inside the
          // header (the close X) need the same exclusion: a capture here
          // swallows their click.
          if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
          if (event.target instanceof Element && event.target.closest('button') !== null) return
          event.preventDefault()
          capturePointer(event.currentTarget, event.pointerId)
          dragRef.current = {
            mode: 'move',
            pointerX: event.clientX,
            pointerY: event.clientY,
            startX: float.x,
            startY: float.y,
            startW: float.w,
            startH: float.h,
            applied: { x: float.x, y: float.y, w: float.w, h: float.h },
            committed: false,
          }
          setDragging('move')
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (drag === null || !holdsPointer(event.currentTarget, event.pointerId)) return
          const geo = clampMove(drag.startX + (event.clientX - drag.pointerX), drag.startY + (event.clientY - drag.pointerY))
          scheduleApply(geo)
          const target = paneAt(event.clientX, event.clientY)
          if (target !== dockTargetRef.current) {
            clearDockHighlight()
            if (target !== null) target.setAttribute('data-dsh-float-dock-over', '')
            dockTargetRef.current = target
          }
        }}
        onPointerUp={(event) => {
          if (dragRef.current === null || !holdsPointer(event.currentTarget, event.pointerId)) return
          releasePointer(event.currentTarget, event.pointerId)
          flushNow()
          const geo = clampMove(
            dragRef.current.startX + (event.clientX - dragRef.current.pointerX),
            dragRef.current.startY + (event.clientY - dragRef.current.pointerY),
          )
          finishDrag('move', geo, paneAt(event.clientX, event.clientY))
        }}
        onPointerCancel={() => { abortDrag() }}
        onLostPointerCapture={() => { abortDrag() }}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenu({ x: event.clientX, y: event.clientY })
        }}
      >
        {getTabIcon?.(float.tab) ?? null}
        <span className={css.floatTitle} title={float.tab.title}>{float.tab.title}</span>
        <button
          type="button"
          className={css.floatClose}
          aria-label={t('close')}
          onClick={(event) => { event.stopPropagation(); onClose() }}
        >
          <IconCloseFill14 />
        </button>
        <Menu
          open={menu !== null}
          onClose={() => { setMenu(null) }}
          items={[
            { id: 'dock', label: t('dockToSidebar') },
            { id: 'close', label: t('close') },
          ]}
          onSelect={(id) => {
            setMenu(null)
            if (id === 'dock') onDock(null)
            else if (id === 'close') onClose()
          }}
          portal
          align="start"
          getAnchorRect={() => (menu === null ? null : new DOMRect(menu.x, menu.y, 0, 0))}
          anchor={<span />}
        />
      </div>
      {/* The tab cell reuses .paneTab (the pane's per-tab wrapper): the
          column-flex chain (window → .floatContent → .paneTab) is what
          gives the component a definite width via align-stretch — the exact
          sizing contract a tab gets inside a pane. */}
      <div className={css.floatContent}>
        <div className={css.paneTab}>{renderTab(float.tab, true, float.id)}</div>
      </div>
      <div
        className={css.floatResize}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
          event.preventDefault()
          capturePointer(event.currentTarget, event.pointerId)
          dragRef.current = {
            mode: 'resize',
            pointerX: event.clientX,
            pointerY: event.clientY,
            startX: float.x,
            startY: float.y,
            startW: float.w,
            startH: float.h,
            applied: { x: float.x, y: float.y, w: float.w, h: float.h },
            committed: false,
          }
          setDragging('resize')
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (drag === null || !holdsPointer(event.currentTarget, event.pointerId)) return
          scheduleApply(clampResize(
            drag.startW + (event.clientX - drag.pointerX),
            drag.startH + (event.clientY - drag.pointerY),
          ))
        }}
        onPointerUp={(event) => {
          if (dragRef.current === null || !holdsPointer(event.currentTarget, event.pointerId)) return
          releasePointer(event.currentTarget, event.pointerId)
          flushNow()
          const geo = clampResize(
            dragRef.current.startW + (event.clientX - dragRef.current.pointerX),
            dragRef.current.startH + (event.clientY - dragRef.current.pointerY),
          )
          finishDrag('resize', geo, null)
        }}
        onPointerCancel={() => { abortDrag() }}
        onLostPointerCapture={() => { abortDrag() }}
      />
    </div>
  )
}
