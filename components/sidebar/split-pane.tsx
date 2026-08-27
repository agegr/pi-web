/**
 * The split-pane workbench: renders the recursive split tree. A split lays
 * children out row- or column-wise with draggable dividers (fractional
 * sizes); a leaf renders its tab strip plus the active tab's content.
 *
 * Splitting is VSCode-style DRAG-TO-EDGE, not buttons: while dragging a tab
 * over a pane, a drop overlay shows five zones — four edges (left/right/up/
 * down) that split the pane with the tab in a fresh leaf, and the center
 * that merges the tab into the pane. The tree and all operations live in
 * state.ts; this file is pure presentation over them.
 */
import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { SidebarState, SidebarTab, SplitNode } from './state'
import type { DropZone } from './state'
import { TabBar, type NewTabOption, parseDrag, type TabDragPayload } from './TabBar'
import { createFrameBatcher } from './frame-batcher'
import css from './sidebar.module.css'

/** Actions the workbench needs (bound to the store by the sidebar shell). */
export interface WorkbenchActions {
  closeTab: (paneId: string, tabId: string) => void
  activateTab: (paneId: string, tabId: string) => void
  /** Make a pane the target of newly opened tabs (click focus). */
  focusPane: (paneId: string) => void
  /** VSCode drag gesture: edge → split the target pane, center → merge. */
  moveTabToEdge: (payload: TabDragPayload, toPane: string, zone: DropZone) => void
  /** Reorder within a pane (drop onto another tab inserts before it). */
  moveTabBefore: (payload: TabDragPayload, toPane: string, beforeTabId: string) => void
  resizeSplit: (splitId: string, index: number, deltaFrac: number) => void
  /** Float a docked tab out as a free window (tab context menu entry). */
  floatTab: (tabId: string) => void
  /**
   * Pin/unpin a terminal tab (v0.17.0+). The shell snapshots the home cwd
   * at pin time; null clears the pin. Optional: when undefined the tab
   * context menu hides the pin entry (legacy callers).
   */
  pinTab?: (tabId: string, scope: 'workspace' | 'global' | null) => void
}

/** One divider: pointer-capture drag translating px deltas into fractions.
 * Deltas are incremental — each move reports the displacement since the
 * previous move — because the store adds every reported delta to the pane
 * sizes; a cumulative (since-pointer-down) delta would be re-added on each
 * move and the divider would run away from the cursor.
 *
 * The moves are BATCHED per frame (createFrameBatcher): a pointer stream
 * fires faster than the display refresh, and applying each move is a store
 * reduce that re-renders both workbenches (terminals, editors, trees) per
 * event — the visible drag lag on slower CPUs (#315). The batch accumulates
 * the incremental deltas in a ref and applies the summed fraction at most
 * once per frame; the sum equals what the per-event application would have
 * produced (the reducer clamps each application, and at a settled position
 * a clamped sum is clamped to the same boundary), so the result is
 * indistinguishable at rest and at most one frame behind the cursor.
 */
function Divider(props: { dir: 'row' | 'col'; onResize: (deltaFrac: number) => void }) {
  const { dir, onResize } = props
  // `last` is the previous pointer position while dragging; `size` is the
  // container size at pointer-down (constant during the drag), used to
  // normalize the px delta into a fraction.
  const last = useRef({ x: 0, y: 0, size: 0 })
  const [dragging, setDragging] = useState(false)
  const pendingDelta = useRef(0)
  const batcher = useRef(createFrameBatcher()).current
  useEffect(() => () => batcher.dispose(), [batcher])

  return (
    <div
      className={clsx(css.divider, dir === 'row' ? css.dividerRow : css.dividerCol, dragging && css.dividerActive)}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        const box = event.currentTarget.parentElement?.getBoundingClientRect()
        last.current = {
          x: event.clientX,
          y: event.clientY,
          size: box === undefined ? 1 : (dir === 'row' ? box.width : box.height),
        }
        setDragging(true)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        const delta = dir === 'row' ? event.clientX - last.current.x : event.clientY - last.current.y
        pendingDelta.current += delta
        batcher.schedule(() => {
          const accumulated = pendingDelta.current
          pendingDelta.current = 0
          if (accumulated !== 0) onResize(accumulated / Math.max(1, last.current.size))
        })
        last.current.x = event.clientX
        last.current.y = event.clientY
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        // Flush any pending baked delta so the final pointer position lands
        // (the release event is not a move; dropping it would lose the tail).
        batcher.flushNow()
        event.currentTarget.releasePointerCapture(event.pointerId)
        setDragging(false)
      }}
    />
  )
}

