const DEFAULT_SESSION_LIST = { current: undefined, byId: {} }
const DEFAULT_SIDEBAR_SNAPSHOT: SidebarSnapshot = {
  sessionId: undefined,
  state: undefined,
  prefs: SIDEBAR_PREFS_DEFAULTS,
}
/**
 * The sidebar shell: panels mounted inside the unified panel host — a
 * fixed, viewport-sized containing block ([data-dsh-panel-host]) appended
 * to document.body — instead of individual fixed-position elements, so a
 * desktop shell's intermediate wrapper transforms can never hijack the
 * panels' fixed containing block (the core AppFrame owns the left sidebar /
 * center / details columns and has no right-side hole for plugins). The
 * right panel hosts the original workbench; the bottom panel hosts a
 * second, independent workbench. The bottom panel squeezes ONLY the center
 * column (the agent output area): it spans from the app shell's own left
 * sidebar to the right panel's left edge, so neither sidebar gives up any
 * position (the right panel keeps its full height). A persistent two-button
 * cluster at the top-right corner toggles each panel; the right panel's
 * width drags from its left edge, the bottom panel's height from its top
 * edge, and the shared corner drags both at once. The whole layout lives in
 * the per-session store, so switching conversations swaps the sidebar.
 *
 * The shell binds the workbench actions to the store and dispatches tab
 * content to the views. New tabs come from the + menu (explorer / git /
 * terminal; editors open from the explorer). Tabs live in one tree only —
 * they never cross panels; only the panel sizes drag against each other.
 *
 * Narrow (mobile, <768px) viewports show ONLY the right sidebar: entering
 * narrow migrates the bottom panel's tabs INTO the right tree
 * (migrateBottomTabs) — one workbench, the bottom tabs thrown into its
 * strips. The right panel becomes a full-width drawer, the bottom panel
 * and its toggle button disappear, and the layout push is disabled (the
 * drawer floats). Widening does not migrate back: the tabs keep living in
 * the right tree.
 */
import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { IconCloseFill14, Tooltip } from "./ui-primitives"
import type { Context, SidebarSessionList } from './context-types'
import { appendToDraft } from './conversation-draft'
import {
  BOTTOM_MIN, PANEL_MIN, activateTab, agentUuidOf, allLeaves, closeFloatByTab, closeTab, dockFloat, firstLeaf, floatTab,
  floatWithTab, isAgentTabId, leafWithTab, migrateBottomTabs,
  moveFloat, moveTab, moveTabToEdge, openDiffTab, openTabInActivePane, raiseFloat, reconcileAgentTerminals,
  resizeFloat, resizeSplitIn, setBottomHeight, setTabPin, setWidth, toggleBottomPanel, toggleExpanded, togglePanel,
  type DropZone, type SidebarSnapshot, type SidebarState, type SidebarStore, type SidebarTab, type SplitNode,
} from './state'
import { SIDEBAR_PREFS_DEFAULTS } from './prefs-shared'
import { collectPinnedTabs, createPinnedVirtualTab, getPinnedHomeScope, injectPinnedIntoTree, isPinnedVirtualId, isPinnedVirtualTab, parsePinnedVirtualId, type PinnedTabEntry } from './pinned'
import { IconPinOutline16 } from './icons'
import { IconPanelBottomOutline16, IconPanelRightOutline16 } from './icons'
import { Workbench, type WorkbenchActions } from './split-pane'
import { isNarrowWidth, useViewportSize } from './breakpoints'
import { layoutPushSize } from './layout-push'
import { parseDesktopEnv } from './desktop-env'
import { WCO_NONE, getWcoSnapshot, subscribeWco } from './wco'
import { getShellPreset } from './shell-presets'
import { computeTitleBarStrip } from './titlebar-strip'
import type { NewTabOption } from './TabBar'
import { TAB_DRAG_TYPE, parseDrag, type TabDragPayload } from './TabBar'
import { FreeWindow } from './FreeWindow'
import { relativeTo } from './paths'
import { OrphanedTab } from './OrphanedTab'
import { RenderBoundary } from './RenderBoundary'
import { tabContentCompare, type TabContentMemoKey } from './tab-content-memo'
import { detectNewDirectSubagent } from './subagent-detect'
import { detectNewJob } from './subagent-jobs'
import { t } from './locales'
import { api, type SessionScope } from './api'
import css from './sidebar.module.css'

/** How many consecutive reconnect failures stop the agent-terminals push loop
 * (mirror of the terminal view's own cap; the loop restarts on session switch). */
const FAILURE_LIMIT = 3

/**
 * Subagent auto-open debounce (ms). The host delivers a new child's origin
 * and its title in SEPARATE frames: a Side Chat thread's first visible
 * frame still shows a fallback title (no 'Side: ' prefix), so an immediate
 * 0→N decision mistakes it for a genuine subagent and pops the task page.
 * The trigger therefore re-evaluates against the live snapshot once the
 * title frame has had time to land.
 */
const AUTO_OPEN_DEBOUNCE_MS = 500

/**
 * OS file drags over the sidebar belong to the sidebar, not to the chat:
 * DSH's composer (InputBar) listens for file drags on the DOCUMENT and
 * answers with a full-screen "drop image here" mask plus image intake on
 * drop. Both panel-host render sites swallow the whole event quartet —
 * enter/over/leave/drop — so the region is a black hole to that document
 * listener. All four must be stopped: InputBar keeps an enter/leave depth
 * counter, and a leave that escapes without its matching enter unbalances
 * the count (this was the full-screen mask flickering over the sidebar).
 * The conversation column keeps DSH's native overlay and intake untouched;
 * gated on the 'Files' type so in-app drags (tab reorder, split zones)
 * propagate exactly as before.
 */
const swallowOsFileDrag = (event: ReactDragEvent): void => {
  if (!(event.dataTransfer?.types.includes('Files') ?? false)) return
  event.preventDefault()
  event.stopPropagation()
}

/** The four drag events a file drag must never carry past the panel host. */
const osFileDragShield = {
  onDragEnter: swallowOsFileDrag,
  onDragOver: swallowOsFileDrag,
  onDragLeave: swallowOsFileDrag,
  onDrop: swallowOsFileDrag,
}

/**
 * Append one user-space stylesheet (preset or custom CSS) as a tagged
 * `<style>` element. The tag attribute carries the source identity so the
 * running configuration is inspectable in DevTools; the returned tag is
 * removed by the caller's effect cleanup.
 */
function injectUserCss(attr: string, id: string, cssText: string): HTMLStyleElement {
  const tag = document.createElement('style')
  tag.setAttribute(attr, id)
  tag.textContent = cssText
  document.head.appendChild(tag)
  return tag
}

/** Props of one tab's content cell = the memo key (tab-content-memo.ts) plus
 *  the runtime objects/callbacks the cell renders with. The memo comparator
 *  is the pure `tabContentCompare`; anything in the key decides a re-render
 *  must propagate, anything outside it must be a stable object (ctx/store)
 *  or covered by a compared field (paneId covers onOpenDiff's captured
 *  pane; sessionId/cwd cover onReferenceFile). */
interface TabContentProps extends TabContentMemoKey {
  onToggleDir: (path: string) => void
  onReferenceFile: (path: string) => void
  ctx: Context
  store: SidebarStore
  /** Fired before a topology node jumps to its child session (see Sidebar). */
  onSubagentJump: (childSessionId: string) => void
  /** Open a diff tab from the git panel (placement handled by the store). */
  onOpenDiff: (tab: SidebarTab) => void
}

/** Render the content of one tab (dispatched by type). */
const TabContent = memo(function TabContent(props: TabContentProps) {
  const { tab, effectiveTabId, sessionId, cwd, expanded, revealed, onToggleDir, onReferenceFile, ctx, store, visible, onSubagentJump, onOpenDiff } = props
  const scope = { sessionId, cwd }
  const descriptor = ctx.get('betterSidebar')?.getTab(tab.type)
  if (descriptor === undefined) {
    return <OrphanedTab ctx={ctx} store={store} scope={scope} tab={tab} visible={visible} />
  }
  // For pinned virtual tabs, the tab descriptor's component (e.g. TerminalView)
  // must receive the ORIGINAL tab id so it connects to the home session's PTY.
  // The virtual tab's own id is a unique display key (prefixed); effectiveTabId
  // restores the real id at the component boundary.
  const componentTab = effectiveTabId !== undefined ? { ...tab, id: effectiveTabId } : tab
  return createElement(
    RenderBoundary,
    { className: css.tabBoundaryError },
    createElement(descriptor.component, {
      ctx, store, scope, tab: componentTab, visible, expanded, revealed,
      onToggleDir, onReferenceFile, onOpenDiff, onSubagentJump,
    }),
  )
}, tabContentCompare)

/** The + menu options for the current state, driven by the tab registry.
 * Hidden tabs (editor/diff) never show; `available` returning false shows
 * a disabled row (e.g. terminal at capacity) instead of hiding the option.
 * Tabs the user disabled in the side card settings are filtered out
 * entirely — re-enabling them is the settings page's job. */
function buildNewTabOptions(state: SidebarState, ctx: Context, scope: SessionScope): NewTabOption[] {
  const service = ctx.get('betterSidebar')
  if (service === undefined) return []
  return service.getTabs()
    .filter((d: any) => !d.hidden && service.isTabEnabled(d.id))
    .sort((a: any, b: any) => (a.order ?? 100) - (b.order ?? 100))
    .map((d: any) => ({
      id: d.id,
      label: typeof d.title === 'function' ? d.title() : d.title,
      disabled: !(d.available?.(ctx, scope, state) ?? true),
      icon: typeof d.icon === 'function' ? d.icon(16) : d.icon,
    }))
}

