/**
 * Per-session sidebar state: the panel geometry, the split-pane workbench
 * tree, open tabs, and the explorer expansion set. One state instance per
 * conversation id, persisted to localStorage under `dsh-sidebar:v1:<id>` so
 * a reload restores the exact layout of the session it belongs to — switching
 * conversations swaps the whole state (memory + isolation).
 *
 * The split tree is a recursive structure: a leaf holds a tab group, a split
 * divides the space row- or column-wise with fractional sizes. All tree
 * operations are pure functions over the node, unit-tested in tests/state.spec.ts.
 */
import { SIDEBAR_PREFS_DEFAULTS, type SidebarPrefs } from './prefs-shared'
import { isNarrowWidth } from './breakpoints'

/**
 * Tab type identifier. Builtins register their ids (editor / git / terminal
 * / subagent / browser / diff) through the sidebar service; external
 * plugins register their own (e.g. `'my-plugin:db'`). Kept as `string` so
 * the registry stays open.
 */
export type TabType = string

/** What a diff tab shows: a worktree/index change of one path, or one commit's full patch. */
export type SidebarDiffRef =
  | { kind: 'worktree'; path: string; staged: boolean; untracked?: boolean; worktree?: string; repoRoot?: string }
  | { kind: 'commit'; hash: string; hashFull: string; subject: string; worktree?: string; repoRoot?: string }

/** One open tab. `path` carries the file (editor) or is absent (git/terminal);
 *  `diff` carries the change a diff tab shows; `meta` (v0.12.0+) carries
 *  plugin-owned JSON-serializable state, preserved across reloads. */
export interface SidebarTab {
  id: string
  type: TabType
  title: string
  path?: string
  diff?: SidebarDiffRef
  /** Plugin-owned state (v0.12.0+): MUST be JSON-serializable — it is
   *  persisted with the layout and restored verbatim on reload. */
  meta?: unknown
  /** Pinned-terminal marker (v0.17.0+): a pinned terminal tab survives a
   *  session switch in its home session's state and surfaces in the
   *  PinnedRail of every session the scope allows. `homeCwd` is the cwd
   *  snapshot at pin time — a `workspace`-scoped pin is only visible to
   *  sessions whose cwd matches it. Absent = unpinned (legacy states). */
  pin?: { scope: 'workspace' | 'global'; homeCwd?: string }
}

/** A tab group. */
export interface SidebarLeaf {
  kind: 'leaf'
  id: string
  tabs: SidebarTab[]
  active: string | null
}

/** A recursive split between child panes (fractional sizes summing to 1). */
export interface SidebarSplit {
  kind: 'split'
  id: string
  dir: 'row' | 'col'
  sizes: number[]
  children: SplitNode[]
}

export type SplitNode = SidebarLeaf | SidebarSplit

/**
 * One free window: a tab dragged out of the workbench onto the conversation
 * area floats in the panel host at viewport coordinates. The tab is OWNED by
 * the window exactly like a pane owns its tabs (moved, not copied); geometry
 * persists with the session so a reload restores the window in place.
 * Stacking order is the array order (last = topmost).
 */
export interface FloatWindow {
  id: string
  tab: SidebarTab
  /** Viewport coordinates of the window's top-left corner. */
  x: number
  y: number
  w: number
  h: number
}

/** The full per-session state. */
export interface SidebarState {
  panelOpen: boolean
  width: number
  /** The pane receiving newly opened tabs (last pane the user touched).
   *  Pane ids are globally unique across BOTH trees (shared uid counter), so
   *  one field resolves into either tree — see {@link treeOf}. */
  activePane: string | null
  /** Monotonic terminal tab counter (ids survive reloads). */
  nextTerminal: number
  /** Monotonic browser tab counter (ids survive reloads; mirrors nextTerminal). */
  nextBrowser: number
  /** Explorer expansion set (absolute directory paths). */
  expanded: string[]
  /**
   * Explorer rows highlighted by a "Show in folder" reveal (absolute paths).
   * Transient by design: sanitizeState never restores it, so a reload starts
   * unhighlighted.
   */
  revealed: string[]
  /** The right sidebar's split tree (the original workbench). */
  splits: SplitNode
  /** Whether the bottom panel (a second, independent workbench) is open. */
  bottomOpen: boolean
  /** The bottom panel's height (clamped to the contract range). */
  bottomHeight: number
  /**
   * Whether the bottom panel has been expanded at least once in this
   * session — the FIRST expansion tries to auto-open a terminal tab (gated
   * on the bottomPanelAutoTerminal pref); later expansions never do.
   */
  bottomOpenedOnce: boolean
  /** The bottom panel's own split tree (panes/tabs live only in ONE tree;
   *  tabs never cross panels — the two panels only share panel-size drags). */
  bottomSplits: SplitNode
  /** Free windows (tabs dragged out onto the conversation area). */
  floats: FloatWindow[]
}

export const PANEL_MIN = 280
export const PANEL_MAX = 640
export const PANEL_DEFAULT = 400
export const TAB_MAX_WIDTH = 160
/** Bottom panel geometry contract (mirrors the width contract; the upper
 *  bound is the viewport, enforced by {@link setBottomHeight}). */
export const BOTTOM_MIN = 120
export const BOTTOM_DEFAULT = 220
/** Free-window geometry contract: the floor keeps the window usable (a
 *  header plus some content), the ceiling is the viewport. */
export const FLOAT_MIN_W = 320
export const FLOAT_MIN_H = 200
/** Geometry a fresh free window starts with: a phone-like portrait ratio
 *  (390×780 ≈ 1:2). The creation path additionally caps the size to the
 *  viewport (minus a 24px margin), so a short viewport gets a shorter —
 *  not overflowing — window instead of an exact ratio. */
export const FLOAT_DEFAULT_W = 390
export const FLOAT_DEFAULT_H = 780

let nextIdCounter = 0
/** Unique pane/tab id within one state instance. */
function uid(prefix: string): string {
  nextIdCounter += 1
  return `${prefix}:${nextIdCounter}`
}

/** Mint a fresh uid-based tab id. The `'editor:' + path` convention only
 *  covers openSidebarFile opens (per-path dedupe); opens that must not
 *  dedupe (the tree's "open to the side") mint through here. */
export function mintTabId(): string {
  return uid('tab')
}

/**
 * The largest numeric suffix across a raw persisted state's counter ids
 * (`pane:N` / `tab:N` / `split:N`). The uid counter is module-global and
 * resets on every reload, so a split minted AFTER a reload would collide
 * with the persisted ids (a fresh "pane:1" beside the persisted "pane:1");
 * mapLeaf would then visit BOTH leaves and every open would land in both
 * panes of the split. Seeding the counter past the persisted ids keeps
 * fresh ids disjoint.
 */
function maxCounterId(parsed: unknown): number {
  let max = 0
  const consider = (id: unknown): void => {
    if (typeof id !== 'string') return
    const match = /^(?:pane|tab|split):(\d+)$/.exec(id)
    if (match !== null) max = Math.max(max, Number(match[1]))
  }
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    consider(record.id)
    if (Array.isArray(record.tabs)) {
      for (const tab of record.tabs) {
        if (tab !== null && typeof tab === 'object') consider((tab as Record<string, unknown>).id)
      }
    }
    if (Array.isArray(record.children)) {
      for (const child of record.children) walk(child)
    }
  }
  walk((parsed as Record<string, unknown> | null)?.splits)
  walk((parsed as Record<string, unknown> | null)?.bottomSplits)
  // Free windows mint through the same shared counter; their ids must seed it
  // too (a persisted float:N with a lower pane max would collide otherwise).
  const floats = (parsed as Record<string, unknown> | null)?.floats
  if (Array.isArray(floats)) {
    for (const float of floats) {
      if (float !== null && typeof float === 'object') consider((float as Record<string, unknown>).id)
    }
  }
  return max
}

/** The default tab a fresh session seeds. */
export type DefaultSeed = 'editor-home' | 'none'

/** A fresh default state: one seeded tab in one pane, open per the caller's
 * preference. `width` is the caller's preferred panel width (default
 * PANEL_DEFAULT) and `panelOpen` whether the panel starts expanded (default
 * true); the store seeds new sessions from the user's side card prefs.
 * `seed` picks the seeded tab: 'editor-home' places the EMPTY files window
 * (an editor tab with no path whose tree panel starts open,
 * `meta.treeOpen: true`) — in BOTH editorExplorer modes that window is the
 * file explorer page — and 'none' starts with an empty pane (the store
 * passes it when the user disabled the editor tab type in settings). */
