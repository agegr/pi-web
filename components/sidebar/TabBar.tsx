/**
 * The tab strip of one pane: tabs capped at TAB_MAX_WIDTH (ellipsized),
 * overflow scrolls horizontally, a close button per tab, a four-way split
 * button cluster, and the + menu that opens new tabs (explorer / git /
 * terminal). Tabs are draggable; dropping onto another tab inserts before it,
 * dropping on the strip background appends to this pane. Right-clicking a
 * tab opens the tab context menu (float as a free window / close / close
 * others / close to the left / close to the right, the close ones scoped to
 * this pane).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconCloseFill14, IconPlusOutline16, Menu,
} from "./ui-primitives"
import type { SidebarTab } from './state'
import { isAgentTabId } from './state'
import { isPinnedVirtualTab } from './pinned'
import { IconPinOutline16 } from './icons'
import { t } from './locales'
import css from './sidebar.module.css'

/** One + menu option. */
export interface NewTabOption {
  id: string
  label: string
  disabled?: boolean
  /** Leading icon (Menu row). */
  icon?: ReactNode
}

/** Drag payload for tab moves (HTML5 DnD dataTransfer). */
export const TAB_DRAG_TYPE = 'application/x-dsh-tab'

export interface TabDragPayload {
  tabId: string
  paneId: string
}

export function serializeDrag(payload: TabDragPayload): string {
  return JSON.stringify(payload)
}

export function parseDrag(raw: string): TabDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as TabDragPayload
    if (typeof parsed.tabId === 'string' && typeof parsed.paneId === 'string') return parsed
    return null
  } catch {
    return null
  }
}

/** Global tab-drag flag: PDF iframes become non-interactive synchronously. */
function setTabDragging(active: boolean): void {
  if (active) document.body.setAttribute('data-dsh-tab-dragging', '')
  else document.body.removeAttribute('data-dsh-tab-dragging')
}