/** Map a pointer position inside a pane to the VSCode drop zone (25% edges). */
function zoneAt(event: React.DragEvent, pane: HTMLElement): DropZone {
  const rect = pane.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return 'center'
  const x = (event.clientX - rect.left) / rect.width
  const y = (event.clientY - rect.top) / rect.height
  if (x < 0.25) return 'left'
  if (x > 0.75) return 'right'
  if (y < 0.25) return 'up'
  if (y > 0.75) return 'down'
  return 'center'
}

/** The icon of one openable type card (mirror of the + menu options). */
/**
 * An empty pane's welcome cards: the openable types as cards, clicked to
 * open (instead of a bare "this pane is empty" message).
 */
function PaneEmptyCards(props: {
  newTabOptions: NewTabOption[]
  onNewTab: (optionId: string) => void
}) {
  const { newTabOptions, onNewTab } = props
  return (
    <div className={css.paneEmptyCards}>
      {newTabOptions.map(option => (
        <button
          key={option.id}
          type="button"
          className={css.paneCard}
          disabled={option.disabled === true}
          title={option.label}
          onClick={() => { onNewTab(option.id) }}
        >
          {option.icon ?? null}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  )
}

/** A leaf: tab strip + active content + VSCode-style drop target for tabs. */
function LeafView(props: {
  leaf: { id: string; tabs: SidebarTab[]; active: string | null }
  newTabOptions: NewTabOption[]
  actions: WorkbenchActions
  onNewTab: (optionId: string) => void
  renderTab: (tab: SidebarTab, active: boolean, paneId: string) => ReactNode
  getTabIcon?: (tab: SidebarTab) => ReactNode
  getTabBadge?: (tab: SidebarTab) => ReactNode
}) {
  const { leaf, newTabOptions, actions, onNewTab, renderTab, getTabIcon, getTabBadge } = props
  const [dropZone, setDropZone] = useState<DropZone | null>(null)
  const activeTab = leaf.tabs.find(tab => tab.id === leaf.active) ?? leaf.tabs[leaf.tabs.length - 1]

  useEffect(() => {
    const clear = (): void => { setDropZone(null) }
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
      className={clsx(css.pane, dropZone !== null && css.paneDrop)}
      data-dsh-pane={leaf.id}
      onPointerDown={() => { actions.focusPane(leaf.id) }}
      onDragOver={(event) => {
        event.preventDefault()
        const zone = zoneAt(event, event.currentTarget)
        setDropZone(zone)
      }}
      onDragLeave={(event) => {
        // Only clear when the pointer left the pane entirely (not onto a child).
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropZone(null)
        }
      }}
      onDrop={(event) => {
        event.preventDefault()
        const zone = dropZone ?? zoneAt(event, event.currentTarget)
        setDropZone(null)
        const payload = parseDrag(event.dataTransfer.getData('application/x-dsh-tab'))
        if (payload !== null) actions.moveTabToEdge(payload, leaf.id, zone)
      }}
    >
      {dropZone !== null && <div className={clsx(css.dropOverlay, css[`drop${dropZone[0]!.toUpperCase()}${dropZone.slice(1)}`])} />}
      {/*
        The tab strip renders even for an empty pane: the + menu must stay
        reachable when the pane has no tabs (fresh split, or the last tab was
        dragged out), so a new tab can always be created or dragged in.
      */}
      <TabBar
        paneId={leaf.id}
        tabs={leaf.tabs}
        active={leaf.active}
        onActivate={(tabId) => { actions.activateTab(leaf.id, tabId) }}
        onClose={(tabId) => { actions.closeTab(leaf.id, tabId) }}
        onNewTab={onNewTab}
        newTabOptions={newTabOptions}
        getTabIcon={getTabIcon}
        getTabBadge={getTabBadge}
        onDropTab={(payload, before) => {
          if (before === null) actions.moveTabToEdge(payload, leaf.id, 'center')
          else actions.moveTabBefore(payload, leaf.id, before)
        }}
        onFloatTab={actions.floatTab}
        onPinTab={actions.pinTab}
      />
      {leaf.tabs.length > 0 ? (
        /*
          Every tab stays MOUNTED (inactive ones hidden), so switching tabs
          never tears down the content: a terminal keeps its pty connection
          and scrollback, an editor keeps its CodeMirror view and unsaved
          draft, explorer/git keep their loaded data. The unmount (and the
          terminal's close frame) happens only when a tab is truly closed.
        */
        <div className={css.paneContent}>
          {leaf.tabs.map(tab => (
            <div
              key={tab.id}
              className={clsx(css.paneTab, tab.id !== activeTab?.id && css.paneTabHidden)}
            >
              {renderTab(tab, tab.id === activeTab?.id, leaf.id)}
            </div>
          ))}
        </div>
      ) : (
        <PaneEmptyCards newTabOptions={newTabOptions} onNewTab={onNewTab} />
      )}
    </div>
  )
}

/** Recursive node renderer. */
function NodeView(props: {
  node: SplitNode
  state: SidebarState
  newTabOptions: NewTabOption[]
  actions: WorkbenchActions
  onNewTab: (optionId: string) => void
  renderTab: (tab: SidebarTab, active: boolean, paneId: string) => ReactNode
  getTabIcon?: (tab: SidebarTab) => ReactNode
  getTabBadge?: (tab: SidebarTab) => ReactNode
}) {
  const { node, state, newTabOptions, actions, onNewTab, renderTab, getTabIcon, getTabBadge } = props
  if (node.kind === 'leaf') {
    return (
      <LeafView
        leaf={node}
        newTabOptions={newTabOptions}
        actions={actions}
        onNewTab={onNewTab}
        renderTab={renderTab}
        getTabIcon={getTabIcon}
        getTabBadge={getTabBadge}
      />
    )
  }
  const isRow = node.dir === 'row'
  return (
    <div className={clsx(css.split, isRow ? css.splitRow : css.splitCol)}>
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          {index > 0 && (
            <Divider
              dir={node.dir}
              onResize={(deltaFrac) => { actions.resizeSplit(node.id, index - 1, deltaFrac) }}
            />
          )}
          <div
            className={css.splitChild}
            style={{ flexGrow: node.sizes[index], flexBasis: 0, minWidth: 0, minHeight: 0 }}
          >
            <NodeView
              node={child}
              state={state}
              newTabOptions={newTabOptions}
              actions={actions}
              onNewTab={onNewTab}
              renderTab={renderTab}
              getTabIcon={getTabIcon}
              getTabBadge={getTabBadge}
            />
          </div>
        </Fragment>
      ))}
    </div>
  )
}

/** The workbench: the split tree filling the sidebar body. `tree` selects
 *  which tree renders (the right panel's by default; the bottom panel passes
 *  `state.bottomSplits` — the actions route by pane id, so one action set
 *  serves both). */
export function Workbench(props: {
  state: SidebarState
  tree?: SplitNode
  newTabOptions: NewTabOption[]
  actions: WorkbenchActions
  onNewTab: (optionId: string) => void
  renderTab: (tab: SidebarTab, active: boolean, paneId: string) => ReactNode
  getTabIcon?: (tab: SidebarTab) => ReactNode
  getTabBadge?: (tab: SidebarTab) => ReactNode
}) {
  const { state, tree, newTabOptions, actions, onNewTab, renderTab, getTabIcon, getTabBadge } = props
  return (
    <div className={css.workbench}>
      <NodeView
        node={tree ?? state.splits}
        state={state}
        newTabOptions={newTabOptions}
        actions={actions}
        onNewTab={onNewTab}
        renderTab={renderTab}
        getTabIcon={getTabIcon}
        getTabBadge={getTabBadge}
      />
    </div>
  )
}