export function makeDefaultState(width = PANEL_DEFAULT, panelOpen = true, seed: DefaultSeed = 'editor-home'): SidebarState {
  const leaf: SidebarLeaf = { kind: 'leaf', id: uid('pane'), tabs: [], active: null }
  if (seed === 'editor-home') {
    // No path: the editor host renders its empty-state hint and the docked
    // tree panel (treeOpen defaults open for path-less tabs; meta pins it).
    leaf.tabs = [{ id: uid('tab'), type: 'editor', title: 'Files', meta: { treeOpen: true } }]
    leaf.active = leaf.tabs[0]!.id
  }
  // The bottom panel starts closed with an empty pane (its welcome cards
  // offer the openable types on first use).
  const bottomLeaf: SidebarLeaf = { kind: 'leaf', id: uid('pane'), tabs: [], active: null }
  return {
    panelOpen,
    width,
    activePane: leaf.id,
    nextTerminal: 1,
    nextBrowser: 1,
    expanded: [],
    revealed: [],
    splits: leaf,
    bottomOpen: false,
    bottomHeight: BOTTOM_DEFAULT,
    bottomOpenedOnce: false,
    bottomSplits: bottomLeaf,
    floats: [],
  }
}

/** Whether a tree node (or any descendant) carries the given pane/split id. */
function treeHasId(node: SplitNode, id: string): boolean {
  if (node.id === id) return true
  if (node.kind === 'split') return node.children.some(child => treeHasId(child, id))
  return false
}

/** Which tree owns a pane/split id: 'bottomSplits' when the id lives in the
 *  bottom panel's tree, else 'splits' (the right panel's tree). Ids are
 *  globally unique (the shared uid counter), so an id in neither tree falls
 *  back to the right tree, where tree operations no-op on a missing node —
 *  the pre-bottom-panel behavior. */
export function treeOf(state: SidebarState, id: string): 'splits' | 'bottomSplits' {
  return treeHasId(state.bottomSplits, id) ? 'bottomSplits' : 'splits'
}

/** Walk the tree and apply `visit` to the leaf with the given id. */
export function mapLeaf(node: SplitNode, paneId: string, visit: (leaf: SidebarLeaf) => void): SplitNode {
  if (node.kind === 'leaf') {
    if (node.id === paneId) {
      const copy: SidebarLeaf = { ...node, tabs: [...node.tabs] }
      visit(copy)
      return copy
    }
    return node
  }
  const split = node
  return {
    ...split,
    sizes: [...split.sizes],
    children: split.children.map(child => mapLeaf(child, paneId, visit)),
  }
}

/** The first leaf of the tree (fallback pane when activePane is gone). */
export function firstLeaf(node: SplitNode): SidebarLeaf {
  if (node.kind === 'leaf') return node
  return firstLeaf(node.children[0]!)
}

/** Empty every leaf of a tree (the bottom tree after its tabs migrate out). */
function clearAllTabs(node: SplitNode): SplitNode {
  if (node.kind === 'leaf') return { ...node, tabs: [], active: null }
  return { ...node, children: node.children.map(clearAllTabs) }
}

/**
 * Narrow-viewport migration: the bottom panel's tabs are thrown INTO the
 * right sidebar — the "merged display" on mobile is the right panel alone,
 * whose tab strips now carry the bottom tree's tabs (depth-first order,
 * appended to the right tree's FIRST leaf). The bottom tree is emptied (its
 * structure stays — the desktop bottom panel re-renders its welcome cards)
 * and the panel closes. The active pane moves to the right tree's first
 * leaf so every new tab lands in the visible panel.
 *
 * Idempotent: a bottom tree with no tabs and a closed panel returns the
 * same reference. Runs when the viewport enters narrow (see the Sidebar
 * shell); migrating is permanent for the session — the tabs now live in the
 * right tree, exactly like the user "threw them in".
 */
export function migrateBottomTabs(state: SidebarState): SidebarState {
  const bottomTabs = allLeaves(state.bottomSplits).flatMap(leaf => leaf.tabs)
  const activeInBottom = state.activePane !== null && treeHasId(state.bottomSplits, state.activePane)
  if (bottomTabs.length === 0 && !state.bottomOpen && !activeInBottom) return state
  const target = firstLeaf(state.splits)
  return {
    ...state,
    activePane: target.id,
    bottomOpen: false,
    splits: bottomTabs.length > 0
      ? mapLeaf(state.splits, target.id, leaf => {
        leaf.tabs = [...leaf.tabs, ...bottomTabs]
      })
      : state.splits,
    bottomSplits: bottomTabs.length > 0 ? clearAllTabs(state.bottomSplits) : state.bottomSplits,
  }
}

/** Find the leaf containing a tab id, if any. */
export function leafWithTab(node: SplitNode, tabId: string): SidebarLeaf | undefined {
  if (node.kind === 'leaf') {
    return node.tabs.some(tab => tab.id === tabId) ? node : undefined
  }
  for (const child of node.children) {
    const found = leafWithTab(child, tabId)
    if (found !== undefined) return found
  }
  return undefined
}

/** All leaves of the tree, depth-first. */
export function allLeaves(node: SplitNode): SidebarLeaf[] {
  if (node.kind === 'leaf') return [node]
  return node.children.flatMap(allLeaves)
}

/** Whether a tab exists anywhere in a state (either tree, any pane, or any
 *  free window — a floating tab is as open as a docked one). */
export function tabOpenIn(state: SidebarState, tabId: string): boolean {
  return allLeaves(state.splits).some(leaf => leaf.tabs.some(tab => tab.id === tabId))
    || allLeaves(state.bottomSplits).some(leaf => leaf.tabs.some(tab => tab.id === tabId))
    || state.floats.some(float => float.tab.id === tabId)
}

/** The free window holding a tab id, if any. */
export function floatWithTab(state: SidebarState, tabId: string): FloatWindow | undefined {
  return state.floats.find(float => float.tab.id === tabId)
}

/** The free window with the given window id, if any. */
export function floatById(state: SidebarState, floatId: string): FloatWindow | undefined {
  return state.floats.find(float => float.id === floatId)
}

/** Replace a leaf with a split of it plus a fresh empty leaf. */
export function splitLeafAt(node: SplitNode, paneId: string, dir: 'row' | 'col'): SplitNode {
  const fresh: SidebarLeaf = { kind: 'leaf', id: uid('pane'), tabs: [], active: null }
  return mapLeaf(node, paneId, (leaf) => {
    const target: SidebarLeaf = { ...leaf }
    const split: SidebarSplit = {
      kind: 'split',
      id: uid('split'),
      dir,
      sizes: [0.5, 0.5],
      children: [target, fresh],
    }
    Object.assign(leaf, split)
  })
}

/**
 * Split a leaf by inserting a fresh leaf holding `tab` beside it — the
 * VSCode drag-to-edge gesture. `dir` is the split direction ('row' for
 * left/right, 'col' for up/down); `front` places the new leaf first (left/
 * up) or second (right/down).
 * @returns the new tree plus the fresh leaf's id (the drop's active pane).
 */
export function insertLeafAt(
  node: SplitNode,
  paneId: string,
  dir: 'row' | 'col',
  tab: SidebarTab,
  front: boolean,
): { node: SplitNode; leafId: string } {
  const fresh: SidebarLeaf = { kind: 'leaf', id: uid('pane'), tabs: [tab], active: tab.id }
  const leafId = fresh.id
  const next = mapLeaf(node, paneId, (leaf) => {
    const target: SidebarLeaf = { ...leaf }
    const split: SidebarSplit = {
      kind: 'split',
      id: uid('split'),
      dir,
      sizes: [0.5, 0.5],
      children: front ? [fresh, target] : [target, fresh],
    }
    Object.assign(leaf, split)
  })
  return { node: next, leafId }
}

/** Where a tab drop lands on a pane: an edge creates a split, center merges. */
export type DropZone = 'left' | 'right' | 'up' | 'down' | 'center'

/**
 * The VSCode drag gesture: move a tab out of its pane and either merge it
 * into the target pane (center) or split the target pane with the tab in a
 * fresh leaf (edge). The source pane collapses when it empties.
 *
 * The panes may live in DIFFERENT trees (dragging a tab between the two
 * panels): the tab then leaves its own tree and lands in the other one.
 */