export function TabBar(props: {
  paneId: string
  tabs: SidebarTab[]
  active: string | null
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onNewTab: (optionId: string) => void
  newTabOptions: NewTabOption[]
  /** Drop of a tab from any pane: (payload, insertBeforeTabId | null). */
  onDropTab: (payload: TabDragPayload, before: string | null) => void
  /** Float a tab out as a free window (the tab context menu's entry; the
   *  drag-to-conversation gesture is handled at the Sidebar shell level). */
  onFloatTab: (tabId: string) => void
  /**
   * Pin/unpin a terminal tab (v0.17.0+). Called with `'workspace'` or
   * `'global'` to pin (the shell snapshots the home cwd), or `null` to
   * unpin. Non-terminal tabs never trigger this callback. Optional: the
   * menu hides the pin entry when unset (legacy callers).
   */
  onPinTab?: (tabId: string, scope: 'workspace' | 'global' | null) => void
  /** Icon resolver for tab labels (reads from the tab descriptor registry). */
  getTabIcon?: (tab: SidebarTab) => ReactNode
  /** Badge resolver for tab labels (reads the descriptor's `badge`; the
   *  resolver returns the rendered pill or null). */
  getTabBadge?: (tab: SidebarTab) => ReactNode
}) {
  const {
    paneId, tabs, active, onActivate, onClose, onNewTab, newTabOptions, onDropTab, onFloatTab, onPinTab, getTabIcon, getTabBadge,
  } = props
  const [menuOpen, setMenuOpen] = useState(false)
  // The tab right-click context menu: the target tab plus the cursor
  // position (the portaled Menu anchors there, following GitView/FileTree).
  const [tabMenu, setTabMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  // The context target's index in the render-time tab snapshot; -1 when the
  // tab disappeared since the menu opened (the menu hides then).
  const tabMenuIndex = tabMenu === null ? -1 : tabs.findIndex(tab => tab.id === tabMenu.tabId)

  // Middle-click close: the press target is recorded on middle mousedown
  // (preventDefaulted to disarm Chrome's middle-click autoscroll — its
  // indicator is inert here because the strip hides its scrollbar and only
  // the wheel handler scrolls) and the close settles on the first middle
  // mouseup OVER that same tab. Release-position semantics match VS Code
  // (microsoft/vscode#101028) and what users expect from Chrome tabs
  // (crbug/40679924): pressing on a tab and releasing elsewhere cancels the
  // close. The browser dispatches auxclick to the nearest common ancestor of
  // the press/release targets when they differ, so any drift, autoscroll
  // scroll, or tab-list reflow between press and release would otherwise
  // swallow the close; settling on the recorded press target at mouseup
  // keeps release semantics without depending on auxclick delivery.
  const onCloseRef = useRef(onClose)
  const middlePressed = useRef<{ id: string; node: HTMLElement } | null>(null)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    const onMouseUp = (event: MouseEvent): void => {
      if (event.button !== 1) return
      const pressed = middlePressed.current
      middlePressed.current = null
      // Close only when the release lands on the pressed tab; a drag-away
      // release cancels the press (one-shot per press).
      if (pressed !== null && pressed.node.isConnected && pressed.node.contains(event.target as Node)) {
        onCloseRef.current(pressed.id)
      }
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => { window.removeEventListener('mouseup', onMouseUp) }
  }, [])

  // Wheel over the strip scrolls the tab row horizontally (a plain mouse
  // wheel emits deltaY, which overflow-x alone never consumes). Bound as a
  // native NON-passive listener: React registers onWheel passively at the
  // root, where preventDefault() is a no-op. Modifier keys keep their native
  // meaning (shift = horizontal scroll, ctrl/cmd = zoom), and a strip that
  // does not overflow leaves the event alone so the page scrolls normally.
  useEffect(() => {
    const el = listRef.current
    if (el === null) return
    const onWheel = (event: WheelEvent): void => {
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
      if (el.scrollWidth <= el.clientWidth) return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1
      el.scrollLeft += (event.deltaX + event.deltaY) * unit
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel) }
  }, [])

  useEffect(() => {
    const clear = (): void => { setTabDragging(false); setDragOver(false) }
    window.addEventListener('dragend', clear, true)
    window.addEventListener('drop', clear, true)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('dragend', clear, true)
      window.removeEventListener('drop', clear, true)
      window.removeEventListener('blur', clear)
    }
  }, [])

  return (
    <div
      className={clsx(css.tabBar, dragOver && css.tabBarDrop)}
      onDragOver={(event) => {
        // The strip owns drops on itself (merge into this pane); stopping
        // propagation keeps the pane root from also running its edge-zone
        // handler on the same drop.
        event.preventDefault()
        event.stopPropagation()
        setDragOver(true)
      }}
      onDragLeave={() => { setDragOver(false) }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setDragOver(false)
        setTabDragging(false)
        const raw = event.dataTransfer.getData(TAB_DRAG_TYPE)
        const payload = parseDrag(raw)
        if (payload !== null) onDropTab(payload, null)
      }}
    >
      <div ref={listRef} className={css.tabList}>
        {tabs.map(tab => {
          const pinned = isPinnedVirtualTab(tab) || tab.pin !== undefined
          return (
          <div
            key={tab.id}
            className={clsx(css.tab, active === tab.id && css.tabActive, pinned && css.pinnedTab)}
            title={tab.title}
            draggable={!pinned}
            onDragStart={pinned ? undefined : (event) => {
              setTabDragging(true)
              event.dataTransfer.setData(TAB_DRAG_TYPE, serializeDrag({ tabId: tab.id, paneId }))
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => { setTabDragging(false); setDragOver(false) }}
            onDragOver={(event) => { event.preventDefault(); event.stopPropagation() }}
            onDrop={(event) => {
              if (pinned) { event.stopPropagation(); return }
              event.preventDefault()
              event.stopPropagation()
              setTabDragging(false)
              const raw = event.dataTransfer.getData(TAB_DRAG_TYPE)
              const payload = parseDrag(raw)
              if (payload !== null) onDropTab(payload, tab.id)
            }}
            onClick={() => { onActivate(tab.id) }}
            onMouseDown={(event) => {
              // Middle-click close: record the press target and disarm
              // Chrome's middle-click autoscroll (its indicator is inert
              // here — the strip scrolls via the wheel handler only). The
              // close itself settles on the first middle mouseup over this
              // same tab (window-level), keeping release semantics.
              if (event.button === 1) {
                event.preventDefault()
                middlePressed.current = { id: tab.id, node: event.currentTarget }
              }
            }}
            onContextMenu={(event) => {
              // Take over the browser menu: the tab context menu offers the
              // close operations for this pane. Opening it also dismisses
              // the + menu (only one menu at a time).
              event.preventDefault()
              setMenuOpen(false)
              setTabMenu({ tabId: tab.id, x: event.clientX, y: event.clientY })
            }}
          >
            {pinned && <IconPinOutline16 size={16} />}
            {getTabIcon?.(tab) ?? null}
            {getTabBadge?.(tab) ?? null}
            <span className={css.tabTitle}>{tab.title}</span>
            <button
              type="button"
              className={css.tabClose}
              aria-label={t('close')}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.id)
              }}
            >
              <IconCloseFill14 />
            </button>
          </div>
          )
        })}
        {/*
          The + sits immediately after the rightmost tab (sticky at the
          right edge of the scrollport when the tabs overflow, so it stays
          reachable no matter how many tabs are open).
        */}
        <Menu
          open={menuOpen}
          onClose={() => { setMenuOpen(false) }}
          items={newTabOptions.map(option => ({
            id: option.id,
            label: option.label,
            ...(option.disabled === true ? { disabled: true } : {}),
            ...(option.icon !== undefined ? { icon: option.icon } : {}),
          }))}
          onSelect={(id) => {
            onNewTab(id)
            setMenuOpen(false)
          }}
          portal
          align="end"
          anchor={(
            <button
              type="button"
              className={css.tabBarPlus}
              aria-label={t('newTab')}
              title={t('newTab')}
              onClick={() => { setMenuOpen(v => !v); setTabMenu(null) }}
            >
              <IconPlusOutline16 />
            </button>
          )}
        />
        {/*
          The tab context menu, positioned at the right-click cursor (portal
          so the panel's overflow clip cannot crop it). Close operations are
          scoped to THIS pane: "close others/left/right" walk the render-time
          tab snapshot and reuse the per-tab onClose path (which routes
          through the service and releases terminals), so the target tab is
          never closed and the pane never empties mid-loop.
        */}
        <Menu
          open={tabMenu !== null && tabMenuIndex >= 0}
          onClose={() => { setTabMenu(null) }}
          items={(() => {
            // The target tab drives the pin entry's shape: terminal tabs
            // get either a "Pin ▸" submenu (unpinned) or a single "Unpin"
            // row (pinned). Non-terminal tabs and missing onPinTab get no
            // pin entry at all — the menu stays exactly the legacy 5-item
            // shape. Pinned VIRTUAL tabs (injected from other sessions)
            // get a stripped menu: only Unpin + Close (no float, no
            // close-others/left/right — those are pane-scoped operations
            // that don't apply to cross-session virtual tabs).
            const targetTab = tabMenuIndex >= 0 ? tabs[tabMenuIndex] : undefined
            const isTerminal = targetTab?.type === 'terminal'
            const isPinnedVirtual = targetTab !== undefined && isPinnedVirtualTab(targetTab)
            const pinEntries = isTerminal && onPinTab !== undefined
              ? targetTab!.pin !== undefined
                ? [{ id: 'unpin', label: t('unpinTerminal') }]
                : [{
                    id: 'pin',
                    label: isAgentTabId(targetTab!.id) ? t('pinAgentTerminal') : t('pinTerminal'),
                    submenu: [
                      { id: 'pinWorkspace', label: t('pinToWorkspace') },
                      { id: 'pinGlobal', label: t('pinToGlobal') },
                    ],
                  }]
              : []
            if (isPinnedVirtual) {
              return [
                ...pinEntries,
                { id: 'close', label: t('close') },
              ]
            }
            return [
              { id: 'float', label: t('moveToFreeWindow') },
              ...pinEntries,
              { id: 'close', label: t('close') },
              { id: 'closeOthers', label: t('closeOtherTabs'), ...(tabs.length <= 1 ? { disabled: true } : {}) },
              { id: 'closeLeft', label: t('closeLeftTabs'), ...(tabMenuIndex <= 0 ? { disabled: true } : {}) },
              { id: 'closeRight', label: t('closeRightTabs'), ...(tabMenuIndex >= tabs.length - 1 ? { disabled: true } : {}) },
            ]
          })()}
          onSelect={(id) => {
            const target = tabMenu
            if (target === null) return
            setTabMenu(null)
            const index = tabs.findIndex(tab => tab.id === target.tabId)
            if (index < 0) return
            if (id === 'float') {
              onFloatTab(target.tabId)
            } else if (id === 'pinWorkspace') {
              onPinTab?.(target.tabId, 'workspace')
            } else if (id === 'pinGlobal') {
              onPinTab?.(target.tabId, 'global')
            } else if (id === 'unpin') {
              onPinTab?.(target.tabId, null)
            } else if (id === 'close') {
              onClose(target.tabId)
            } else if (id === 'closeOthers') {
              for (const tab of tabs) {
                if (tab.id !== target.tabId) onClose(tab.id)
              }
            } else if (id === 'closeLeft') {
              for (const tab of tabs.slice(0, index)) onClose(tab.id)
            } else if (id === 'closeRight') {
              for (const tab of tabs.slice(index + 1)) onClose(tab.id)
            }
          }}
          portal
          align="start"
          getAnchorRect={() => (tabMenu === null ? null : new DOMRect(tabMenu.x, tabMenu.y, 0, 0))}
          anchor={<span />}
        />
      </div>
    </div>
  )
}