export function Sidebar(props: { ctx: Context; store: SidebarStore; embedded?: boolean }) {
  const { ctx, store, embedded = false } = props
  // Stable ref so useSyncExternalStore closures never capture a stale ctx.
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  // Copy freshness: re-render the whole tree when the DSH locale switches.
  // The module-level t() reads the active locale at call time, so a root
  // re-render alone re-localizes every panel (no memo barriers below).
  const localeRevision = useSyncExternalStore(
    useMemo(() => (callback: () => void) => {
      const loc = ctxRef.current?.locale;
      return typeof loc?.subscribe === 'function' ? (loc.subscribe(callback) ?? (() => {})) : (() => {});
    }, []),
    useCallback(() => {
      const loc = ctxRef.current?.locale;
      return typeof loc?.getSnapshot === 'function' ? (loc.getSnapshot()?.active ?? "zh") : "zh";
    }, []),
    () => "zh",
  )
  void localeRevision

  // better-locale override freshness: when @huanlin/dsh-plugin-better-locale
  // is installed and the user picks an override language (e.g. ja), the
  // store's `active` changes but the DSH locale's `active` does NOT —
  // better-locale keeps the dsh active value (zh/en) unchanged and only
  // patches `LocaleRuntime.prototype.lookup`. The localeRevision uSES
  // above reads `getSnapshot().active`, so it sees no change and skips
  // re-render. This second uSES reads the better-locale store's `active`
  // directly, so an override switch fires a full re-render and t() picks
  // up the new override text. Optional: ctx.get returns undefined when
  // better-locale is absent (or when ctx is a minimal test mock without
  // a `get` method), in which case this is a no-op uSES.
  type BetterLocaleStore = {
    readonly active: string | undefined
    subscribe(listener: () => void): () => void
  }
  const betterLocaleStore = typeof ctx.get === 'function'
    ? (ctx as unknown as {
        get(name: 'betterLocale'): BetterLocaleStore | undefined
      }).get('betterLocale')
    : undefined
  const betterLocaleActive = useSyncExternalStore(
    useMemo(() => {
      const store = betterLocaleStore
      if (store === undefined) return (_cb: () => void) => () => {}
      return (callback: () => void) => store.subscribe(callback)
    }, [betterLocaleStore]),
    () => betterLocaleStore?.active,
    () => undefined,
  )
  void betterLocaleActive

  // Tab-registry revision: TabContent memo cells must pick up a descriptor
  // a plugin registers/disposes after mount (the + menu / icons already read
  // the registry at render). Rare events (plugin (un)mount), so one full
  // re-render per change is fine — this is what keeps the memoized cells
  // from going stale, mirroring the localeRevision mechanism above.
  const [tabsVersion, setTabsVersion] = useState(0)
  useEffect(() => {
    const service = ctx.get('betterSidebar')
    if (service === undefined) return
    return service.subscribe(() => setTabsVersion(version => version + 1))
  }, [ctx])

  // Narrow (mobile) viewports collapse the two panels into one: the right
  // panel becomes a full-width drawer holding BOTH workbenches, the bottom
  // panel (and its toggle button) disappears, and the layout push is
  // disabled (the drawer floats over the app shell). Entering narrow
  // MIGRATES the bottom tree's tabs into the right tree (migrateBottomTabs)
  // — the merged display is the right sidebar alone, the bottom tabs thrown
  // into its strips. Widening never rewrites the migrated state: the tabs
  // keep living in the right tree.
  const viewport = useViewportSize()
  const narrow = isNarrowWidth(viewport.width)

  // On-screen keyboard / visual-viewport inset (mobile, split-screen, …):
  // when the visual viewport shrinks below the layout viewport, bottom-
  // anchored panels would hide under the keyboard. Track the inset and
  // offset the bottom-anchored surfaces by it. The obscured bottom strip is
  // innerHeight − (vv.height + vv.offsetTop): offsetTop is nonzero while
  // the visual viewport is scrolled/zoomed under browser chrome, so
  // omitting it would over-lift the panels (CR #232 P2). offsetTop changes
  // through the viewport's scroll event too, so both events are listened.
  // Guarded: browsers without visualViewport (older WebViews, jsdom) stay
  // at 0. rAF-throttled, same pattern as useNarrowViewport.
  const [keyboardInset, setKeyboardInset] = useState(0)
  const [visualViewportHeight, setVisualViewportHeight] = useState<number | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (vv === null || vv === undefined) return
    let frame: number | null = null
    const measure = (): void => {
      frame = null
      const inset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop))
      setKeyboardInset(inset > 1 ? Math.round(inset) : 0)
      setVisualViewportHeight(Math.max(0, Math.round(vv.height)))
    }
    const onResize = (): void => { if (frame === null) frame = requestAnimationFrame(measure) }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    measure()
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [])
  // The bottom panel is offset above the on-screen keyboard. Cap its height
  // against that same visible area, not the taller layout viewport, so the
  // conversation keeps PANEL_MIN even on wide touch devices.
  const layoutViewportHeight = visualViewportHeight ?? viewport.height

  // Current conversation (the sessions list feed).
  // The store is accessed via ctxRef at call time and the chain is dereferenced
  // exactly once per call. This removes the check‑then‑act pattern that could
  // throw "Cannot read properties of undefined (reading 'getSnapshot')" when a
  // new ctx is swapped between the test and the read.
  const subscribeSessions = useMemo(() => (callback: () => void) => {
    const list = ctxRef.current?.sessions?.list;
    // uSES requires subscribe to return a cleanup function; fall back to a
    // no‑op if the store is missing or does not expose subscribe.
    return typeof list?.subscribe === 'function' ? (list.subscribe(callback) ?? (() => {})) : (() => {});
  }, []);
  const getSessionListSnapshot = useCallback(() => {
    const list = ctxRef.current?.sessions?.list;
    return typeof list?.getSnapshot === 'function'
      ? (list.getSnapshot() ?? DEFAULT_SESSION_LIST)
      : DEFAULT_SESSION_LIST;
  }, []);
  const sessionList = useSyncExternalStore(subscribeSessions, getSessionListSnapshot, getSessionListSnapshot);

  const current = sessionList.current

  // Per-session sidebar state.
  const snapshot = useSyncExternalStore(
    useCallback((callback: () => void) => {
      return typeof store?.subscribe === 'function' ? (store.subscribe(callback) ?? (() => {})) : (() => {})
    }, [store]),
    useCallback(() => store?.getSnapshot?.() ?? DEFAULT_SIDEBAR_SNAPSHOT, [store]),
    () => store?.getSnapshot?.() ?? DEFAULT_SIDEBAR_SNAPSHOT,
  )
  useEffect(() => { store?.setSession?.(current) }, [current, store])

  const state = snapshot.state
  const sessionId = snapshot.sessionId
  const summaryCwd = sessionId === undefined ? undefined : sessionList.byId[sessionId]?.cwd
  const pushedBottomHeight = (bottomOpen: boolean, bottomHeight: number): number => layoutPushSize({
    narrow,
    panelOpen: false,
    bottomOpen,
    width: 0,
    bottomHeight,
    viewportWidth: viewport.width,
    viewportHeight: layoutViewportHeight,
  }).height

  // The collapsed toggle cluster reclaims the top-right corner, so the DSH
  // session header's right-aligned utilities (the "Session log" download
  // capsule) must yield. layout.css keys off this body attribute to push the
  // header's right padding out past the cluster. Only the CLOSED panel needs
  // it — an open panel already squeezes `#root` left, moving the header clear.
  const collapsed = state === undefined || !state.panelOpen
  useEffect(() => {
    if (collapsed) document.body.setAttribute('data-dsh-sidebar-collapsed', '')
    else document.body.removeAttribute('data-dsh-sidebar-collapsed')
    return () => { document.body.removeAttribute('data-dsh-sidebar-collapsed') }
  }, [collapsed])

  // Title-bar / shell compatibility (the "位置兼容模式" scheme):
  //   auto    — CONSERVATIVE: only the standard Window Controls Overlay
  //             geometry contributes (the real caption-overlay height,
  //             reactive to maximize/restore). No URL stamp, no preset, no
  //             guess — plain browsers see zero modification.
  //   preset  — an opt-in built-in shell preset (shell-presets.ts) adds its
  //             per-shell strip as the no-WCO fallback.
  //   custom  — the user's own CSS (injected below) + the legacy manual
  //             strip px.
  // The resolved strip drives the SAME body attribute + CSS variable as the
  // legacy boolean did, so the CSS contract is unchanged (layout.css /
  // sidebar.module.css); only the value source changed. The cleanup removes
  // both on unmount/boundary swap so a crashed sidebar never leaves them
  // behind.
  const desktopEnv = parseDesktopEnv()
  const wco = useSyncExternalStore(
    useMemo(() => subscribeWco, []),
    getWcoSnapshot,
    () => WCO_NONE,
  )
  const scheme = snapshot.prefs.titleBarScheme
  const preset = scheme === 'preset' ? getShellPreset(snapshot.prefs.titleBarPresetId) : undefined
  const titleBarStrip = computeTitleBarStrip(
    desktopEnv, wco, scheme, preset, snapshot.prefs.titleBarStripPx,
  )
  const titleBarCompat = titleBarStrip > 0
  useEffect(() => {
    const root = document.documentElement
    if (titleBarCompat) {
      document.body.setAttribute('data-dsh-title-bar-compat', '')
      root.style.setProperty('--dsh-title-bar-strip', `${titleBarStrip}px`)
    } else {
      document.body.removeAttribute('data-dsh-title-bar-compat')
      root.style.removeProperty('--dsh-title-bar-strip')
    }
    return () => {
      document.body.removeAttribute('data-dsh-title-bar-compat')
      root.style.removeProperty('--dsh-title-bar-strip')
    }
  }, [titleBarCompat, titleBarStrip])

  // User-space CSS injection (the escape hatch): preset CSS (scheme
  // `preset`) and free-form custom CSS (scheme `custom`) are appended AFTER
  // the plugin's own styles — later in the cascade wins ties, and
  // `!important` can override the JS-written inline strip variable. Each
  // source gets its own tagged <style> so the running configuration stays
  // inspectable; tags are removed on change/unmount so a stale stylesheet
  // never outlives its fiber (HMR-safe).
  const presetCss = scheme === 'preset' ? preset?.css ?? '' : ''
  const customCss = scheme === 'custom' ? snapshot.prefs.customCss : ''
  useEffect(() => {
    const tags: HTMLStyleElement[] = []
    if (presetCss !== '') tags.push(injectUserCss('data-dsh-preset-css', preset?.id ?? '', presetCss))
    if (customCss !== '') tags.push(injectUserCss('data-dsh-custom-css', 'custom', customCss))
    return () => { for (const tag of tags) tag.remove() }
  }, [presetCss, customCss, preset?.id])

  /**
   * Bottom-panel merge on narrow viewports: whenever a session is current
   * while narrow (mount, session switch, or a desktop→narrow transition),
   * throw the bottom tree's tabs into the right tree. Idempotent — after
   * the first migration the bottom tree is empty and the reducer returns
   * the same reference, so this effect settles immediately.
   */
  useEffect(() => {
    if (!narrow || sessionId === undefined) return
    store.reduce(migrateBottomTabs)
  }, [narrow, sessionId, store])

  // While the session's header is still hydrating (or the session is blank),
  // the list summary may carry no cwd; ask the host once (it falls back to
  // the process cwd) so the explorer root and terminal cwd are real from
  // first paint instead of showing "no session".
  const [fetchedCwd, setFetchedCwd] = useState<string | undefined>(undefined)
  useEffect(() => {
    setFetchedCwd(undefined)
    if (sessionId === undefined || summaryCwd !== undefined) return
    let cancelled = false
    api.sessionCwd({ sessionId })
      .then(result => { if (!cancelled) setFetchedCwd(result.cwd) })
      .catch(() => { /* the explorer/git rows surface their own errors */ })
    return () => { cancelled = true }
  }, [sessionId, summaryCwd])
  const cwd = summaryCwd ?? fetchedCwd

  /**
   * Agent terminals push: subscribe to the host's live list of agent-owned
   * terminals for this session (created by the model through the
   * `terminal_create` tool). The host pushes a JSON array on every
   * create / close / exit; the sidebar reconciles the list into tabs
   * (id `agent:<uuid>`, title from the agent). A disconnected socket
   * retries with a short backoff so a refresh or transient drop reattaches
   * the same shell without losing the agent's work — capped like the
   * terminal view's own reconnect loop, so a refused endpoint never spins
   * forever (the next session switch restarts the loop).
   * While the terminal tab type is disabled in settings, pushes are
   * ignored (no auto-added tabs); re-enabling makes the next push converge.
   */
  useEffect(() => {
    if (sessionId === undefined) return
    let socket: WebSocket | null = null
    let retry: number | undefined
    let closed = false
    let failures = 0
    const connect = (): void => {
      if (closed) return
      const url = new URL('/sidebar/ws/agent-terminals', location.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.search = new URLSearchParams({ sessionId }).toString()
      socket = new WebSocket(url.toString())
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        try {
          const list = JSON.parse(event.data) as Array<{ uuid: string; title: string; command: string; exited: boolean }>
          if (!Array.isArray(list)) return
          store.reduce(s => ctx.get('betterSidebar')?.isTabEnabled('terminal') === false
            ? s
            : reconcileAgentTerminals(s, list))
        } catch {
          // Malformed push: ignore (the next push will reconcile).
        }
      }
      socket.onclose = () => {
        if (closed) return
        failures += 1
        if (failures >= FAILURE_LIMIT) {
          console.error('[dsh-better-sidebar] agent-terminals connection failed; stopping reconnect loop', sessionId)
          return
        }
        retry = window.setTimeout(connect, 2000)
      }
      socket.onerror = () => { socket?.close() }
    }
    connect()
    return () => {
      closed = true
      window.clearTimeout(retry)
      socket?.close()
    }
  }, [sessionId, store])

  /**
   * Agent opens push: subscribe to the host's `sidebar_open` requests for
   * this session (the model actively opens a file / folder / HTTP(S) page).
   * The host pushes one JSON request per open; the sidebar routes it to the
   * matching built-in tab: a file opens in the editor (per-path dedupe), a
   * folder opens a file window whose tree is rooted at the folder
   * (`meta.dir`), and a URL opens in the browser tab. A disconnected socket
   * retries with a short backoff (mirror of the agent-terminals loop): the
   * host queue keeps undelivered requests and replays them on the first
   * attach, so a refresh or a session switch lands the opens the model
   * queued while no view was connected.
   * While the side-card setting is off, pushes are ignored as a defensive
   * gate — the host already unregisters the tool and drains the queue.
   */
  useEffect(() => {
    if (sessionId === undefined) return
    let socket: WebSocket | null = null
    let retry: number | undefined
    let closed = false
    let failures = 0
    const connect = (): void => {
      if (closed) return
      const url = new URL('/sidebar/ws/agent-opens', location.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.search = new URLSearchParams({ sessionId }).toString()
      socket = new WebSocket(url.toString())
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        try {
          const request = JSON.parse(event.data) as { kind?: unknown; target?: unknown; title?: unknown }
          if (request === null || typeof request !== 'object') return
          if (request.kind !== 'file' && request.kind !== 'folder' && request.kind !== 'url') return
          if (typeof request.target !== 'string' || request.target === '') return
          if (store.getPrefs().agentOpenTools !== true) return
          const scope = { sessionId }
          const title = typeof request.title === 'string' && request.title !== '' ? request.title : undefined
          if (request.kind === 'url') {
            ctx.get('betterSidebar')?.openTab({ type: 'browser', url: request.target, title }, scope)
          } else if (request.kind === 'folder') {
            ctx.get('betterSidebar')?.openTab({
              type: 'editor',
              title,
              path: request.target,
              id: `editor:${request.target}`,
              meta: { dir: true },
            }, scope)
          } else {
            ctx.get('betterSidebar')?.openFile(scope, request.target, title)
          }
        } catch {
          // Malformed push: ignore (the next push carries its own request).
        }
      }
      socket.onclose = () => {
        if (closed) return
        failures += 1
        if (failures >= FAILURE_LIMIT) {
          console.error('[dsh-better-sidebar] agent-opens connection failed; stopping reconnect loop', sessionId)
          return
        }
        retry = window.setTimeout(connect, 2000)
      }
      socket.onerror = () => { socket?.close() }
    }
    connect()
    return () => {
      closed = true
      window.clearTimeout(retry)
      socket?.close()
    }
  }, [sessionId, store])

  /**
   * Subagent auto-activation: the moment the current conversation spawns its
   * FIRST direct subagent (a 0 → N transition on the list feed), the "auto
   * open" pref is on, and the Subagent tab type is enabled in settings,
   * open the panel (if collapsed) and focus the Subagent page
   * (single-instance: an existing tab is focused, never duplicated).
   * Switching to a session that already has subagents never triggers — its
   * baseline starts at the current count — so a deliberate layout is never
   * fought.
   *
   * The decision is DEBOUNCED (AUTO_OPEN_DEBOUNCE_MS): a Side Chat thread
   * is also a subagent-origin child, and its 'Side: ' title lands one frame
   * after its origin — an immediate check would misread that first frame as
   * a new subagent and pop this page on every thread creation. The timer
   * re-evaluates the ORIGINAL baseline against the live snapshot; by then
   * the title filter (isSideThreadSummary) sees the settled label.
   */
  const listBaselineRef = useRef<SidebarSessionList | undefined>(undefined)
  const autoOpenPendingRef = useRef<{ baseline: SidebarSessionList; timer: number } | null>(null)
  useEffect(() => {
    const prev = listBaselineRef.current
    listBaselineRef.current = sessionList
    if (sessionId === undefined || prev === undefined) return
    if (autoOpenPendingRef.current !== null) return
    if (!detectNewDirectSubagent(prev, sessionList, sessionId)) return
    const baseline = prev
    const timer = window.setTimeout(() => {
      autoOpenPendingRef.current = null
      if (!detectNewDirectSubagent(baseline, ctx.sessions?.list?.getSnapshot?.() ?? DEFAULT_SESSION_LIST, sessionId)) return
      if (!store.getPrefs().autoOpenSubagent) return
      if (ctx.get('betterSidebar')?.isTabEnabled('subagent') === false) return
      store.reduce(s => s.panelOpen ? s : togglePanel(s))
      // Pin the landing to the right panel: the auto-opened Subagent page must
      // appear where the panel just expanded, not in a bottom-panel pane the
      // user last touched.
      store.reduce(s => ({ ...s, activePane: firstLeaf(s.splits).id }))
      ctx.get('betterSidebar')?.openTab({ type: 'subagent', title: t('subagent') })
    }, AUTO_OPEN_DEBOUNCE_MS)
    autoOpenPendingRef.current = { baseline, timer }
  }, [sessionList, sessionId, store, ctx])

  // A session switch (or unmount) voids any armed auto-open recheck.
  useEffect(() => () => {
    const pending = autoOpenPendingRef.current
    if (pending !== null) window.clearTimeout(pending.timer)
    autoOpenPendingRef.current = null
  }, [sessionId])

  /**
   * Job auto-activation: the moment a NEW background job appears for the
   * current conversation (a job id the previous snapshot lacked), the
   * auto-open pref is on, and the Jobs tab type is enabled, open the panel
   * (if collapsed) and focus the Jobs page. Unlike the subagent trigger
   * (0 → N only), ANY new job id triggers: the agent may start several
   * jobs in one session, and each should surface. A fresh page load never
   * triggers — its baseline starts at the current snapshot.
   */
  const jobBaselineRef = useRef<SidebarSessionList | undefined>(undefined)
  useEffect(() => {
    const prev = jobBaselineRef.current
    jobBaselineRef.current = sessionList
    if (sessionId === undefined || prev === undefined) return
    if (!detectNewJob(prev, sessionList, sessionId)) return
    if (!store.getPrefs().autoOpenJobs) return
    if (ctx.get('betterSidebar')?.isTabEnabled('subagent') === false) return
    store.reduce(s => s.panelOpen ? s : togglePanel(s))
    store.reduce(s => ({ ...s, activePane: firstLeaf(s.splits).id }))
    ctx.get('betterSidebar')?.openTab({ type: 'subagent', title: t('subagent') })
  }, [sessionList, sessionId, store, ctx])

  /**
   * Topology jump-back: clicking a subagent node on the Subagent page calls
   * the official `openSubagent`, which switches the sidebar to that child
   * session's OWN layout (a fresh child session defaults to the explorer).
   * The README contract says the Subagent page must stay open with the jumped
   * node highlighted — so once the current session becomes the recorded jump
   * target, re-open the Subagent page on top of the child's layout (expanding
   * the panel first if it is collapsed). Only this explicit node click arms
   * the flag, so switching to a subagent session by any other means keeps
   * that session's own layout untouched.
   */
  const subagentJumpRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const pending = subagentJumpRef.current
    if (pending === undefined || sessionId !== pending) return
    subagentJumpRef.current = undefined
    store.reduce(s => s.panelOpen ? s : togglePanel(s))
    store.reduce(s => ({ ...s, activePane: firstLeaf(s.splits).id }))
    ctx.get('betterSidebar')?.openTab({ type: 'subagent', title: t('subagent') })
  }, [sessionId, store, ctx])

  /**
   /**
    * Inline pinned terminals (v0.17.0+): pinned tabs from OTHER sessions
    * inject as VIRTUAL tabs into the first leaf of the right panel's split
    * tree. The virtual tabs have unique ids (prefixed with the home session)
    * and carry the home scope in meta. Clicking a virtual tab sets
    * `activePinnedTabId` — the augmented tree overrides the leaf's `active`
    * so the pinned tab's content renders in-place (TerminalView connects to
    * the home session's PTY via WS, no session jump).
    *
    * Closing/unpinning a virtual tab targets the HOME session via reduceFor
    * (which doesn't notify — targeted opens must not re-render the active
    * session). The `pinnedRevision` state bump forces the pinnedEntries
    * useMemo to recompute after such an action.
    */
  const [activePinnedTabId, setActivePinnedTabId] = useState<string | null>(null)
  const [pinnedRevision, setPinnedRevision] = useState(0)

  /**
   * Cross-session pinned-tab collection. Recomputed on every store notify,
   * session-list change, and pinned action (the revision bump covers
   * reduceFor updates that don't notify). Only tabs from OTHER sessions —
   * the viewer's own pinned tabs are already on its tab strip.
   */
  const pinnedEntries: readonly PinnedTabEntry[] = useMemo(() => {
    if (sessionId === undefined) return []
    return collectPinnedTabs(store.getSessionStates(), { sessionId, cwd })
  }, [store, sessionId, cwd, snapshot, pinnedRevision])

  /** Virtual SidebarTab objects for the pinned entries (stable references
   *  via useMemo so TabContent's memo comparator holds). */
  const pinnedVirtualTabs = useMemo(
    () => pinnedEntries.map(createPinnedVirtualTab),
    [pinnedEntries],
  )

  /** The right panel's split tree with pinned virtual tabs injected into the
   *  first leaf. When `activePinnedTabId` is set, that leaf's `active` is
   *  overridden so the pinned tab's content is visible. */
  const augmentedTree = useMemo(
    () => state === undefined ? undefined : injectPinnedIntoTree(state.splits, pinnedVirtualTabs, activePinnedTabId),
    [state, pinnedVirtualTabs, activePinnedTabId],
  )

  // The app shell's center column: the bottom panel spans ONLY that column
  // ("squeezes the agent output area") — it starts at the app sidebar's
  // right edge and ends at the details column's left edge (the details
  // column sits between the center and the right panel). Measured directly
  // from the AppFrame's center column DOM (the parent of the
  // [data-slot="conversation"] wrapper — layout.css's center column) so the
  // bottom panel tracks the column's real
  // horizontal edges — including the animated margin-right push while the
  // right panel opens/closes; a frame that never appears keeps the initial
  // zero-size fallback (the panel renders at 0 width until measured).
  // The rect lives in a REF (not state): the open/close transition resizes
  // the center column EVERY frame for its duration, and reacting per frame
  // with setState re-renders the whole Sidebar (every mounted tab) at
  // animation cadence — the visible toggle jank (#315). measureCenter
  // writes the bottom panel's edges directly (same DOM-write pattern as
  // applyDrag), so the panel still tracks the column per frame with zero
  // React work; `centerMeasured` flips ONCE to gate the hidden→visible
  // first-paint fallback.
  const centerRectRef = useRef({ left: 0, right: 0 })
  const [centerMeasured, setCenterMeasured] = useState(false)
  // Refs keep the measure step stable across renders and let it skip work
  // mid-drag: during a width/corner drag the layout push resizes the center
  // column every frame, and reacting (setCenterRect → re-render) would
  // re-introduce the drag lag this shell deliberately avoids. applyDrag
  // writes the bottom panel's edges directly, so measurement pauses then.
  const centerColRef = useRef<HTMLElement | null>(null)
  const draggingRef = useRef(false)
  const measureCenter = useCallback((): void => {
    if (draggingRef.current) return
    const col = centerColRef.current
    if (col === null) return
    if (!col.isConnected) {
      // The observed column was detached (HMR re-render swapped the node
      // in place): its rect is stale garbage. Drop the ref — the locate
      // chain re-runs on the next mutation/interval tick and picks up the
      // new column node (issue #248).
      centerColRef.current = null
      return
    }
    const rect = col.getBoundingClientRect()
    // Ref + direct DOM write (see the centerRectRef comment): the bottom
    // panel keeps tracking the center column per frame during the right
    // panel's open/close animation without re-rendering the shell. The
    // one-shot measured flip renders the panel visible once (a stale
    // {0,0} fallback would flash full-width).
    centerRectRef.current = { left: rect.left, right: rect.right }
    const bottom = bottomRef.current
    if (bottom !== null) {
      bottom.style.setProperty('left', `${rect.left}px`)
      bottom.style.setProperty('right', `${window.innerWidth - rect.right}px`)
    }
    setCenterMeasured(prev => (prev ? prev : true))
  }, [])
  useEffect(() => {
    let disposed = false
    let observer: ResizeObserver | undefined
    // Locate the AppFrame's center column. DSH 0.1.x wraps slot hosts in
    // [data-slot] containers: the conversation slot wrapper
    // ([data-slot="conversation"]) sits directly inside the center column,
    // so its parent IS that column — no hashed-class or positional
    // dependency (layout.css uses the same anchor). The shell swaps the
    // boot page for the AppFrame only AFTER boot settles, so the first
    // query may miss it. Never give up: watch #root's subtree (the swap and
    // HMR re-renders mutate it) and re-run this locator — querying once and
    // bailing would strand the panel at the zero-size fallback forever
    // (observed: a 1px sliver at the viewport's left edge).
    const locate = (): void => {
      if (disposed) return
      const col = document.querySelector('#root [data-slot="conversation"]')
        ?.parentElement as HTMLElement | undefined
      if (col === undefined || !col.isConnected) {
        if (centerColRef.current !== null) {
          centerColRef.current = null
          observer?.disconnect()
          observer = undefined
        }
        return
      }
      if (centerColRef.current !== col) {
        // A NEW column node (boot swap, HMR re-render, or a previous locate
        // that found nothing): attach the ResizeObserver to THIS node and
        // measure it once. Same-node size changes are the ResizeObserver's
        // job — no forced measurement here, because a forced
        // getBoundingClientRect per mutation would reflow the shell at
        // mutation cadence.
        centerColRef.current = col
        observer?.disconnect()
        observer = new ResizeObserver(measureCenter)
        observer.observe(col)
        measureCenter()
      }
    }
    locate()
    // rAF-debounce the mutation watchers: #root's subtree changes at chat
    // cadence (streaming turns), and locate() itself must stay cheap.
    let locateFrame: number | null = null
    const scheduleLocate = (): void => {
      if (locateFrame !== null) return
      // Mid-drag every frame writes --dsh-sidebar-* on <html>'s style
      // attribute, which is the mutation this watcher observes — relocating
      // per drag frame is pointless (the center column node cannot change
      // while the pointer is captured) and adds a querySelector to every
      // frame's budget (#315). The 1.5s retry below still covers any node
      // swap that somehow lands mid-drag.
      if (draggingRef.current) return
      locateFrame = requestAnimationFrame(() => {
        locateFrame = null
        locate()
      })
    }
    const watcher = new MutationObserver(scheduleLocate)
    const root = document.getElementById('root')
    if (root !== null) watcher.observe(root, { childList: true, subtree: true })
    // The layout push writes --dsh-sidebar-* on <html>. A HMR re-activation
    // clears those variables on teardown and re-writes them on setup — and
    // that is also the moment the shell may have re-created the center
    // column under a REUSED #root child (React swaps nodes in place, so
    // #root's childList never changes and the watcher above never fires).
    // Watching <html>'s style attribute catches that re-sync: the push
    // rewrite re-locates and re-measures, so the bottom panel recovers
    // instead of staying hidden on a stale {0,0} center rect.
    const htmlStyleWatcher = new MutationObserver(scheduleLocate)
    htmlStyleWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    // Last-resort safety net (issue #248): no watcher is guaranteed to fire
    // for every HMR teardown/setup interleaving (e.g. the style attribute
    // may end up byte-identical, and the col may be swapped before the
    // subtree watcher attaches). A slow unconditional re-locate makes the
    // panel converge on the real column within a couple of seconds no
    // matter what sequence the shell used. locate() is cheap when nothing
    // changed (one querySelector + an identity compare; no forced layout).
    const retry = window.setInterval(locate, 1500)
    return () => {
      disposed = true
      if (locateFrame !== null) cancelAnimationFrame(locateFrame)
      window.clearInterval(retry)
      observer?.disconnect()
      watcher.disconnect()
      htmlStyleWatcher.disconnect()
      centerColRef.current = null
    }
    // Opening the bottom panel re-runs the whole locate/measure chain: a
    // panel opened before the center column was ever found must not stay
    // invisible forever (the HMR recovery path depends on the observers
    // above, this is the belt-and-braces retry for the open moment itself).
  }, [measureCenter, state?.bottomOpen])

  /**
   * Free windows — drag-out detection. The tab strips already drive HTML5
   * DnD (payload application/x-dsh-tab) with drops owned by the panes
   * (split/merge); this shell watches the DOCUMENT (capture) for the same
   * drag hovering OUTSIDE the panel host: while the pointer is over the
   * conversation column it arms the drop (preventDefault) and shows a hint
   * overlay there, and the drop floats the tab at the release point. Targets
   * inside the host are ignored here, so pane drops keep their behavior
   * untouched. Only OUR tab drags count (the body flag is the tab strip's;
   * OS file drags and any DSH drags pass through). Narrow viewports skip
   * the gesture — the merged drawer covers the conversation, leaving
   * nothing to drop onto (the tab context menu entry still floats tabs).
   */
  const [floatHint, setFloatHint] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const floatHintRef = useRef(false)
  useEffect(() => {
    if (narrow || sessionId === undefined) return
    const inPanelHost = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest('[data-dsh-panel-host]') !== null
    /** The conversation column's rect when the pointer is over it (and not
     *  over our own surfaces); null otherwise. */
    const overConversation = (event: DragEvent): DOMRect | null => {
      if (inPanelHost(event.target)) return null
      const col = centerColRef.current
      if (col === null || !col.isConnected) return null
      const rect = col.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      const { clientX: x, clientY: y } = event
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null
      return rect
    }
    const onDragOver = (event: DragEvent): void => {
      if (!document.body.hasAttribute('data-dsh-tab-dragging')) return
      const rect = overConversation(event)
      if (rect !== null) {
        // preventDefault on dragover is what makes the browser deliver the
        // drop (and drop the "no" cursor) over the conversation area.
        event.preventDefault()
        setFloatHint((prev) => {
          const next = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          if (prev !== null && prev.left === next.left && prev.top === next.top
            && prev.width === next.width && prev.height === next.height) return prev
          return next
        })
        floatHintRef.current = true
      } else if (floatHintRef.current) {
        floatHintRef.current = false
        setFloatHint(null)
      }
    }
    const onDrop = (event: DragEvent): void => {
      if (!floatHintRef.current) return
      floatHintRef.current = false
      setFloatHint(null)
      const rect = overConversation(event)
      if (rect === null) return
      event.preventDefault()
      event.stopPropagation()
      const payload = parseDrag(event.dataTransfer?.getData(TAB_DRAG_TYPE) ?? '')
      if (payload === null) return
      store.reduce(s => floatTab(s, payload.tabId, event.clientX, event.clientY))
    }
    const clear = (): void => {
      if (!floatHintRef.current) return
      floatHintRef.current = false
      setFloatHint(null)
    }
    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', clear, true)
    window.addEventListener('blur', clear)
    return () => {
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', clear, true)
      window.removeEventListener('blur', clear)
    }
  }, [narrow, sessionId, store])

  /**
   * Bottom-panel first-expansion auto terminal: the FIRST time the user
   * expands the bottom panel in a session, try to open a fresh terminal tab
   * there. "Try" is literal — the terminal's own quota and enable switch
   * gate the attempt (a full quota or a disabled terminal type makes it a
   * no-op). Gated on the bottomPanelAutoTerminal pref (the terminal tab's
   * nested settings toggle, default on). Only a false→true TRANSITION fires
   * (a panel persisted open never counts as an expansion), and the session's
   * bottomOpenedOnce flag is set atomically with the first fire so later
   * expansions never repeat it.
   */
  const bottomWasOpenRef = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    // The bottom panel does not exist on narrow viewports (the two
    // workbenches merge into one panel), so the first-expansion auto
    // terminal is a desktop-only behavior.
    if (narrow) return
    if (state === undefined) return
    const wasOpen = bottomWasOpenRef.current
    bottomWasOpenRef.current = state.bottomOpen
    if (wasOpen === undefined || wasOpen || !state.bottomOpen) return
    if (state.bottomOpenedOnce) return
    if (store.getPrefs().bottomPanelAutoTerminal === false) return
    if (ctx.get('betterSidebar')?.isTabEnabled('terminal') === false) return
    // Land the tab in the bottom panel's first pane; the once-flag is set
    // atomically so later expansions never repeat the auto-open.
    store.reduce(s => ({ ...s, activePane: firstLeaf(s.bottomSplits).id, bottomOpenedOnce: true }))
    ctx.get('betterSidebar')?.openTab({ type: 'terminal' })
  }, [state, store, ctx, narrow])

  // Panel drags: the right panel's width (left edge strip), the bottom
  // panel's height (top edge strip), and the shared corner (both at once).
  // Drags write the sizes DIRECTLY to the DOM (panel styles + the layout CSS
  // variables) instead of round-tripping the store on every pointer move —
  // a store reduce re-renders both workbenches (terminals, editors…) per
  // move, which is the visible drag lag. The store is committed once on
  // pointer up (clamping + persistence).
  const panelRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const widthDrag = useRef({ startX: 0, startWidth: 0 })
  const [draggingWidth, setDraggingWidth] = useState(false)
  const bottomDrag = useRef({ startY: 0, startHeight: 0 })
  const [draggingBottom, setDraggingBottom] = useState(false)
  const cornerDrag = useRef({ startX: 0, startY: 0, startWidth: 0, startHeight: 0 })
  const [draggingCorner, setDraggingCorner] = useState(false)
  const anyDragging = draggingWidth || draggingBottom || draggingCorner

  // Pause center-column measurement while dragging, and re-measure once the
  // drag settles at its committed size. The store commit lands on release and
  // the final width equals the last drag width, so no ResizeObserver event
  // fires to refresh centerRect — this explicit re-measure covers that gap.
  useEffect(() => {
    draggingRef.current = anyDragging
    if (!anyDragging) measureCenter()
  }, [anyDragging, measureCenter])

  // Clamp mirrors of setWidth/setBottomHeight for mid-drag values (the store
  // re-clamps on commit; these keep the panels from overshooting mid-drag).
  const clampWidth = (width: number): number =>
    Math.min(Math.max(PANEL_MIN, Math.round(width)), Math.max(PANEL_MIN, window.innerWidth))
  const clampHeight = (height: number): number =>
    Math.min(Math.max(BOTTOM_MIN, Math.round(height)), Math.max(BOTTOM_MIN, window.innerHeight - PANEL_MIN))

  /** Single writer for the layout-push variables: the app shell gives up
   *  the panel's width/height while open (0 while collapsed) through
   *  layout.css's margins. Every size change — drag frames and committed
   *  state — flows through here so the push never forks between paths. */
  const writeGeometry = (width: number, height: number): void => {
    // Embedded (left-dock) mode occupies real layout space — no push needed.
    if (embedded) return
    document.documentElement.style.setProperty('--dsh-sidebar-width', `${width}px`)
    document.documentElement.style.setProperty('--dsh-sidebar-height', `${height}px`)
    // The corner handle positions itself relative to the panel (CSS
    // `bottom: calc(var(--dsh-sidebar-height) + 6px)`), so these two layout
    // variables are all it needs — no viewport coordinates written here
    // (issue #106: skins that inset the panels must not fight JS coords).
  }

  /** Last size a drag actually applied to the DOM (updated by applyDrag).
   *  When a pointer stream dies without any position info (issue #247: an
   *  ultra-fast flick whose release events carried no usable coordinates),
   *  the abort path adopts this instead of rolling back to the pre-drag
   *  value — the DOM's current size is the only truthful record left. */
  const lastDragSize = useRef<{ width: number; height: number } | null>(null)

  /** Apply a drag size to the DOM without touching React state or the store.
   *  The bottom panel's right edge tracks the right panel's left edge HERE
   *  too — React state only updates on release, so the inline right must be
   *  written directly or the bottom panel would lag the sidebar mid-drag.
   *  The layout push rides the shared writer (writeGeometry). */
  const applyDrag = (width: number, height: number): void => {
    lastDragSize.current = { width, height }
    panelRef.current?.style.setProperty('width', `${width}px`)
    bottomRef.current?.style.setProperty('height', `${height}px`)
    // centerRect.right is the center column's right edge at the committed
    // width (innerWidth - state.width - detailsWidth), so this equals
    // `width + detailsWidth` — derived from the measured column, keeping the
    // drag write-only (no React re-render mid-drag).
    bottomRef.current?.style.setProperty('right', `${(window.innerWidth - centerRectRef.current.right) + (width - (state?.width ?? 0))}px`)
    const bottomPush = !narrow && state?.bottomOpen === true ? height + keyboardInset : 0
    writeGeometry(width, bottomPush)
  }

  // Drags write at most once per frame: pointer events fire several times
  // faster than the display refresh, and each write reflows the app shell
  // (the layout push) plus the panels — batching to one write per frame is
  // what keeps the drag smooth. The store is still committed once on release.
  const dragFrame = useRef<number | null>(null)
  const pendingDrag = useRef<{ width: number; height: number } | null>(null)
  const scheduleDrag = (width: number, height: number): void => {
    pendingDrag.current = { width, height }
    if (dragFrame.current !== null) return
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = null
      const pending = pendingDrag.current
      if (pending !== null) {
        pendingDrag.current = null
        applyDrag(pending.width, pending.height)
      }
    })
  }

  /** Flush any pending drag write and stop scheduling (the store commit on
   *  pointer up applies the final clamped values). */
  const stopDragScheduling = (): void => {
    if (dragFrame.current !== null) {
      cancelAnimationFrame(dragFrame.current)
      dragFrame.current = null
    }
    pendingDrag.current = null
  }

  /**
   * Finalize a drag on pointer up: flush the LAST drag frame to the DOM
   * synchronously, then commit the SAME clamped values to the store. A fast
   * release cancels the rAF before it ran — without the flush the DOM would
   * sit at the pre-drag size until React re-renders with the committed
   * value, and a value that never made it into a move handler would never
   * be applied at all. The measurement pause ends here too: the center
   * column is re-measured BEFORE the committed re-render lands, so the
   * bottom panel's React-rendered right edge already reflects the new
   * width (otherwise the re-render would re-apply the stale rect — the
   * bottom panel visibly jumps for one frame).
   */
  const commitDrag = (
    width: number,
    height: number,
    reduce: (state: SidebarState) => SidebarState,
  ): void => {
    stopDragScheduling()
    applyDrag(width, height)
    draggingRef.current = false
    measureCenter()
    store.reduce(reduce)
  }

  /** Set once a drag's pointerup handler commits — premature capture loss
   *  (pointercancel / lostpointercapture without pointerup) must then be told
   *  apart from a normal release. */
  const dragCommitted = useRef(false)
  /**
   * Abort a drag whose pointer stream was interrupted (pointercancel, or
   * capture lost before pointerup): no pointerup will arrive, so without
   * this the dragging state would stick true and center-column measurement
   * would stay paused forever — the bottom panel freezes at stale edges and
   * stops tracking sidebar/app-rail layout changes.
   *
   * A FAST release is the common trigger: browsers merge pointermove bursts,
   * and an ultra-fast flick can cancel the stream before ANY move lands.
   * The commit order is therefore: the LAST KNOWN dragged size (the rAF
   * pending value) first, then the interrupting event's own pointer
   * position (only pointercancel is trusted to carry coordinates —
   * lostpointercapture's coordinates are not guaranteed, so the handlers
   * pass the event only from pointercancel), and finally the size the drag
   * last APPLIED to the DOM (lastDragSize). A drag that produced none of
   * those (pure down+up at the same spot) commits the store's own sizes —
   * a no-op, never an explicit rollback (issue #247: v0.13.1 never reverted
   * an interrupted fast flick; the abort path added in the unified-host
   * refactor did, and that regression is what this ordering removes).
   *
   * Every commit path marks the drag committed, so the interrupt
   * double-fire (pointercancel → lostpointercapture) cannot commit once
   * and then roll the same drag back.
   */
  const abortDrag = (reset: () => void, event?: { clientX: number; clientY: number }): void => {
    if (dragCommitted.current) return
    const pending = pendingDrag.current
    let width: number | undefined
    let height: number | undefined
    if (pending !== null) {
      width = pending.width
      height = pending.height
    } else if (event !== undefined) {
      // No move ever landed: the cancel position is all we have — commit it
      // (clamped) instead of rolling back the flick.
      if (draggingWidth) {
        width = clampWidth(widthDrag.current.startWidth + (widthDrag.current.startX - event.clientX))
        height = pushedBottomHeight(state?.bottomOpen === true, state?.bottomHeight ?? 0)
      } else if (draggingBottom) {
        width = Math.min(state?.width ?? 0, window.innerWidth)
        height = pushedBottomHeight(true, clampHeight(bottomDrag.current.startHeight + (bottomDrag.current.startY - event.clientY)))
      } else if (draggingCorner) {
        width = clampWidth(cornerDrag.current.startWidth + (cornerDrag.current.startX - event.clientX))
        height = pushedBottomHeight(true, clampHeight(cornerDrag.current.startHeight + (cornerDrag.current.startY - event.clientY)))
      }
    }
    if (width !== undefined && height !== undefined) {
      dragCommitted.current = true
      pendingDrag.current = null
      if (dragFrame.current !== null) {
        cancelAnimationFrame(dragFrame.current)
        dragFrame.current = null
      }
      applyDrag(width, height)
      draggingRef.current = false
      measureCenter()
      store.reduce(s => setBottomHeight(setWidth(s, width), height))
    } else {
      // No pending write and no usable event coordinates: keep the size the
      // drag last applied instead of rolling back to the pre-drag value
      // (the flick's moves may have been consumed by the rAF just before
      // the stream died — the DOM already shows the dragged size). Clamp to
      // the current geometry like the layout-push effect (closed/narrow
      // panels are written 0 by the push).
      dragCommitted.current = true
      stopDragScheduling()
      const last = lastDragSize.current
      const { width: adoptedWidth, height: adoptedHeight } = layoutPushSize({
        narrow,
        panelOpen: state?.panelOpen === true,
        bottomOpen: state?.bottomOpen === true,
        width: last?.width ?? state?.width ?? 0,
        bottomHeight: last?.height ?? state?.bottomHeight ?? 0,
        viewportWidth: viewport.width,
        viewportHeight: layoutViewportHeight,
      })
      applyDrag(adoptedWidth, adoptedHeight)
      draggingRef.current = false
      measureCenter()
      store.reduce(s => setBottomHeight(setWidth(s, adoptedWidth), adoptedHeight))
    }
    reset()
  }

  // Layout push: the app shell gives up the panel's width/height while the
  // panels are open (0 while collapsed), so the conversation and input bar
  // are squeezed instead of covered. The margins are capped at the viewport
  // so a stale persisted size (e.g. fullscreen on a bigger window) can never
  // crush the app shell to zero. Dragging disables the layout transition.
  // On NARROW viewports the drawer FLOATS over the app shell — no push, the
  // conversation keeps the full width behind the drawer.
  useEffect(() => {
    if (embedded) return
    const { width, height } = layoutPushSize({
      narrow,
      panelOpen: snapshot.state?.panelOpen === true,
      bottomOpen: snapshot.state?.bottomOpen === true,
      width: snapshot.state?.width ?? 0,
      bottomHeight: snapshot.state?.bottomHeight ?? 0,
      viewportWidth: viewport.width,
      viewportHeight: layoutViewportHeight,
    })
    const bottomPush = !narrow && snapshot.state?.bottomOpen === true
      ? height + keyboardInset
      : 0
    writeGeometry(width, bottomPush)
  }, [narrow, snapshot.state?.panelOpen, snapshot.state?.width, snapshot.state?.bottomOpen, snapshot.state?.bottomHeight, viewport.width, layoutViewportHeight, keyboardInset])
  // Unmount must release the push (issue #31): when the boundary swaps the
  // whole sidebar after a render crash (or the plugin fiber is disposed /
  // HMR), the CSS variables would otherwise stay on <html> and layout.css
  // keeps squeezing #root with a stale margin — "the sidebar cannot be
  // hidden" until a full reload. This lives in an UNMOUNT-ONLY effect, NOT
  // in the push effect's cleanup: React can yield between a passive
  // effect's cleanup and setup phases, and removing the variables on a
  // dependency change used to paint the push-less layout for a frame (the
  // center column went full width) while the re-add restarted the margin
  // transition — the bottom panel flashed full width after every width
  // drag (issue #258). Keeping the variables continuously valid while
  // mounted makes the push invisible to mid-flush style recals.
  useEffect(() => {
    return () => {
      document.documentElement.style.removeProperty('--dsh-sidebar-width')
      document.documentElement.style.removeProperty('--dsh-sidebar-height')
    }
  }, [])
  useEffect(() => {
    if (anyDragging) document.body.setAttribute('data-dsh-sidebar-dragging', '')
    else document.body.removeAttribute('data-dsh-sidebar-dragging')
  }, [anyDragging])


  const actions: WorkbenchActions = useMemo(() => ({
    closeTab: (paneId, tabId) => {
      // A closed terminal releases its pty immediately — including when its
      // socket is mid-reconnect, where the unmount close frame never reaches
      // the host and the process would hold the quota until the grace ends.
      // Agent terminals (tabId `agent:<uuid>`) close through a different
      // host route: the WS close frame is the primary path (sent by
      // TerminalView on unmount), and the agent-pty.close HTTP route is the
      // fallback when the WS is down.
      const current = store?.getSnapshot?.()?.state
      // Terminal tabs may live in EITHER tree (the bottom panel hosts them
      // too) — the pty-release lookup covers both, or the HTTP fallback is
      // skipped for a bottom-panel terminal whose WS frame never arrived.
      const leaf = current === undefined
        ? undefined
        : leafWithTab(current.splits, tabId) ?? leafWithTab(current.bottomSplits, tabId)
      const tab = leaf?.tabs.find(candidate => candidate.id === tabId)
      // Route through the service: the tab-bar close is the canonical close
      // path (finds the pane itself, fires descriptor.onClose); the session
      // scope (with its cwd) rides to the callback.
      ctx.get('betterSidebar')?.closeTab(tabId, sessionId === undefined ? undefined : { sessionId, cwd })
      if (tab?.type === 'terminal') {
        if (isAgentTabId(tabId)) {
          const uuid = agentUuidOf(tabId)
          void api.agentPtyClose(uuid).catch(() => { /* the host may already have released it */ })
        } else if (sessionId !== undefined) {
          void api.ptyClose({ sessionId, cwd }, tabId).catch(() => { /* the host may already have released it */ })
        }
      }
    },
    activateTab: (paneId, tabId) => {
      // Route through the service: same reducer (finds the pane in EITHER
      // tree, sets the active pane) and fires descriptor.onActivate; the
      // session scope (with its cwd) rides to the callback.
      ctx.get('betterSidebar')?.activateTab(tabId, sessionId === undefined ? undefined : { sessionId, cwd })
    },
    focusPane: (paneId) => { store.reduce(s => ({ ...s, activePane: paneId })) },
    moveTabToEdge: (payload: TabDragPayload, toPane: string, zone: DropZone) => {
      store.reduce(s => moveTabToEdge(s, payload.paneId, payload.tabId, toPane, zone))
    },
    moveTabBefore: (payload: TabDragPayload, toPane: string, beforeTabId: string) => {
      store.reduce((s) => {
        let index = -1
        const source = leafWithTab(s.splits, beforeTabId)
        if (source !== undefined && source.id === toPane) {
          index = source.tabs.findIndex(tab => tab.id === beforeTabId)
        }
        return moveTab(s, payload.paneId, payload.tabId, toPane, index)
      })
    },
    resizeSplit: (splitId, index, deltaFrac) => {
      store.reduce(s => resizeSplitIn(s, splitId, index, deltaFrac))
    },
    // The tab context menu's "move to free window": no drop point exists, so
    // the window is born over the conversation column's center (the user's
    // focus area; clamped into the viewport by the reducer) — the same
    // landing the drag-out gesture produces.
    floatTab: (tabId) => {
      const col = centerColRef.current
      const rect = col !== null && col.isConnected ? col.getBoundingClientRect() : null
      const x = rect !== null ? (rect.left + rect.right) / 2 : window.innerWidth / 2
      const y = rect !== null ? (rect.top + rect.bottom) / 2 : window.innerHeight / 2
      store.reduce(s => floatTab(s, tabId, x, y))
    },
    // Pin/unpin a terminal tab (v0.17.0+): the home cwd is snapshotted at
    // pin time so a workspace-scoped pin only resurfaces in sessions whose
    // cwd matches. Unpin passes null — the tab stays open in its home
    // session, just unmarked.
    pinTab: (tabId, scope) => {
      store.reduce(s => setTabPin(s, tabId, scope === null ? null : { scope, homeCwd: cwd }))
    },
  }), [store, sessionId, cwd])

  /**
   * Wrap the base actions to intercept pinned VIRTUAL tab ids (injected from
   * other sessions). Regular tab ids pass through unchanged. Virtual ids are
   * detected by the `pinned:` prefix and routed to the HOME session via
   * reduceFor (which doesn't notify — the revision bump is the local signal).
   */
  const wrappedActions = useMemo<WorkbenchActions>(() => {
    if (pinnedVirtualTabs.length === 0) return actions
    const closePinnedInHome = (virtualId: string): void => {
      const { homeSessionId, tabId: originalId } = parsePinnedVirtualId(virtualId)
      // The home cwd lives in the virtual tab's meta (snapshotted at pin
      // time) — pass it to ptyClose so the host resolves the PTY in the
      // correct workspace container (same scope the WS open used).
      const vtab = pinnedVirtualTabs.find(t => t.id === virtualId)
      const homeCwd = vtab !== undefined ? getPinnedHomeScope(vtab)?.cwd : undefined
      store.reduceFor(homeSessionId, s => {
        const leaf = leafWithTab(s.splits, originalId) ?? leafWithTab(s.bottomSplits, originalId)
        if (leaf !== undefined) return closeTab(s, leaf.id, originalId)
        if (s.floats.some(f => f.tab.id === originalId)) return closeFloatByTab(s, originalId)
        return s
      })
      if (isAgentTabId(originalId)) {
        void api.agentPtyClose(agentUuidOf(originalId)).catch(() => { /* already released */ })
      } else {
        void api.ptyClose({ sessionId: homeSessionId, ...(homeCwd !== undefined ? { cwd: homeCwd } : {}) }, originalId).catch(() => { /* already released */ })
      }
      if (activePinnedTabId === virtualId) setActivePinnedTabId(null)
      setPinnedRevision(v => v + 1)
    }
    return {
      ...actions,
      activateTab: (paneId, tabId) => {
        if (isPinnedVirtualId(tabId)) {
          setActivePinnedTabId(tabId)
        } else {
          setActivePinnedTabId(null)
          actions.activateTab(paneId, tabId)
        }
      },
      closeTab: (paneId, tabId) => {
        if (isPinnedVirtualId(tabId)) {
          closePinnedInHome(tabId)
        } else {
          actions.closeTab(paneId, tabId)
        }
      },
      moveTabBefore: (payload, toPane, beforeTabId) => {
        if (isPinnedVirtualId(payload.tabId)) return
        if (isPinnedVirtualId(beforeTabId)) {
          actions.moveTabToEdge(payload, toPane, 'center')
        } else {
          actions.moveTabBefore(payload, toPane, beforeTabId)
        }
      },
      moveTabToEdge: (payload, toPane, zone) => {
        if (isPinnedVirtualId(payload.tabId)) return
        actions.moveTabToEdge(payload, toPane, zone)
      },
      floatTab: (tabId) => {
        if (isPinnedVirtualId(tabId)) return
        actions.floatTab(tabId)
      },
      pinTab: (tabId, scope) => {
        if (isPinnedVirtualId(tabId)) {
          if (scope !== null) return
          const { homeSessionId, tabId: originalId } = parsePinnedVirtualId(tabId)
          store.reduceFor(homeSessionId, s => setTabPin(s, originalId, null))
          if (activePinnedTabId === tabId) setActivePinnedTabId(null)
          setPinnedRevision(v => v + 1)
        } else {
          actions.pinTab?.(tabId, scope)
        }
      },
    }
  }, [actions, pinnedVirtualTabs, activePinnedTabId, store])

  /**
   * The explorer's @-reference button: append `@<relative path>` to the
   * session's composer draft (space-separated). The conversation service is
   * resolved lazily through `ctx.get` (the inject-free read — the app's own
   * plugins read 'conversation' the same way); a missing service or scope
   * degrades to a logged no-op, never a crash. Defined above the no-session
   * early return — a hook must never sit behind a conditional return
   * (React counts hooks per render).
   */
  const referenceInChat = useCallback((path: string): void => {
    if (sessionId === undefined) return
    appendToDraft(ctx, sessionId, `@${relativeTo(cwd ?? '', path)}`)
  }, [ctx, sessionId, cwd])

  if (state === undefined || sessionId === undefined) {
    // Keep the unavailable controls focusable: touch users have no hover, so
    // focus is the only way the existing Tooltip can explain what is missing.
    return (
      <div data-dsh-panel-host {...osFileDragShield}>
        <div className={css.toggleCluster} data-dsh-toggle-cluster>
          {!narrow && (
            <Tooltip label={t('noSession')} side="bottom" delayMs={500}>
              <button type="button" className={css.toggleButton} aria-disabled="true" aria-label={t('noSession')}>
                <IconPanelBottomOutline16 />
              </button>
            </Tooltip>
          )}
          <Tooltip label={t('noSession')} side="bottom" delayMs={500}>
            <button type="button" className={css.toggleButton} aria-disabled="true" aria-label={t('noSession')}>
              <IconPanelRightOutline16 />
            </button>
          </Tooltip>
        </div>
      </div>
    )
  }

  const bottomPanelHeight = layoutPushSize({
    narrow,
    panelOpen: state.panelOpen,
    // Keep the hidden panel's geometry ready for its slide-in transition;
    // only the layout push itself becomes zero while it is closed.
    bottomOpen: true,
    width: state.width,
    bottomHeight: state.bottomHeight,
    viewportWidth: viewport.width,
    viewportHeight: layoutViewportHeight,
  }).height

  const onNewTab = (optionId: string): void => {
    const service = ctx.get('betterSidebar')
    const descriptor = service?.getTab(optionId)
    if (service === undefined || descriptor === undefined) return
    const title = typeof descriptor.title === 'function' ? descriptor.title() : descriptor.title
    // The session scope rides along: lifecycle callbacks receive it (and
    // the open stays in the current session, as before).
    service.openTab({ type: optionId, title }, { sessionId, cwd })
  }

  /**
   * The explorer's @-reference button: append `@<relative path>` to the
   * session's composer draft (space-separated). Resolves the session-scope
   * ctx and the conversation input service at click time; a missing service
   * or scope degrades to a logged no-op, never a crash.
   */
  /** The tab icon from the tab-type registry (shared by every workbench). */
  const tabIconOf = (tab: SidebarTab): ReactNode => {
    const descriptor = ctx.get('betterSidebar')?.getTab(tab.type)
    if (descriptor === undefined) return null
    return typeof descriptor.icon === 'function' ? descriptor.icon(14) : descriptor.icon
  }

  /**
   * The tab badge from the tab-type registry: a count (99+ capped) or a
   * short text pill. A throwing badge is swallowed (no pill) — the tab
   * strip must never break because a plugin's badge computation failed.
   */
  const tabBadgeOf = (tab: SidebarTab): ReactNode => {
    const descriptor = ctx.get('betterSidebar')?.getTab(tab.type)
    if (descriptor?.badge === undefined) return null
    let value: string | number | null | undefined
    try {
      value = descriptor.badge(ctx, { sessionId, cwd }, state)
    } catch (error) {
      console.error('[dsh-better-sidebar] tab badge error:', error)
      return null
    }
    if (value === null || value === undefined || value === '') return null
    const text = typeof value === 'number' ? (value > 99 ? '99+' : String(value)) : String(value)
    return <span className={css.tabBadge}>{text}</span>
  }

  /**
   * Render one tab's content. `active` (from the workbench) tells whether
   * this tab is the active one in its pane; combined with the panel's
   * open/closed state it gates live views (the Subagent topology pauses its
   * polling while the page is not actually visible). The pane id travels
   * with the tab so diff tabs can split below their source pane.
   */
  // `placement` decides the visibility contract handed to the tab component:
  // pane tabs are visible while their panel is open and they are active, but
  // a free window is its own surface — its tab stays visible no matter what
  // the panels do (the AGENTS §7.5 contract; plugin components honor
  // `visible` to pause work, so tying floats to panelOpen would blank them
  // the moment the sidebar collapses).
  const renderTab = (tab: SidebarTab, active: boolean, paneId: string, placement: 'top' | 'bottom' | 'float' = 'top') => {
    // Pinned virtual tabs: pass the home session's scope (sessionId + cwd) so
    // TerminalView's WS URL resolves to the home PTY, and effectiveTabId so
    // the descriptor component receives the ORIGINAL tab id (the virtual id
    // is only a display key). Regular tabs: effectiveTabId is undefined (no
    // override), scope is the current session's.
    const home = getPinnedHomeScope(tab)
    return (
      <TabContent
        tab={tab}
        effectiveTabId={home?.tabId}
        paneId={paneId}
        sessionId={home?.sessionId ?? sessionId}
        cwd={home?.cwd ?? cwd}
        expanded={state.expanded}
        revealed={state.revealed ?? []}
        onToggleDir={(path) => { store.reduce(s => toggleExpanded(s, path)) }}
        onReferenceFile={referenceInChat}
        ctx={ctx}
        store={store}
        visible={
          placement === 'float'
            ? true
            : placement === 'bottom'
              ? state.bottomOpen && active
              : embedded
                ? active
                : state.panelOpen && active
        }
        onSubagentJump={(childSessionId) => { subagentJumpRef.current = childSessionId }}
        onOpenDiff={(diffTab) => { store.reduce(s => openDiffTab(s, paneId, diffTab)) }}
        localeRevision={localeRevision}
        tabsVersion={tabsVersion}
      />
    )
  }

  // Embedded (left-dock) mode: the workbench fills its container IN FLOW —
  // no fixed viewport host, no panels sliding in from the viewport edges, no
  // toggle cluster (the host's tab strip switches views), no bottom panel and
  // no free windows. The store wiring, WS feeds and tab rendering above all
  // still run; only the overlay geometry is dropped.
  if (embedded) {
    return (
      <div className={css.embeddedHost} data-dsh-panel-host data-dsh-panel-host-embedded>
        <div className={css.panelBody}>
          <Workbench
            state={state}
            tree={augmentedTree}
            newTabOptions={buildNewTabOptions(state, ctx, { sessionId, cwd })}
            actions={wrappedActions}
            onNewTab={onNewTab}
            renderTab={renderTab}
            getTabIcon={tabIconOf}
            getTabBadge={tabBadgeOf}
          />
        </div>
      </div>
    )
  }

  return (
    <div data-dsh-panel-host {...osFileDragShield}>
      {/*
        The persistent toggle cluster at the top-right corner: the bottom
        panel's button (bottom glyph) LEFT of the right panel's (side glyph).
        Always pinned to the viewport corner — inside the right panel's
        top-right while it is open, sitting flush in the tab strip whose
        right end it really squeezes (the strip reserves its width via CSS),
        so the tabs genuinely yield space to it.
      */}
      <div className={css.toggleCluster} data-dsh-toggle-cluster>
        {/*
          Narrow viewports merge the two workbenches into the one drawer —
          there is no bottom panel, so its toggle button is not offered.
        */}
        {!narrow && (
          <Tooltip label={state.bottomOpen ? t('collapseBottomPanel') : t('expandBottomPanel')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.toggleButton}
              aria-label={state.bottomOpen ? t('collapseBottomPanel') : t('expandBottomPanel')}
              onClick={() => { store.reduce(toggleBottomPanel) }}
            >
              <IconPanelBottomOutline16 />
            </button>
          </Tooltip>
        )}
        <Tooltip label={state.panelOpen ? t('collapse') : t('expand')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.toggleButton}
            aria-label={state.panelOpen ? t('collapse') : t('expand')}
            onClick={() => { store.reduce(togglePanel) }}
          >
            <IconPanelRightOutline16 />
          </button>
        </Tooltip>
      </div>
      {/*
        The right panel stays mounted while collapsed (hidden off-screen) so
        the slide in/out can animate; visibility hides it after the slide
        settles. Its bottom edge follows the bottom panel's height (0 while
        the bottom panel is closed) — the VSCode-style "sidebar above panel".
        On NARROW viewports it is a full-width drawer holding both
        workbenches (see MobileWorkbench); the width drag strip is not
        offered there — a full-screen sheet has nothing to drag.
      */}
      <div
        ref={panelRef}
        className={clsx(css.panel, !state.panelOpen && css.panelHidden)}
        data-dsh-panel
        style={{
          width: narrow ? '100vw' : Math.min(state.width, window.innerWidth),
          // Narrow drawer: keep the bottom-anchored sheet above the on-screen
          // keyboard (visualViewport inset); desktop panels are full-height
          // and unaffected.
          bottom: narrow && keyboardInset > 0 ? `${keyboardInset}px` : undefined,
        }}
       
        data-dragging={anyDragging || undefined}
      >
          {!narrow && (
            <div
              className={clsx(css.panelResize, draggingWidth && css.panelResizeActive)}
             
              onPointerDown={(event) => {
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                dragCommitted.current = false
                widthDrag.current = { startX: event.clientX, startWidth: state.width }
                setDraggingWidth(true)
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                const { startX, startWidth } = widthDrag.current
                const width = clampWidth(startWidth + (startX - event.clientX))
                const height = pushedBottomHeight(state.bottomOpen, state.bottomHeight)
                scheduleDrag(width, height)
              }}
              onPointerUp={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                if (dragCommitted.current) return
                dragCommitted.current = true
                event.currentTarget.releasePointerCapture(event.pointerId)
                const { startX, startWidth } = widthDrag.current
                // The up position is the pointer's FINAL position — a fast
                // flick's tail is coalesced into the up event, so the last
                // pointermove (the rAF pending value) can be stale. Commit
                // from the up position (v0.13.1 semantics; issue #247).
                const width = clampWidth(startWidth + (startX - event.clientX))
                const height = pushedBottomHeight(state.bottomOpen, state.bottomHeight)
                commitDrag(width, height, s => setWidth(s, width))
                setDraggingWidth(false)
              }}
              onPointerCancel={(event) => { abortDrag(() => setDraggingWidth(false), event) }}
              onLostPointerCapture={() => { abortDrag(() => setDraggingWidth(false)) }}
            />
          )}
        <div className={css.panelBody}>
          <Workbench
            state={state}
            tree={augmentedTree}
            newTabOptions={buildNewTabOptions(state, ctx, { sessionId, cwd })}
            actions={wrappedActions}
            onNewTab={onNewTab}
            renderTab={renderTab}
            getTabIcon={tabIconOf}
            getTabBadge={tabBadgeOf}
          />
        </div>
        {/*
          The shared corner (only while BOTH panels are open): the
          intersection of the right panel's left edge and the bottom panel's
          top edge. Horizontal drags resize the right panel's width, vertical
          drags the bottom panel's height — the two panels drag against each
          other. Rendered INSIDE the right panel and positioned by CSS
          relative to it (left edge + the bottom panel's height via the
          --dsh-sidebar-height layout variable) — no JS-written viewport
          coordinates to keep in sync. (Never on narrow viewports: the
          bottom panel does not exist there.)
        */}
        {!narrow && state.panelOpen && state.bottomOpen && (
          <div
            className={css.cornerHandle}
            data-dragging={draggingCorner || undefined}
            onPointerDown={(event) => {
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              dragCommitted.current = false
              cornerDrag.current = {
                startX: event.clientX,
                startY: event.clientY,
                startWidth: state.width,
                startHeight: state.bottomHeight,
              }
              setDraggingCorner(true)
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
              const { startX, startY, startWidth, startHeight } = cornerDrag.current
              const width = clampWidth(startWidth + (startX - event.clientX))
              const height = pushedBottomHeight(true, clampHeight(startHeight + (startY - event.clientY)))
              scheduleDrag(width, height)
            }}
            onPointerUp={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
              if (dragCommitted.current) return
              dragCommitted.current = true
              event.currentTarget.releasePointerCapture(event.pointerId)
              const { startX, startY, startWidth, startHeight } = cornerDrag.current
              // Up position wins over the rAF pending value (see the width
              // strip handler — issue #247).
              const width = clampWidth(startWidth + (startX - event.clientX))
              const height = pushedBottomHeight(true, clampHeight(startHeight + (startY - event.clientY)))
              commitDrag(width, height, s => setBottomHeight(setWidth(s, width), height))
              setDraggingCorner(false)
            }}
            onPointerCancel={(event) => { abortDrag(() => setDraggingCorner(false), event) }}
            onLostPointerCapture={() => { abortDrag(() => setDraggingCorner(false)) }}
          />
        )}
      </div>
      {/*
        The bottom panel: a second, independent workbench. It squeezes ONLY
        the center column (the agent output area): it starts at the app
        shell's own left sidebar and ends at the right panel's left edge —
        neither sidebar gives up any position (the right panel keeps its
        full height). Its resize strip is the top edge; hidden by sliding
        down like the right panel. On NARROW viewports it does not exist —
        the bottom workbench lives inside the drawer (MobileWorkbench).
      */}
      {/* The bottom panel only becomes VISIBLE once the center column is
          measured: before that, `centerRect` is the {0,0} fallback and
          `right` computes to the full viewport width — the panel (and its
          overflow content) would flash full-width for a frame until the
          first measurement lands. Rendering stays unconditional so the
          mount/render chain (auto-terminal etc.) is never gated on
          geometry. */}
      {!narrow && (
      <div
        ref={bottomRef}
        className={clsx(css.bottomPanel, !state.bottomOpen && css.bottomPanelHidden)}
        data-dsh-panel
        data-dsh-bottom-panel
        style={{
          height: bottomPanelHeight,
          left: centerRectRef.current.left,
          // Keep the panel above the on-screen keyboard when the visual
          // viewport shrinks (see the keyboardInset effect).
          bottom: keyboardInset > 0 ? `${keyboardInset}px` : undefined,
          // Direct from the center column's measured right edge: the bottom
          // panel spans ONLY the center column, ending exactly at the
          // details column's left edge (the details column sits between the
          // center and the right panel, and the right panel's margin-right
          // push is already baked into centerRect.right).
          right: window.innerWidth - centerRectRef.current.right,
          // The seam against the open right panel needs its own hairline
          // (the right panel's border-left alone is covered by this panel's
          // fill — without it the corner looks cut off).
          borderRight: state.panelOpen ? '1px solid var(--dsw-alias-border-l2)' : undefined,
          // Unmeasured center column → keep the panel invisible (zero-size
          // geometry would flash full-width overflow instead).
          visibility: centerMeasured ? undefined : 'hidden',
        }}
       
        data-dragging={(draggingBottom || draggingCorner) || undefined}
      >
        <div
          className={clsx(css.bottomResize, draggingBottom && css.bottomResizeActive)}
         
          onPointerDown={(event) => {
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            dragCommitted.current = false
            bottomDrag.current = { startY: event.clientY, startHeight: state.bottomHeight }
            setDraggingBottom(true)
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            const { startY, startHeight } = bottomDrag.current
            const height = pushedBottomHeight(true, clampHeight(startHeight + (startY - event.clientY)))
            scheduleDrag(Math.min(state.width, window.innerWidth), height)
          }}
          onPointerUp={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            if (dragCommitted.current) return
            dragCommitted.current = true
            event.currentTarget.releasePointerCapture(event.pointerId)
            const { startY, startHeight } = bottomDrag.current
            // Up position wins over the rAF pending value (see the width
            // strip handler — issue #247).
            const height = pushedBottomHeight(true, clampHeight(startHeight + (startY - event.clientY)))
            commitDrag(Math.min(state.width, window.innerWidth), height, s => setBottomHeight(s, height))
            setDraggingBottom(false)
          }}
          onPointerCancel={(event) => { abortDrag(() => setDraggingBottom(false), event) }}
          onLostPointerCapture={() => { abortDrag(() => setDraggingBottom(false)) }}
        />
        {/*
          The bottom panel's own close control at its tab strip's right end
          (the strip reserves the width via CSS so the + menu never hides
          under it): one tap collapses the panel.
        */}
        <Tooltip label={t('collapseBottomPanel')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.bottomClose}
            aria-label={t('collapseBottomPanel')}
            onClick={() => { store.reduce(toggleBottomPanel) }}
          >
            <IconCloseFill14 />
          </button>
        </Tooltip>
        <div className={css.panelBody}>
          <Workbench
            state={state}
            tree={state.bottomSplits}
            newTabOptions={buildNewTabOptions(state, ctx, { sessionId, cwd })}
            actions={actions}
            onNewTab={onNewTab}
            renderTab={(tab, active, paneId) => renderTab(tab, active, paneId, 'bottom')}
            getTabIcon={tabIconOf}
            getTabBadge={tabBadgeOf}
          />
        </div>
      </div>
      )}
      {/*
        Free windows: tabs dragged out onto the conversation area (or floated
        from the tab context menu). They live in the panel host like the
        panels (viewport coordinates, immune to desktop-shell transforms) but
        are independent of panel state — a window stays up while panels
        collapse. The floats array's order is the stacking order; the content
        reuses the regular tab renderer, so every tab type floats unchanged.
      */}
      {state.floats.map(float => (
        <FreeWindow
          key={float.id}
          float={float}
          renderTab={(tab, active, paneId) => renderTab(tab, active, paneId, 'float')}
          getTabIcon={tabIconOf}
          onRaise={() => { store.reduce(s => raiseFloat(s, float.id)) }}
          onMove={(x, y) => { store.reduce(s => moveFloat(s, float.id, x, y)) }}
          onResize={(w, h) => { store.reduce(s => resizeFloat(s, float.id, w, h)) }}
          onDock={(paneId) => { store.reduce(s => dockFloat(s, float.id, paneId ?? undefined)) }}
          onClose={() => { ctx.get('betterSidebar')?.closeTab(float.tab.id, sessionId === undefined ? undefined : { sessionId, cwd }) }}
        />
      ))}
      {/*
        The drag-out hint: while a tab drag hovers the conversation column,
        a dashed overlay marks the drop zone there (pointer-transparent — it
        must not disturb the drag it describes).
      */}
      {floatHint !== null && (
        <div
          className={css.floatDropHint}
          style={{ left: floatHint.left, top: floatHint.top, width: floatHint.width, height: floatHint.height }}
        >
          <span className={css.floatDropHintLabel}>{t('floatDropHint')}</span>
        </div>
      )}
    </div>
  )
}