export function moveTabToEdge(
  state: SidebarState,
  fromPane: string,
  tabId: string,
  toPane: string,
  zone: DropZone,
): SidebarState {
  if (fromPane === toPane && zone === 'center') {
    // Dropped back onto its own pane's center: reorder to the end.
    return moveTab(state, fromPane, tabId, toPane, -1)
  }
  const key = treeOf(state, fromPane)
  const toKey = treeOf(state, toPane)
  if (key !== toKey) {
    // Cross-panel drop: remove the tab from its own tree, then merge (center)
    // or split (edge) a pane of the OTHER tree with the tab.
    const source = leafWithTab(state[key], tabId)
    if (source === undefined) return state
    const tab = source.tabs.find(candidate => candidate.id === tabId)!
    let emptied = false
    let sourceNode = mapLeaf(state[key], source.id, (leaf) => {
      leaf.tabs = leaf.tabs.filter(candidate => candidate.id !== tabId)
      if (leaf.active === tabId) leaf.active = leaf.tabs[leaf.tabs.length - 1]?.id ?? null
      if (leaf.tabs.length === 0) emptied = true
    })
    if (emptied) sourceNode = removeLeafAt(sourceNode, source.id)
    let targetNode = state[toKey]
    let activePane: string
    if (zone === 'center') {
      targetNode = mapLeaf(targetNode, toPane, (leaf) => {
        leaf.tabs = [...leaf.tabs, tab]
        leaf.active = tab.id
      })
      activePane = toPane
    } else {
      const dir = zone === 'left' || zone === 'right' ? 'row' : 'col'
      const result = insertLeafAt(targetNode, toPane, dir, tab, zone === 'left' || zone === 'up')
      targetNode = result.node
      activePane = result.leafId
    }
    return { ...state, [key]: sourceNode, [toKey]: targetNode, activePane }
  }
  const node = state[key]
  const source = leafWithTab(node, tabId)
  if (source === undefined) return state
  const tab = source.tabs.find(candidate => candidate.id === tabId)!
  let emptied = false
  let splits = mapLeaf(node, source.id, (leaf) => {
    leaf.tabs = leaf.tabs.filter(candidate => candidate.id !== tabId)
    if (leaf.active === tabId) leaf.active = leaf.tabs[leaf.tabs.length - 1]?.id ?? null
    if (leaf.tabs.length === 0) emptied = true
  })
  if (emptied) splits = removeLeafAt(splits, source.id)
  if (zone === 'center') {
    splits = mapLeaf(splits, toPane, (leaf) => {
      leaf.tabs = [...leaf.tabs, tab]
      leaf.active = tab.id
    })
    return { ...state, [key]: splits, activePane: toPane }
  }
  const dir = zone === 'left' || zone === 'right' ? 'row' : 'col'
  const result = insertLeafAt(splits, toPane, dir, tab, zone === 'left' || zone === 'up')
  return { ...state, [key]: result.node, activePane: result.leafId }
}

/**
 * Remove a leaf from the tree. A split left with one child promotes that
 * child; removing the last leaf yields an empty leaf.
 */
export function removeLeafAt(node: SplitNode, paneId: string): SplitNode {
  if (node.kind === 'leaf') return node.id === paneId ? { ...node, tabs: [], active: null } : node
  const children = node.children.filter(child => !(child.kind === 'leaf' && child.id === paneId))
  if (children.length === node.children.length) {
    return {
      ...node,
      sizes: [...node.sizes],
      children: node.children.map(child => removeLeafAt(child, paneId)),
    }
  }
  if (children.length === 1) return children[0]!
  return { ...node, sizes: [...node.sizes], children }
}

/** Close a tab; an emptied leaf is removed (unless it is the only pane). */
export function closeTab(state: SidebarState, paneId: string, tabId: string): SidebarState {
  const key = treeOf(state, paneId)
  let emptied = false
  const splits = mapLeaf(state[key], paneId, (leaf) => {
    leaf.tabs = leaf.tabs.filter(tab => tab.id !== tabId)
    if (leaf.active === tabId) leaf.active = leaf.tabs[leaf.tabs.length - 1]?.id ?? null
    if (leaf.tabs.length === 0) emptied = true
  })
  return { ...state, [key]: emptied ? removeLeafAt(splits, paneId) : splits }
}

/** Activate a tab in its pane (the pane's own tree). */
export function activateTab(state: SidebarState, paneId: string, tabId: string): SidebarState {
  const key = treeOf(state, paneId)
  return {
    ...state,
    activePane: paneId,
    [key]: mapLeaf(state[key], paneId, (leaf) => {
      if (leaf.tabs.some(tab => tab.id === tabId)) leaf.active = tabId
    }),
  }
}

/** Update the display fields of one open tab (title / path / meta) without
 *  re-opening it. The browser tab persists its current URL and hostname
 *  title through this reducer so a reload restores the visited page. A
 *  missing tab id is a no-op. The tab may live in either tree or a free
 *  window. */
export function patchTab(
  state: SidebarState,
  tabId: string,
  patch: { title?: string; path?: string; meta?: unknown },
): SidebarState {
  let changed = false
  const apply = (tab: SidebarTab): SidebarTab => {
    changed = true
    return {
      ...tab,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.path !== undefined ? { path: patch.path } : {}),
      ...(patch.meta !== undefined ? { meta: patch.meta } : {}),
    }
  }
  const walk = (node: SplitNode): SplitNode => {
    if (node.kind === 'leaf') {
      const tabs = node.tabs.map(tab => (tab.id === tabId ? apply(tab) : tab))
      return tabs === node.tabs ? node : { ...node, tabs }
    }
    const children = node.children.map(walk)
    return children === node.children ? node : { ...node, children }
  }
  const splits = walk(state.splits)
  const bottomSplits = walk(state.bottomSplits)
  const floats = state.floats.map(float => (float.tab.id === tabId ? { ...float, tab: apply(float.tab) } : float))
  return changed ? { ...state, splits, bottomSplits, floats } : state
}

/**
 * Set or clear the pin marker on one open tab (v0.17.0+). A pin marker is
 * structural metadata (NOT display fields like title/path), so it walks
 * both split trees AND the free windows exactly like {@link patchTab} —
 * the tab may live in either tree or float. Passing `null` clears the pin
 * (the tab stays open in its home session); passing a `{ scope, homeCwd }`
 * object sets it. An unknown tab id is a strict no-op (same reference
 * returned) so a stale pin request never churns the state or rewrites
 * localStorage.
 * @param state - the current per-session sidebar state.
 * @param tabId - the tab to pin/unpin.
 * @param pin - the pin marker to set, or null to clear.
 * @returns the next state (or the same reference when the tab is missing
 *          or the pin marker is already the requested value).
 */
export function setTabPin(
  state: SidebarState,
  tabId: string,
  pin: { scope: 'workspace' | 'global'; homeCwd?: string } | null,
): SidebarState {
  let changed = false
  const apply = (tab: SidebarTab): SidebarTab => {
    // Pin is terminal-only (design YAGNI): a defensive guard keeps the
    // invariant even if a caller accidentally targets a non-terminal tab.
    if (tab.type !== 'terminal') return tab
    // Idempotent: setting the same pin (deep-equal on scope + homeCwd) is a
    // no-op so re-clicking the menu item never churns the state.
    if (pin === null) {
      if (tab.pin === undefined) return tab
    } else if (
      tab.pin !== undefined
      && tab.pin.scope === pin.scope
      && tab.pin.homeCwd === pin.homeCwd
    ) {
      return tab
    }
    changed = true
    const { pin: _omit, ...rest } = tab
    return pin === null ? rest : { ...rest, pin }
  }
  const walk = (node: SplitNode): SplitNode => {
    if (node.kind === 'leaf') {
      // Find the target tab without rebuilding the whole array: only clone
      // when the tab is actually here and apply changed it (idempotent
      // no-ops return the same tab reference, so === holds).
      const idx = node.tabs.findIndex(tab => tab.id === tabId)
      if (idx < 0) return node
      const oldTab = node.tabs[idx]!
      const newTab = apply(oldTab)
      if (newTab === oldTab) return node
      const tabs = node.tabs.slice()
      tabs[idx] = newTab
      return { ...node, tabs }
    }
    const children = node.children.map(walk)
    // Only rebuild if at least one child actually changed reference.
    if (children.every((child, i) => child === node.children[i])) return node
    return { ...node, children }
  }
  const splits = walk(state.splits)
  const bottomSplits = walk(state.bottomSplits)
  const floatIdx = state.floats.findIndex(f => f.tab.id === tabId)
  const floats = floatIdx < 0 ? state.floats : (() => {
    const oldFloat = state.floats[floatIdx]!
    const newTab = apply(oldFloat.tab)
    if (newTab === oldFloat.tab) return state.floats
    const next = state.floats.slice()
    next[floatIdx] = { ...oldFloat, tab: newTab }
    return next
  })()
  return changed ? { ...state, splits, bottomSplits, floats } : state
}

/**
 * Land a tab in the active pane (or focus its existing instance by id).
 * Dedup strategies (single-instance, per-path, per-change) are owned by the
 * tab descriptor through {@link BetterSidebarService.openTab} / `dedupeKey`;
 * this reducer only handles the id-based safety net (reconcile and
 * openDiffTab already check existence before calling) and the landing
 * itself — the service's dedupe path delegates here after its dedupeKey
 * check misses.
 *
 * The active pane may live in EITHER tree (pane ids are globally unique):
 * a stale id that survives in neither tree falls back to the right tree's
 * first pane instead of swallowing the open.
 */
export function openTabInActivePane(state: SidebarState, tab: SidebarTab): SidebarState {
  let targetId = state.activePane ?? firstLeaf(state.splits).id
  // A stale activePane (its pane was closed since) must not swallow the
  // open: fall back to the first pane of the right tree instead of dropping
  // the tab.
  if (!allLeaves(state[treeOf(state, targetId)]).some(leaf => leaf.id === targetId)) {
    targetId = firstLeaf(state.splits).id
  }
  const targetKey = treeOf(state, targetId)
  // Id-based safety net: if a tab with the same id exists, focus it — in a
  // pane (activate) or in a free window (raise, no panel switch).
  for (const leaf of allLeaves(state.splits).concat(allLeaves(state.bottomSplits))) {
    const existing = leaf.tabs.find(candidate => candidate.id === tab.id)
    if (existing !== undefined) return activateTab(state, leaf.id, existing.id)
  }
  const floated = floatWithTab(state, tab.id)
  if (floated !== undefined) return raiseFloat(state, floated.id)
  return {
    ...state,
    activePane: targetId,
    [targetKey]: mapLeaf(state[targetKey], targetId, (leaf) => {
      leaf.tabs = [...leaf.tabs, tab]
      leaf.active = tab.id
    }),
  }
}

