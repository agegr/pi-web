/**
 * Cross-session pinned-terminal resolution (v0.17.0+).
 *
 * A pinned terminal tab lives in its HOME session's state (the only
 * authoritative copy) — switching sessions never copies or projects it.
 * The viewer session's TabBar renders the tabs OTHER sessions have pinned
 * as VIRTUAL tabs appended to the first leaf's tab list, so the user sees
 * them inline with their own tabs. Clicking a virtual tab activates it
 * in-place: TerminalView connects to the home session's PTY via WebSocket
 * (sessionId + tab query params resolve to the home PTY on the host side),
 * so the terminal renders in the current workbench without jumping sessions.
 *
 * Visibility rule:
 *
 * | pin.scope | visible when |
 * |-----------|--------------|
 * | `global`  | any session (cwd-independent) |
 * | `workspace` | `viewer.cwd === tab.pin.homeCwd` (both undefined match; viewer.cwd unknown → conservative visible) |
 *
 * The "viewer.cwd unknown → visible" branch is intentional: during
 * hydration the session summary may carry no cwd yet, and hiding pinned
 * workspace tabs on first paint would flash them away. Once the cwd
 * resolves, the next store notify re-runs the resolver with the real cwd.
 *
 * The viewer's OWN session is excluded: its pinned tabs are already on its
 * own tab strip, so rendering them again as virtual tabs would double-show.
 * Tabs whose `pin` field is missing or whose `type` is not `'terminal'` are
 * ignored — only terminal tabs can be pinned.
 */
import type { SidebarState, SidebarTab, SplitNode } from './state'

/** A pinned terminal surfaced to the viewer, paired with its home session. */
export interface PinnedTabEntry {
  tab: SidebarTab
  homeSessionId: string
}

/** A viewer's session identity for visibility resolution. */
export interface PinnedViewer {
  sessionId: string
  cwd: string | undefined
}

/** The home-session scope stored on a pinned virtual tab's meta, so
 *  TerminalView connects to the home session's PTY (not the viewer's). */
export interface PinnedHomeScope {
  sessionId: string
  cwd: string | undefined
  /** The original tab id in the home session (TerminalView's `tab` param). */
  tabId: string
}

const PINNED_META_KEY = '__pinnedHome'
const PINNED_VID_PREFIX = 'pinned:'

/** Whether a tab id is a pinned virtual id (prefixed). */
export function isPinnedVirtualId(tabId: string): boolean {
  return tabId.startsWith(PINNED_VID_PREFIX)
}

/** Parse a pinned virtual id into its home session id and original tab id.
 *  Format: `pinned:<homeSessionId>:<originalTabId>` — session ids are UUIDs
 *  (no colons), so the first colon after the prefix delimits the session. */
export function parsePinnedVirtualId(tabId: string): { homeSessionId: string; tabId: string } {
  const rest = tabId.slice(PINNED_VID_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep < 0) return { homeSessionId: rest, tabId: '' }
  return { homeSessionId: rest.slice(0, sep), tabId: rest.slice(sep + 1) }
}

/** Extract the home scope from a pinned virtual tab's meta (undefined for
 *  regular tabs). */
export function getPinnedHomeScope(tab: SidebarTab): PinnedHomeScope | undefined {
  const meta = tab.meta as Record<string, unknown> | undefined
  return (meta?.[PINNED_META_KEY] as PinnedHomeScope | undefined) ?? undefined
}

/** Whether a tab is a pinned virtual tab (injected from another session). */
export function isPinnedVirtualTab(tab: SidebarTab): boolean {
  return getPinnedHomeScope(tab) !== undefined
}

/** Create a virtual SidebarTab for a pinned entry. The virtual id is unique
 *  (prefixed with home session) to avoid collision with the viewer's own
 *  tab ids; the original id is stored in meta for TerminalView. */
export function createPinnedVirtualTab(entry: PinnedTabEntry): SidebarTab {
  const { tab, homeSessionId } = entry
  const home: PinnedHomeScope = {
    sessionId: homeSessionId,
    cwd: tab.pin?.homeCwd,
    tabId: tab.id,
  }
  return {
    ...tab,
    id: PINNED_VID_PREFIX + homeSessionId + ':' + tab.id,
    meta: { ...(tab.meta as Record<string, unknown> | undefined ?? {}), [PINNED_META_KEY]: home },
  }
}

/** Inject pinned virtual tabs into the first leaf of a split tree, and
 *  override that leaf's `active` when a pinned tab is activated. Returns
 *  the original tree when there are no pinned tabs and no active override. */
export function injectPinnedIntoTree(
  tree: SplitNode,
  pinned: readonly SidebarTab[],
  activePinnedId: string | null,
): SplitNode {
  if (pinned.length === 0 && activePinnedId === null) return tree
  if (tree.kind === 'leaf') {
    return {
      ...tree,
      tabs: pinned.length > 0 ? [...tree.tabs, ...pinned] : tree.tabs,
      active: activePinnedId ?? tree.active,
    }
  }
  return {
    ...tree,
    children: [
      injectPinnedIntoTree(tree.children[0]!, pinned, activePinnedId),
      ...tree.children.slice(1),
    ],
  }
}

/**
 * Whether a pinned tab is visible to the viewer session. Conservative on
 * unknown cwd: a `workspace` pin with no `homeCwd` is visible everywhere
 * (the pin was set before the home session's cwd resolved), and a viewer
 * whose cwd is unknown sees every workspace pin (avoids hydration flash).
 */
export function pinnedVisibleTo(tab: SidebarTab, viewer: PinnedViewer): boolean {
  const pin = tab.pin
  if (pin === undefined) return false
  if (pin.scope === 'global') return true
  // workspace scope
  const home = pin.homeCwd
  if (home === undefined) return true
  if (viewer.cwd === undefined) return true
  return viewer.cwd === home
}

/**
 * Collect every pinned terminal visible to the viewer across ALL cached
 * session states. Excludes the viewer's own session (those tabs are on its
 * own strip). Order is stable: sessions in the cache's insertion order,
 * tabs in tree order (splits → bottomSplits → floats) within each session
 * — the order tabs were opened/pinned, so the rail never reorders between
 * renders.
 */
export function collectPinnedTabs(
  bySession: ReadonlyMap<string, SidebarState>,
  viewer: PinnedViewer,
): PinnedTabEntry[] {
  const entries: PinnedTabEntry[] = []
  for (const [homeSessionId, state] of bySession) {
    if (homeSessionId === viewer.sessionId) continue
    collectFromTree(state.splits, homeSessionId, viewer, entries)
    collectFromTree(state.bottomSplits, homeSessionId, viewer, entries)
    for (const float of state.floats) {
      if (float.tab.type === 'terminal' && pinnedVisibleTo(float.tab, viewer)) {
        entries.push({ tab: float.tab, homeSessionId })
      }
    }
  }
  return entries
}

/** Walk one split tree depth-first, collecting visible pinned terminals. */
function collectFromTree(
  node: SidebarState['splits'],
  homeSessionId: string,
  viewer: PinnedViewer,
  out: PinnedTabEntry[],
): void {
  if (node.kind === 'leaf') {
    for (const tab of node.tabs) {
      if (tab.type === 'terminal' && pinnedVisibleTo(tab, viewer)) {
        out.push({ tab, homeSessionId })
      }
    }
    return
  }
  for (const child of node.children) collectFromTree(child, homeSessionId, viewer, out)
}
