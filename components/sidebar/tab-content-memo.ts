/**
 * The memo comparator for one tab's content cell (TabContent in Sidebar.tsx).
 *
 * Kept as a pure module so the "what re-renders a tab cell" contract is unit
 * testable: geometry/store re-renders of the Sidebar shell must NOT reconcile
 * every mounted tab (xterm/CodeMirror/FileTree subtrees — issue #315), while
 * locale switches (localeRevision), tab-registry updates (tabsVersion), and
 * a tab MOVING BETWEEN PANES (paneId — onOpenDiff closes over the pane id,
 * and moveTab reuses the SAME tab object, so only the pane id identifies the
 * move) must re-render the cell.
 */
import type { SidebarTab } from './state'

/** The fields whose change invalidates a tab cell's memo. Anything a cell's
 *  render (or its callbacks) depends on must be listed here. */
export interface TabContentMemoKey {
  tab: SidebarTab
  /** The pane this tab currently lives in. onOpenDiff closes over it, and
   *  moveTab reuses the same tab object when the tab moves panes — without
   *  comparing paneId the cell would keep the source pane's callback. */
  paneId: string
  sessionId: string
  cwd: string | undefined
  visible: boolean
  expanded: string[]
  /** Files highlighted in the file tree (the "Show in folder" reveal). */
  revealed: string[]
  localeRevision: string
  tabsVersion: number
  /** When the tab is a pinned virtual tab (injected from another session),
   *  this overrides `tab.id` passed to the tab descriptor's component so
   *  TerminalView connects to the home session's PTY by the original id.
   *  Undefined for regular tabs (no override). */
  effectiveTabId: string | undefined
}

/** True when the cell may skip a re-render (all render-affecting fields
 *  unchanged). Callback/context identities are deliberately ignored: their
 *  captured dependencies are stable or covered by the compared fields
 *  (onReferenceFile → sessionId/cwd, onSubagentJump/onToggleDir → stable
 *  refs/closures, onOpenDiff → paneId). */
export function tabContentCompare(prev: TabContentMemoKey, next: TabContentMemoKey): boolean {
  return (
    prev.tab === next.tab &&
    prev.paneId === next.paneId &&
    prev.sessionId === next.sessionId &&
    prev.cwd === next.cwd &&
    prev.visible === next.visible &&
    prev.expanded === next.expanded &&
    prev.revealed === next.revealed &&
    prev.localeRevision === next.localeRevision &&
    prev.tabsVersion === next.tabsVersion &&
    prev.effectiveTabId === next.effectiveTabId
  )
}