/** Move a tab from one pane to another (insert at index; -1 appends).
 *  The panes may live in DIFFERENT trees — dragging a tab between the two
 *  panels removes it from its own tree and lands it in the other one. */
export function moveTab(state: SidebarState, fromPane: string, tabId: string, toPane: string, index = -1): SidebarState {
  const fromKey = treeOf(state, fromPane)
  const toKey = treeOf(state, toPane)
  if (fromKey !== toKey) {
    let moved: SidebarTab | undefined
    let emptied = false
    const source = mapLeaf(state[fromKey], fromPane, (leaf) => {
      const found = leaf.tabs.find(tab => tab.id === tabId)
      if (found === undefined) return
      moved = found
      leaf.tabs = leaf.tabs.filter(tab => tab.id !== tabId)
      if (leaf.active === tabId) leaf.active = leaf.tabs[leaf.tabs.length - 1]?.id ?? null
      if (leaf.tabs.length === 0) emptied = true
    })
    if (moved === undefined) return state
    const target = mapLeaf(state[toKey], toPane, (leaf) => {
      const insertAt = index >= 0 && index <= leaf.tabs.length ? index : leaf.tabs.length
      leaf.tabs = [...leaf.tabs.slice(0, insertAt), moved!, ...leaf.tabs.slice(insertAt)]
      leaf.active = moved!.id
    })
    return {
      ...state,
      [fromKey]: emptied ? removeLeafAt(source, fromPane) : source,
      [toKey]: target,
      activePane: toPane,
    }
  }
  let moved: SidebarTab | undefined
  let emptied = false
  let splits = mapLeaf(state[fromKey], fromPane, (leaf) => {
    const found = leaf.tabs.find(tab => tab.id === tabId)
    if (found === undefined) return
    moved = found
    leaf.tabs = leaf.tabs.filter(tab => tab.id !== tabId)
    if (leaf.active === tabId) leaf.active = leaf.tabs[leaf.tabs.length - 1]?.id ?? null
    if (leaf.tabs.length === 0) emptied = true
  })
  if (moved === undefined) return state
  if (emptied) splits = removeLeafAt(splits, fromPane)
  splits = mapLeaf(splits, toPane, (leaf) => {
    const insertAt = index >= 0 && index <= leaf.tabs.length ? index : leaf.tabs.length
    leaf.tabs = [...leaf.tabs.slice(0, insertAt), moved!, ...leaf.tabs.slice(insertAt)]
    leaf.active = moved!.id
  })
  return { ...state, [fromKey]: splits, activePane: toPane }
}

/** Split the active pane (or the pane containing the active tab). */
export function splitPane(state: SidebarState, dir: 'row' | 'col'): SidebarState {
  const paneId = state.activePane ?? firstLeaf(state.splits).id
  const key = treeOf(state, paneId)
  return { ...state, [key]: splitLeafAt(state[key], paneId, dir) }
}

/**
 * Open a diff tab the VSCode way: an existing instance of the same change is
 * focused wherever it lives; otherwise the tab joins the first pane that
 * already holds diff tabs (diff panes are sticky — repeated clicks stack
 * there); on the FIRST diff of a layout the source pane splits vertically so
 * the diff lands in a fresh pane below it ("默认在下半栏新增一个").
 *
 * This is split-tree placement surgery, not registry dispatch: the diff tab
 * descriptor's `dedupeKey` is `(tab) => tab.id`, and the existing-instance
 * check below is exactly that rule — the two agree by construction (asserted
 * in tests). Diff tabs minted by the Git view carry change-derived ids, so
 * the id check is the per-change dedupe.
 * @returns the new state, with the diff pane active.
 */
export function openDiffTab(state: SidebarState, sourcePaneId: string, tab: SidebarTab): SidebarState {
  const existingLeaf = leafWithTab(state.splits, tab.id)
  if (existingLeaf !== undefined) return activateTab(state, existingLeaf.id, tab.id)
  const diffLeaf = allLeaves(state.splits).find(leaf => leaf.tabs.some(candidate => candidate.type === 'diff'))
  if (diffLeaf !== undefined) {
    return {
      ...state,
      activePane: diffLeaf.id,
      splits: mapLeaf(state.splits, diffLeaf.id, (leaf) => {
        leaf.tabs = [...leaf.tabs, tab]
        leaf.active = tab.id
      }),
    }
  }
  // First diff: split the source pane, the diff tab in the new LOWER leaf.
  // (A stale sourcePaneId — its pane closed meanwhile — degrades to the
  // regular open path instead of dropping the tab into an orphaned leaf.)
  if (!allLeaves(state.splits).some(leaf => leaf.id === sourcePaneId)) {
    return openTabInActivePane(state, tab)
  }
  const result = insertLeafAt(state.splits, sourcePaneId, 'col', tab, false)
  return { ...state, splits: result.node, activePane: result.leafId }
}

/** Toggle the panel open/closed (opening restores the previous layout). */
export function togglePanel(state: SidebarState): SidebarState {
  return { ...state, panelOpen: !state.panelOpen }
}

/** Toggle the bottom panel open/closed (independent of the right panel). */
export function toggleBottomPanel(state: SidebarState): SidebarState {
  return { ...state, bottomOpen: !state.bottomOpen }
}

/** Set the panel width (clamped to the contract range; the upper bound is
 * the viewport so the fullscreen expansion can fill the window). */
export function setWidth(state: SidebarState, width: number): SidebarState {
  const max = typeof window !== 'undefined' ? Math.max(PANEL_MIN, window.innerWidth) : PANEL_MAX
  return { ...state, width: Math.min(max, Math.max(PANEL_MIN, Math.round(width))) }
}

/** Set the bottom panel height (clamped to the contract range). The upper
 * bound leaves the center column (the agent output area) at least PANEL_MIN
 * tall — without the cap the bottom panel could swallow the whole viewport
 * and squeeze the conversation to zero height. */
export function setBottomHeight(state: SidebarState, height: number): SidebarState {
  const viewport = typeof window !== 'undefined' ? window.innerHeight : Infinity
  const max = Math.max(BOTTOM_MIN, viewport - PANEL_MIN)
  return { ...state, bottomHeight: Math.min(max, Math.max(BOTTOM_MIN, Math.round(height))) }
}

/** Toggle a directory in the explorer expansion set. */
export function toggleExpanded(state: SidebarState, path: string): SidebarState {
  const expanded = state.expanded.includes(path)
    ? state.expanded.filter(item => item !== path)
    : [...state.expanded, path]
  return { ...state, expanded }
}

/**
 * Reveal files in the explorer: expand every ancestor directory between the
 * explorer root and each file (so the lazy tree actually shows the row) and
 * record the paths for highlighting. The reveal set is transient —
 * sanitizeState never restores it, so a reload starts unhighlighted.
 * @param state - current sidebar state.
 * @param cwd - the explorer's root (session working directory).
 * @param files - absolute paths to highlight (parent dirs are expanded).
 * @returns the next state, or the same reference when nothing is revealed.
 */
export function revealPaths(state: SidebarState, cwd: string | undefined, files: readonly string[]): SidebarState {
  const expanded = new Set(state.expanded)
  const revealed: string[] = []
  const rootParts = (cwd ?? '').split(/[\\/]+/).filter(part => part !== '')
  for (const file of files) {
    if (typeof file !== 'string' || file === '') continue
    revealed.push(file)
    const parts = file.split(/[\\/]+/).filter(part => part !== '' && part !== '.')
    const separator = file.includes('\\') ? '\\' : '/'
    // Keep the original leading separator(s) when rebuilding ancestor dirs:
    // FileTree matches expansion against ABSOLUTE paths, so dropping the
    // root (POSIX `/w/src` �W `w/src`) or a UNC prefix (`\\server\share`)
    // would leave every ancestor collapsed and the row unreachable.
    const prefix = file.startsWith('/') ? '/' : file.startsWith('\\\\') ? '\\\\' : file.startsWith('\\') ? '\\' : ''
    for (let i = rootParts.length; i < parts.length - 1; i++) {
      expanded.add(prefix + parts.slice(0, i + 1).join(separator))
    }
  }
  if (revealed.length === 0) return state
  return { ...state, expanded: [...expanded], revealed }
}

/** Adjust one split divider: `i` is the left/top child index, delta in fractions. */
export function resizeSplit(node: SplitNode, splitId: string, index: number, delta: number): SplitNode {
  if (node.kind === 'leaf') return node
  if (node.id === splitId) {
    const sizes = [...node.sizes]
    const left = Math.min(0.92, Math.max(0.08, sizes[index]! + delta))
    const right = Math.min(0.92, Math.max(0.08, sizes[index + 1]! - delta))
    sizes[index] = left
    sizes[index + 1] = right
    return { ...node, sizes }
  }
  return {
    ...node,
    sizes: [...node.sizes],
    children: node.children.map(child => resizeSplit(child, splitId, index, delta)),
  }
}

/** State-level {@link resizeSplit} route: the divider may live in either
 *  tree (split ids are globally unique). */
export function resizeSplitIn(state: SidebarState, splitId: string, index: number, delta: number): SidebarState {
  const key = treeOf(state, splitId)
  return { ...state, [key]: resizeSplit(state[key], splitId, index, delta) }
}

// ── Free windows ────────────────────────────────────────────────────────────

/** The viewport size, or Infinity where there is no (usable) window — unit
 *  tests stub partial window objects, and a NaN bound would poison geometry. */
function viewportW(): number {
  return typeof window !== 'undefined' && Number.isFinite(window.innerWidth) ? window.innerWidth : Infinity
}

function viewportH(): number {
  return typeof window !== 'undefined' && Number.isFinite(window.innerHeight) ? window.innerHeight : Infinity
}

/** Clamp free-window geometry: sizes respect the floor and the viewport, and
 *  the position keeps the whole window inside the viewport. Without a window
 *  (unit tests) only the floor applies — the caller's values pass through. */
export function clampFloatGeometry(x: number, y: number, w: number, h: number): Pick<FloatWindow, 'x' | 'y' | 'w' | 'h'> {
  const vw = viewportW()
  const vh = viewportH()
  const width = Math.round(Math.min(Math.max(w, FLOAT_MIN_W), Math.max(FLOAT_MIN_W, vw)))
  const height = Math.round(Math.min(Math.max(h, FLOAT_MIN_H), Math.max(FLOAT_MIN_H, vh)))
  return {
    x: Math.round(Math.min(Math.max(x, 0), Math.max(0, vw - width))),
    y: Math.round(Math.min(Math.max(y, 0), Math.max(0, vh - height))),
    w: width,
    h: height,
  }
}

/**
 * Float a docked tab: remove it from its pane (either tree; an emptied pane
 * collapses like any move) and append a free window centered on the drop
 * point, with the default size clamped to the viewport. The stacking order
 * is the array order, so a fresh window is born topmost. An unknown tab id
 * (or one already floating) is a strict no-op.
 */
export function floatTab(state: SidebarState, tabId: string, x: number, y: number): SidebarState {
  let source: SidebarLeaf | undefined
  let key: 'splits' | 'bottomSplits' | undefined
  for (const treeKey of ['splits', 'bottomSplits'] as const) {
    source = leafWithTab(state[treeKey], tabId)
    if (source !== undefined) { key = treeKey; break }
  }
  if (key === undefined || source === undefined) return state
  const tab = source.tabs.find(candidate => candidate.id === tabId)!
  let emptied = false
  let node = mapLeaf(state[key], source.id, (leaf) => {
    leaf.tabs = leaf.tabs.filter(candidate => candidate.id !== tabId)
    if (leaf.active === tabId) leaf.active = leaf.tabs[leaf.tabs.length - 1]?.id ?? null
    if (leaf.tabs.length === 0) emptied = true
  })
  if (emptied) node = removeLeafAt(node, source.id)
  // Phone-ratio default, capped to the viewport before centering so the
  // clamped position never leaves the window's bottom past the fold.
  const vw = viewportW()
  const vh = viewportH()
  const width = Math.min(FLOAT_DEFAULT_W, Math.max(FLOAT_MIN_W, vw - 24))
  const height = Math.min(FLOAT_DEFAULT_H, Math.max(FLOAT_MIN_H, vh - 24))
  const window = clampFloatGeometry(
    x - width / 2,
    y - height / 2,
    width,
    height,
  )
  const next: SidebarState = {
    ...state,
    [key]: node,
    floats: [...state.floats, { id: uid('float'), tab, ...window }],
  }
  // The pane the user was working in may have just collapsed with the tab.
  if (emptied && state.activePane === source.id) next.activePane = firstLeaf(next.splits).id
  return next
}

/** Move a free window (clamped to the viewport); unknown ids are a no-op. */
export function moveFloat(state: SidebarState, floatId: string, x: number, y: number): SidebarState {
  const float = floatById(state, floatId)
  if (float === undefined) return state
  const geo = clampFloatGeometry(x, y, float.w, float.h)
  if (geo.x === float.x && geo.y === float.y) return state
  return { ...state, floats: state.floats.map(f => (f.id === floatId ? { ...f, ...geo } : f)) }
}

/** Resize a free window from its SE corner: the top-left corner stays
 *  anchored, sizes clamp to the floor and to the viewport's remaining room. */
export function resizeFloat(state: SidebarState, floatId: string, w: number, h: number): SidebarState {
  const float = floatById(state, floatId)
  if (float === undefined) return state
  const vw = viewportW()
  const vh = viewportH()
  const width = Math.round(Math.min(Math.max(w, FLOAT_MIN_W), Math.max(FLOAT_MIN_W, vw - float.x)))
  const height = Math.round(Math.min(Math.max(h, FLOAT_MIN_H), Math.max(FLOAT_MIN_H, vh - float.y)))
  if (width === float.w && height === float.h) return state
  return { ...state, floats: state.floats.map(f => (f.id === floatId ? { ...f, w: width, h: height } : f)) }
}

/** Bring a free window to the top (the array's end). Already topmost (or the
 *  only window) returns the same reference — no persist churn on every click. */
export function raiseFloat(state: SidebarState, floatId: string): SidebarState {
  if (state.floats.length < 2) return state
  const index = state.floats.findIndex(f => f.id === floatId)
  if (index < 0 || index === state.floats.length - 1) return state
  const floats = [...state.floats]
  const [raised] = floats.splice(index, 1)
  floats.push(raised!)
  return { ...state, floats }
}

/** Dock a free window back into a pane (center merge): the tab joins the
 *  target pane and activates. `toPane` defaults to the active pane with the
 *  right tree's first leaf as the stale-id fallback (mirrors
 *  {@link openTabInActivePane}). Unknown window ids are a no-op. */
export function dockFloat(state: SidebarState, floatId: string, toPane?: string): SidebarState {
  const float = floatById(state, floatId)
  if (float === undefined) return state
  let targetId = toPane ?? state.activePane ?? firstLeaf(state.splits).id
  if (!allLeaves(state[treeOf(state, targetId)]).some(leaf => leaf.id === targetId)) {
    targetId = firstLeaf(state.splits).id
  }
  const targetKey = treeOf(state, targetId)
  return {
    ...state,
    floats: state.floats.filter(f => f.id !== floatId),
    activePane: targetId,
    [targetKey]: mapLeaf(state[targetKey], targetId, (leaf) => {
      leaf.tabs = [...leaf.tabs, float.tab]
      leaf.active = float.tab.id
    }),
  }
}

/** Close the free window holding a tab (the tab closes WITH the window —
 *  the caller fires the descriptor's onClose lifecycle). */
export function closeFloatByTab(state: SidebarState, tabId: string): SidebarState {
  if (!state.floats.some(f => f.tab.id === tabId)) return state
  return { ...state, floats: state.floats.filter(f => f.tab.id !== tabId) }
}

/** Prefix marking a tab id as an agent-owned terminal (suffix is the uuid). */
export const AGENT_TAB_PREFIX = 'agent:'

/** Whether a tab id refers to an agent-owned terminal. */
export function isAgentTabId(tabId: string): boolean {
  return tabId.startsWith(AGENT_TAB_PREFIX)
}

/** Extract the agent terminal uuid from an `agent:<uuid>` tab id. */
export function agentUuidOf(tabId: string): string {
  return tabId.slice(AGENT_TAB_PREFIX.length)
}

/** Build the sidebar tab id for one agent terminal uuid. */
export function agentTabId(uuid: string): string {
  return `${AGENT_TAB_PREFIX}${uuid}`
}

/**
 * Reconcile the sidebar's agent-terminal tabs with the host's live list.
 * The host pushes the current list of agent terminals (created by the model
 * through the `terminal_create` tool) over a dedicated WebSocket; this
 * reducer mirrors that list into tabs: new uuids get a tab, vanished uuids
 * lose theirs. The agent owns the lifetime — the user closing a tab sends a
 * WS close frame that kills the pty, which fires a change, which converges
 * the view. Idempotent: a no-op when the lists already match.
 * @param state - the current per-session sidebar state.
 * @param agentTerminals - the live agent terminal snapshots from the host.
 * @returns the next state (or the same reference if no change was needed).
 */
export function reconcileAgentTerminals(
  state: SidebarState,
  agentTerminals: ReadonlyArray<{ uuid: string; title: string }>,
): SidebarState {
  const existingTabs = allLeaves(state.splits).concat(allLeaves(state.bottomSplits)).flatMap(leaf => leaf.tabs)
    .concat(state.floats.map(float => float.tab))
  const existingAgentTabs = existingTabs.filter(tab => isAgentTabId(tab.id))
  const existingUuids = new Set(existingAgentTabs.map(tab => agentUuidOf(tab.id)))
  const serverUuids = new Set(agentTerminals.map(t => t.uuid))
  const toAdd = agentTerminals.filter(t => !existingUuids.has(t.uuid))
  // Pinned agent terminals (v0.17.0+) are EXEMPT from removal: the agent
  // closed them or the pty exited, but the user pinned them so the tab
  // stays as a disconnected surface. The xterm view's reconnect-failure
  // banner is the user-visible "disconnected" signal (the design's M3
  // convergence: no title suffix, no meta write — the tab keeps its uuid
  // so a later reconcile push revives it if the agent reopens the same one).
  const toRemove = existingAgentTabs.filter(tab => !serverUuids.has(agentUuidOf(tab.id)) && tab.pin === undefined)
  if (toAdd.length === 0 && toRemove.length === 0) return state
  // Remove tabs whose uuids vanished from the server list (the agent closed
  // them, or the pty exited and was reaped). Reuse closeTab's leaf cleanup;
  // a FLOATED agent terminal leaves with its window.
  let splits = state.splits
  let floats = state.floats
  for (const tab of toRemove) {
    const leaf = leafWithTab(splits, tab.id)
    if (leaf !== undefined) {
      splits = closeTab({ ...state, splits }, leaf.id, tab.id).splits
    }
    if (floats.some(float => float.tab.id === tab.id)) {
      floats = floats.filter(float => float.tab.id !== tab.id)
    }
  }
  // Add tabs for new uuids (the agent created a terminal). They land in the
  // active pane via openTabInActivePane; the next reconcile is a no-op for them.
  let next: SidebarState = { ...state, splits, floats }
  for (const terminal of toAdd) {
    const tab: SidebarTab = {
      id: agentTabId(terminal.uuid),
      type: 'terminal',
      title: terminal.title,
    }
    next = openTabInActivePane(next, tab)
  }
  return next
}

// ── The per-session store ──────────────────────────────────────────────────

const STORAGE_PREFIX = 'dsh-sidebar:v1'

/**
 * Cross-session panel width: the last dragged width, shared by EVERY
 * conversation (the panel width is a layout preference, not per-session
 * content). Written on every persist, read at session load and on
 * cache-hit session switches, so a drag in one conversation carries to all
 * the others (last drag wins).
 */
const GLOBAL_WIDTH_KEY = 'dsh-sidebar:v1:width'

/** Clamp one width to the contract and the current viewport (mirror of {@link setWidth}). */
function clampWidth(width: number): number {
  const max = typeof window !== 'undefined' ? Math.max(PANEL_MIN, window.innerWidth) : PANEL_MAX
  return Math.min(max, Math.max(PANEL_MIN, Math.round(width)))
}

/** Read the cross-session panel width (undefined when never dragged). */
function readGlobalWidth(): number | undefined {
  try {
    const raw = localStorage.getItem(GLOBAL_WIDTH_KEY)
    if (raw !== null) {
      const parsed = Number(raw)
      if (Number.isFinite(parsed) && parsed > 0) return clampWidth(parsed)
    }
  } catch {
    // Storage unavailable: fall back to the per-session behavior.
  }
  return undefined
}

/** Persist the cross-session panel width (best-effort, like the session states). */
function writeGlobalWidth(width: number): void {
  try {
    localStorage.setItem(GLOBAL_WIDTH_KEY, String(width))
  } catch {
    // Storage full or unavailable: layout memory is best-effort.
  }
}

/** Immutable snapshot handed to React (replaced only on real changes). */
export interface SidebarSnapshot {
  sessionId: string | undefined
  state: SidebarState | undefined
  /**
   * The current side card prefs. Carried IN the snapshot (not a separate
   * subscription) so prefs changes re-render the consumers that gate on
   * them — the + menu hides a tab type the moment its switch flips.
   */
  prefs: SidebarPrefs
}

/** Default panel width for one viewport: the prefs percent of the window,
 * clamped to the panel floor (a tiny percent must stay usable) and to the
 * viewport (a large one must never cover the whole window). */
export function defaultWidthFor(viewport: number, percent: number): number {
  return Math.min(viewport, Math.max(PANEL_MIN, Math.round(viewport * percent / 100)))
}

/**
 * URL escape hatch (#369): loading the app with `?dsh-sidebar-reset` drops
 * the persisted layout for the session instead of restoring it. When a
 * restored tab hangs the page on mount (the #369 freeze loop), reloading
 * into the same state replays the hang forever; this param starts from the
 * default layout and clears the stored copy, breaking the loop. Persisting
 * resumes as soon as the param is gone from the URL.
 */
const RESET_PARAM = 'dsh-sidebar-reset'

/** Whether the current page load asked for a persisted-state reset. */
function resetRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).has(RESET_PARAM)
  } catch {
    return false
  }
}

function loadState(sessionId: string, prefs: SidebarPrefs): SidebarState {
  const reset = resetRequested()
  if (reset) {
    try {
      localStorage.removeItem(`${STORAGE_PREFIX}:${sessionId}`)
      localStorage.removeItem(GLOBAL_WIDTH_KEY)
    } catch {
      // Storage unavailable: the default layout below is still the escape.
    }
  }
  // The panel width is a cross-session preference: the last dragged width
  // wins over a session's own persisted value, so switching conversations
  // keeps the width the user chose anywhere.
  const globalWidth = reset ? undefined : readGlobalWidth()
  if (!reset) {
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}:${sessionId}`)
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown
        // Seed the uid counter past the persisted ids (it resets on reload);
        // sanitize re-ids any duplicates the pre-seeding counter left behind.
        nextIdCounter = maxCounterId(parsed)
        const sanitized = sanitizeState(parsed)
        if (sanitized !== undefined) {
          return globalWidth === undefined ? sanitized : { ...sanitized, width: globalWidth }
        }
      }
    } catch {
      // Corrupt or unavailable storage: fall through to the default.
    }
  }
  // New sessions seed from the user's side card prefs: the width is the
  // chosen percent of the window (clamped to the panel floor and the
  // viewport so a huge percent can never crush the app shell), the panel
  // starts open only when the preference says so, and the seed tab is the
  // empty files window (tree panel open) in BOTH editorExplorer modes — a
  // disabled editor type seeds nothing. On a NARROW viewport a brand-new
  // session starts collapsed instead — the panel is a full-screen drawer
  // there, and auto-opening it on first paint would cover the conversation
  // before the user asked. Only the first seeding is affected: once the
  // user expands the drawer, `panelOpen: true` persists like any other
  // state.
  const viewport = typeof window !== 'undefined' ? window.innerWidth : undefined
  const width = globalWidth ?? (viewport === undefined
    ? PANEL_DEFAULT
    : defaultWidthFor(viewport, prefs.defaultWidthPercent))
  const openByDefault = prefs.openByDefault && (viewport === undefined || !isNarrowWidth(viewport))
  const seed: DefaultSeed = prefs.tabsEnabled['editor'] === false ? 'none' : 'editor-home'
  return makeDefaultState(width, openByDefault, seed)
}

/**
 * Structural validation of one persisted state. A malformed or stale shape
 * (older layouts, hand-edited storage) must fall back to the default instead
 * of crashing the panel on every reload; the restored width is also clamped
 * to the current viewport so a stale fullscreen width can never crush the
 * app shell (margin-right larger than the window) or cover the whole screen.
 * @returns a clean state, or undefined to fall back to the default.
 */
export function sanitizeState(parsed: unknown): SidebarState | undefined {
  if (parsed === null || typeof parsed !== 'object') return undefined
  const record = parsed as Record<string, unknown>
  if (typeof record.panelOpen !== 'boolean') return undefined
  if (typeof record.width !== 'number' || !Number.isFinite(record.width)) return undefined
  if (typeof record.nextTerminal !== 'number' || !Number.isInteger(record.nextTerminal) || record.nextTerminal < 1) {
    return undefined
  }
  // nextBrowser arrived in a later build; a missing or malformed value on an
  // OLDER persisted state defaults to 1 so existing layouts keep loading
  // (unlike nextTerminal, which is strict — it predates the v1 shape).
  const nextBrowser = typeof record.nextBrowser === 'number' && Number.isInteger(record.nextBrowser) && record.nextBrowser >= 1
    ? record.nextBrowser
    : 1
  if (typeof record.activePane !== 'string' && record.activePane !== null) return undefined
  if (!Array.isArray(record.expanded) || record.expanded.some(item => typeof item !== 'string')) return undefined
  // The seen/reid maps are SHARED across both trees: pane/split ids must be
  // globally unique (the runtime uid counter is shared too), so a duplicate
  // seen first in the right tree gets a fresh id when it reappears in the
  // bottom tree.
  const seen = new Set<string>()
  const reid = new Map<string, string>()
  const restoredSplits = sanitizeNode(record.splits, seen, reid)
  if (restoredSplits === undefined) return undefined
  const splits = pruneEmptyPanes(restoredSplits)
  // Bottom-panel fields arrived in a later build: a missing or malformed
  // value on an OLDER persisted state defaults (closed / default height /
  // empty pane) so existing layouts keep loading, like nextBrowser.
  const bottomOpen = record.bottomOpen === true
  // Cap the persisted height so the center column (the agent output area)
  // keeps at least PANEL_MIN tall (a stale full-height bottom panel from an
  // older build must never squeeze the conversation to zero).
  const maxHeight = typeof window !== 'undefined' ? window.innerHeight : Infinity
  const bottomCap = Math.max(BOTTOM_MIN, maxHeight - PANEL_MIN)
  const rawHeight = typeof record.bottomHeight === 'number' && Number.isFinite(record.bottomHeight)
    ? record.bottomHeight
    : BOTTOM_DEFAULT
  const bottomHeight = Math.min(bottomCap, Math.max(BOTTOM_MIN, Math.round(rawHeight)))
  const bottomSplits = pruneEmptyPanes(sanitizeNode(record.bottomSplits, seen, reid)
    ?? { kind: 'leaf' as const, id: uid('pane'), tabs: [], active: null })
  // Free windows arrived with the float feature: a missing field on an older
  // persisted state defaults to none (like the bottom-panel fields above).
  // Malformed ENTRIES drop individually — unlike the split trees, where
  // corruption resets the whole state, a bad window must not cost the user
  // their whole layout. Geometry clamps into the CURRENT viewport so a stale
  // off-screen window stays reachable; the window ids join the same
  // uniqueness set as the pane/split ids (the uid counter mints for both).
  const floats: FloatWindow[] = []
  if (Array.isArray(record.floats)) {
    for (const entry of record.floats) {
      if (entry === null || typeof entry !== 'object') continue
      const candidate = entry as Record<string, unknown>
      if (typeof candidate.id !== 'string' || seen.has(candidate.id)) continue
      const tab = sanitizePersistedTab(candidate.tab)
      if (tab === undefined || tab === 'diff') continue
      if (
        typeof candidate.x !== 'number' || !Number.isFinite(candidate.x)
        || typeof candidate.y !== 'number' || !Number.isFinite(candidate.y)
        || typeof candidate.w !== 'number' || !Number.isFinite(candidate.w)
        || typeof candidate.h !== 'number' || !Number.isFinite(candidate.h)
      ) continue
      seen.add(candidate.id)
      floats.push({ id: candidate.id, tab, ...clampFloatGeometry(candidate.x, candidate.y, candidate.w, candidate.h) })
    }
  }
  const requestedActivePane = typeof record.activePane === 'string'
    ? (reid.get(record.activePane) ?? record.activePane)
    : null
  const activePane = requestedActivePane === null
    ? null
    : treeHasId(splits, requestedActivePane) || treeHasId(bottomSplits, requestedActivePane)
      ? requestedActivePane
      : firstLeaf(splits).id
  const maxWidth = typeof window !== 'undefined' ? window.innerWidth : Infinity
  return {
    panelOpen: record.panelOpen,
    width: Math.max(PANEL_MIN, Math.min(record.width, maxWidth)),
    // A stale duplicate pane id may have been re-ided; follow the rename so
    // new tabs still land in the pane the user was using.
    activePane,
    nextTerminal: record.nextTerminal,
    nextBrowser,
    expanded: record.expanded as string[],
    revealed: [],
    splits,
    bottomOpen,
    bottomHeight,
    // An older persisted state never expanded the bottom panel (the field
    // arrived later): defaulting to false gives it the first-expansion
    // auto-terminal exactly once after the upgrade.
    bottomOpenedOnce: record.bottomOpenedOnce === true,
    bottomSplits,
    floats,
  }
}

/** Collapse persisted split panes left empty after ephemeral diff tabs are dropped. */
function pruneEmptyPanes(node: SplitNode): SplitNode {
  const leaves = allLeaves(node)
  if (!leaves.some(leaf => leaf.tabs.length > 0)) return node
  return leaves.reduce(
    (tree, leaf) => leaf.tabs.length === 0 ? removeLeafAt(tree, leaf.id) : tree,
    node,
  )
}

/**
 * One tree node id, deduplicated against the ids already seen in this
 * state. Duplicates are exactly the pre-seeding counter-reset corruption
 * (a "pane:1"/"split:1" minted after a reload beside the persisted ones):
 * keeping both would make mapLeaf visit two leaves at once and every open
 * would land in both panes, so the repeat gets a fresh id.
 * @returns the id to use (the original, or a fresh uid for repeats).
 */
function uniqueNodeId(id: string, seen: Set<string>, reid: Map<string, string>): string {
  if (!seen.has(id)) {
    seen.add(id)
    return id
  }
  const prefix = /^split:\d+$/.test(id) ? 'split' : 'pane'
  const fresh = uid(prefix)
  seen.add(fresh)
  reid.set(id, fresh)
  return fresh
}

/**
 * Validate one persisted tab record. @returns the clean tab, `'diff'` for an
 * ephemeral diff tab (dropped everywhere — diff tabs never survive a reload),
 * or undefined when the record is malformed (structural corruption when it
 * comes from a split-tree leaf; a malformed FLOAT tab only drops the window).
 */
function sanitizePersistedTab(tab: unknown): SidebarTab | 'diff' | undefined {
  if (tab === null || typeof tab !== 'object') return undefined
  const candidate = tab as Record<string, unknown>
  if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string') return undefined
  if (candidate.type === 'diff') return 'diff'
  // Tab types are an open set (external plugins register their own); accept
  // any string type here — an unregistered type renders an <OrphanedTab/> at
  // view time and recovers if its plugin loads later.
  if (typeof candidate.type !== 'string') return undefined
  // The standalone explorer tab type merged INTO the editor (the single
  // files window): a persisted explorer tab reopens as an editor home tab —
  // no path, tree panel open (an existing meta object survives).
  if (candidate.type === 'explorer') {
    const meta = candidate.meta !== null && typeof candidate.meta === 'object' && !Array.isArray(candidate.meta)
      ? candidate.meta as Record<string, unknown>
      : undefined
    return { id: candidate.id, type: 'editor', title: 'Files', meta: { treeOpen: true, ...meta } }
  }
  // `meta` is plugin-owned JSON-serializable state (v0.12.0+): the persisted
  // value already went through JSON.parse, so it is inherently serializable —
  // carry it through verbatim (absent on older states).
  const result: SidebarTab = {
    id: candidate.id,
    type: candidate.type,
    title: candidate.title,
    ...(typeof candidate.path === 'string' ? { path: candidate.path } : {}),
    ...(candidate.meta !== undefined ? { meta: candidate.meta } : {}),
  }
  // `pin` (v0.17.0+): a pinned-terminal marker. Whitelist-validate the
  // shape so a hand-edited / corrupted pin never crashes the rail's
  // resolver: an unknown scope or a non-string homeCwd drops the pin
  // silently (the tab survives, just unpinned — the legacy behavior).
  // Pin is terminal-only: a non-terminal tab carrying a persisted pin
  // (e.g. from a hand-edited state) has it stripped here.
  const pin = (candidate as Record<string, unknown>).pin
  if (pin !== null && typeof pin === 'object' && !Array.isArray(pin) && result.type === 'terminal') {
    const pinRecord = pin as Record<string, unknown>
    if (pinRecord.scope === 'workspace' || pinRecord.scope === 'global') {
      const homeCwd = pinRecord.homeCwd
      result.pin = homeCwd === undefined || typeof homeCwd === 'string'
        ? { scope: pinRecord.scope, ...(typeof homeCwd === 'string' ? { homeCwd } : {}) }
        : { scope: pinRecord.scope }
    }
  }
  return result
}

/** Validate one split-tree node (leaf or split) and rebuild it cleanly. */
function sanitizeNode(node: unknown, seen: Set<string>, reid: Map<string, string>): SplitNode | undefined {
  if (node === null || typeof node !== 'object') return undefined
  const record = node as Record<string, unknown>
  if (record.kind === 'leaf') {
    if (typeof record.id !== 'string' || !Array.isArray(record.tabs)) return undefined
    const tabs: SidebarTab[] = []
    let droppedDiff = false
    for (const tab of record.tabs) {
      const clean = sanitizePersistedTab(tab)
      if (clean === undefined) return undefined
      if (clean === 'diff') {
        droppedDiff = true
        continue
      }
      tabs.push(clean)
    }
    const active = typeof record.active === 'string' ? record.active : null
    // An active pointer into a dropped diff tab is expected after the drop;
    // any other missing active is structural corruption → reset the state.
    if (active !== null && !tabs.some(tab => tab.id === active) && !droppedDiff) return undefined
    return { kind: 'leaf', id: uniqueNodeId(record.id, seen, reid), tabs, active: active !== null && tabs.some(tab => tab.id === active) ? active : null }
  }
  if (record.kind === 'split') {
    if (typeof record.id !== 'string' || (record.dir !== 'row' && record.dir !== 'col')) return undefined
    if (!Array.isArray(record.children) || !Array.isArray(record.sizes)) return undefined
    const children: SplitNode[] = []
    for (const child of record.children) {
      const clean = sanitizeNode(child, seen, reid)
      if (clean === undefined) return undefined
      children.push(clean)
    }
    if (children.length < 2) return undefined
    if (
      record.sizes.length !== children.length
      || record.sizes.some(size => typeof size !== 'number' || !Number.isFinite(size) || size <= 0)
    ) {
      return undefined
    }
    return { kind: 'split', id: uniqueNodeId(record.id, seen, reid), dir: record.dir, sizes: record.sizes as number[], children }
  }
  return undefined
}

/** The session-scoped store: one state per conversation, localStorage-backed. */
export class SidebarStore {
  private readonly bySession = new Map<string, SidebarState>()
  private snapshot: SidebarSnapshot = {
    sessionId: undefined,
    state: undefined,
    prefs: { ...SIDEBAR_PREFS_DEFAULTS },
  }
  private readonly listeners = new Set<() => void>()
  /** Per-session persist debounce timers (v0.12.0+: one per session, so a
   *  targeted open never cancels another session's pending write). */
  private readonly persistTimers = new Map<string, number>()
  /** User-facing side card prefs seeding brand-new session states (defaults until the settings RPC resolves). */
  private prefs: SidebarPrefs = { ...SIDEBAR_PREFS_DEFAULTS }
  /**
   * External disable (the dsh-web-ui family's aionui-panel provider choice):
   * while true the sidebar must not mount at all. Not part of the snapshot —
   * nothing renders on it; the mount gate and the intercept predicates read
   * it directly.
   */
  private suspended = false

  /**
   * Set the external-disable flag (from the settings route) and remember it
   * for the mount gate and the intercept predicates.
   */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended
  }

  /** Whether the sidebar is externally disabled (aionui-panel chosen). */
  getSuspended(): boolean {
    return this.suspended
  }

  /**
   * Replace the side card prefs (the settings RPC result / settings page
   * write). Notifies like any store change: the snapshot carries the prefs,
   * so consumers that gate on enable switches (the + menu, derived flows)
   * re-render with the new values immediately.
   */
  setPrefs(prefs: SidebarPrefs): void {
    this.prefs = { ...prefs }
    this.snapshot = { ...this.snapshot, prefs: this.prefs }
    this.notify()
  }

  /** The current side card prefs (seeds new sessions; persisted states win). */
  getPrefs(): SidebarPrefs {
    return { ...this.prefs }
  }

  /** Select a session (or none); loads its persisted state. */
  setSession(sessionId: string | undefined): void {
    if (this.snapshot.sessionId === sessionId) return
    if (sessionId === undefined) {
      this.snapshot = { sessionId: undefined, state: undefined, prefs: this.prefs }
    } else {
      let state = this.bySession.get(sessionId)
      if (state === undefined) {
        state = loadState(sessionId, this.prefs)
        this.bySession.set(sessionId, state)
      } else {
        // Cache hit: another session's load/ops may have left the uid
        // counter below THIS session's persisted ids — re-seed so fresh
        // pane/split ids can never collide with its tree.
        nextIdCounter = maxCounterId(state)
        // The panel width is cross-session: adopt the latest dragged width
        // (a cached session keeps its own layout otherwise).
        const globalWidth = readGlobalWidth()
        if (globalWidth !== undefined && state.width !== globalWidth) {
          state = { ...state, width: globalWidth }
          this.bySession.set(sessionId, state)
        }
      }
      this.snapshot = { sessionId, state, prefs: this.prefs }
    }
    this.notify()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot(): SidebarSnapshot {
    return this.snapshot
  }

  /** Mutate the current session's state (no-op without a session). */
  update(mutator: (draft: SidebarState) => void): void {
    const sessionId = this.snapshot.sessionId
    const state = this.snapshot.state
    if (sessionId === undefined || state === undefined) return
    const draft = structuredClone(state)
    mutator(draft)
    this.bySession.set(sessionId, draft)
    this.snapshot = { sessionId, state: draft, prefs: this.prefs }
    this.schedulePersist(sessionId, draft)
    this.notify()
  }

  /**
   * Whether a tab still exists in its session's state. Views use this on
   * unmount to tell "the tab was closed" (release the terminal now) from
   * "the tree re-rendered / the conversation switched" (the tab is still
   * open — keep the terminal alive through the host's reconnect grace).
   * Checks the session's own map entry (the current snapshot may already
   * point at another session when a conversation switch unmounts the old
   * one's tabs).
   */
  tabOpen(sessionId: string, tabId: string): boolean {
    const state = this.bySession.get(sessionId)
      ?? (this.snapshot.sessionId === sessionId ? this.snapshot.state : undefined)
    return state !== undefined && tabOpenIn(state, tabId)
  }

  /**
   * Read-only view of EVERY cached session's state (v0.17.0+). The
   * PinnedRail uses this to collect pinned terminals across sessions
   * without each render reading private fields. The map is the live
   * `bySession` reference — callers MUST treat it as read-only (mutations
   * go through {@link reduce} / {@link reduceFor}). A session that has
   * never been visited in this run is absent (its pinned tabs are not
   * visible until first load — accepted as YAGNI by the design).
   */
  getSessionStates(): ReadonlyMap<string, SidebarState> {
    return new Map(this.bySession)
  }

  /** Apply a pure reducer (returns the next state). */
  reduce(reducer: (state: SidebarState) => SidebarState): void {
    const sessionId = this.snapshot.sessionId
    const state = this.snapshot.state
    if (sessionId === undefined || state === undefined) return
    const next = reducer(state)
    // A reducer returning the SAME reference means "no change": skip the
    // persist + notify entirely — strict no-op paths (unknown tab ids,
    // patchTab on a missing tab) must not churn the state or rewrite
    // localStorage.
    if (next === state) return
    this.bySession.set(sessionId, next)
    this.snapshot = { sessionId, state: next, prefs: this.prefs }
    this.schedulePersist(sessionId, next)
    this.notify()
  }

  /**
   * Apply a pure reducer to a TARGET session's state (not the active one),
   * loading it on demand and persisting the result — WITHOUT switching the
   * active snapshot or notifying (the UI must not follow along). Used by the
   * service's targeted `openTab(seed, scope)`: the open lands in the target
   * session's layout and is visible whenever the user switches to it.
   */
  reduceFor(sessionId: string, reducer: (state: SidebarState) => SidebarState): void {
    // The uid counter is SHARED across sessions, and the ACTIVE session's
    // safety requires it to never drop below the ids IT minted. Seeding it
    // from the target's max may LOWER it (a cached target older than the
    // active session): restoring the pre-call level afterwards keeps the
    // active session's next mint collision-free — ids minted for the target
    // only need to exceed the target's own max, which the seed guaranteed.
    const counterBefore = nextIdCounter
    let state = this.bySession.get(sessionId)
    if (state === undefined) {
      state = loadState(sessionId, this.prefs)
      this.bySession.set(sessionId, state)
    } else {
      // Re-seed the uid counter past THIS session's persisted ids, exactly
      // like setSession's cache-hit path.
      nextIdCounter = maxCounterId(state)
    }
    const next = reducer(state)
    // Same-reference result = no change: keep the counter restore (it may
    // have been seeded down) but skip the write.
    nextIdCounter = Math.max(nextIdCounter, counterBefore)
    if (next === state) return
    this.bySession.set(sessionId, next)
    this.schedulePersist(sessionId, next)
  }

  private schedulePersist(sessionId: string, state: SidebarState): void {
    // Keep the cross-session width in sync: any width change (drag, fullscreen
    // toggle) on the ACTIVE session becomes the shared width for every
    // conversation. A targeted open persists an INACTIVE session (reduceFor)
    // and must not clobber that global — its width is stale by definition,
    // so writing it would break "last drag wins".
    if (sessionId === this.snapshot.sessionId) {
      writeGlobalWidth(state.width)
    }
    // Per-session debounce timers: one session's pending write must never
    // cancel another's (targeted opens schedule writes for INACTIVE
    // sessions while the active session may already have one pending —
    // a shared timer would drop the earlier write and the reload would
    // lose that session's layout).
    const existing = this.persistTimers.get(sessionId)
    if (existing !== undefined) window.clearTimeout(existing)
    const timer = window.setTimeout(() => {
      this.persistTimers.delete(sessionId)
      try {
        localStorage.setItem(`${STORAGE_PREFIX}:${sessionId}`, JSON.stringify(state))
      } catch {
        // Storage full or unavailable: layout memory is best-effort.
      }
    }, 200)
    this.persistTimers.set(sessionId, timer)
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

/**
 * Create one sidebar store instance. Production code calls this only from
 * the client plugin's `apply` (the instance is handed to components as a
 * prop); tests call it directly. No module-level singleton: the store's
 * lifetime belongs to the plugin activation, exactly like the official
 * `createXXXStore()` factory rule.
 */
export function createSidebarStore(): SidebarStore {
  return new SidebarStore()
}
