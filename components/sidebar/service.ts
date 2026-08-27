/**
 * The BetterSidebar client service: a registry that external plugins use
 * to contribute sidebar tab types and file previewers. The service is
 * published to the cordis context as `ctx.betterSidebar` (see
 * {@link ../context-types.ts}); consumers declare it in `inject` and call
 * `registerTab` / `registerFileViewer`, both returning a disposer that
 * cordis auto-invokes on fiber disposal (HMR-safe).
 *
 * Design notes:
 * - The registry is synchronous-snapshot (Map + listener set) so React
 *   can read it through `useSyncExternalStore` without tearing.
 * - `dedupeKey` unifies the three open-tab strategies the builtins used to
 *   hardcode: single-instance (`() => type`), per-path (`tab => tab.path`),
 *   and per-id (`tab => tab.id` for diff tabs whose id is change-derived).
 *   `single: true` is sugar for `dedupeKey: () => id`.
 * - `createTab` lets a descriptor own tab instantiation (the terminal
 *   builtin uses it to mint `terminal:<n>` ids and bump `nextTerminal`).
 * - `matchFileViewer` walks descriptors in priority order (desc, stable):
 *   per descriptor it tries `detect` first (when `head` bytes are given),
 *   then `exts`; `exts: []` is a catch-all that matches any path.
 */
import type { ReactNode } from 'react'
import type { Context } from './context-types'
import {
  activateTab as activateTabReducer, allLeaves, closeTab as closeTabReducer, closeFloatByTab, floatWithTab,
  leafWithTab, openTabInActivePane, patchTab, raiseFloat, tabOpenIn, togglePanel, treeOf,
  type SidebarSnapshot, type SidebarState, type SidebarStore, type SidebarTab,
} from './state'
import { isNarrowWidth } from './breakpoints'
import type { SessionScope } from './api'
import type { SidebarPrefs } from './prefs-shared'

/**
 * Public state vocabulary re-exported for consumers (type-only; the values
 * stay internal). External plugins name these types in their descriptors —
 * e.g. `dedupeKey: (tab: SidebarTab) => tab.id`, `createTab: (state: SidebarState) => …`,
 * or `badge: (…, state: SidebarState) => …`.
 */
export type {
  SidebarTab,
  SidebarState,
  SidebarStore,
  SidebarSnapshot,
  SidebarDiffRef,
  TabType,
} from './state'
export type { SessionScope } from './api'
export type { SidebarPrefs } from './prefs-shared'

/** The row control a declarative setting renders as in the settings popup. */
export type SidebarSettingToggleType = 'switch' | 'text' | 'number' | 'select'

/** One option of a `type: 'select'` setting row. */
export interface SidebarSettingSelectOption {
  /** The value written to the setting key when this option is picked
   *  (JSON-serializable: string / number / boolean). */
  value: string | number | boolean
  /** Option title (i18n friendly: string or () => string). */
  title: string | (() => string)
  /** Option description (i18n friendly); rendered under the title in the
   *  icon dropdown. */
  desc?: string | (() => string)
  /** Option icon: when ANY option declares one, the dropdown renders
   *  big-icon option cards and the closed control shows the selected
   *  option's icon too; without icons both are a single line of text. */
  icon?: ReactNode | ((size: number) => ReactNode)
}

/** One declarative setting of a tab/viewer, rendered as a nested row in the
 *  Side card settings page (e.g. the Subagent page's "auto-open when a
 *  subagent appears" switch, or the terminal's custom font rows). `type`
 *  selects the control: 'switch' (default) renders the custom switch,
 *  'text' a free-form input committed on blur/Enter, 'number' a numeric
 *  input clamped to `min`/`max`, 'select' a dropdown over the declared
 *  `options` (single-pick writes the option's value; `multi: true` writes
 *  the array of picked values and defaults to false). */
export interface SidebarSettingToggle {
  /** The SidebarPrefs field this toggle reads and writes ('autoOpenSubagent'). */
  key: string
  /** Row title (i18n friendly: string or () => string). */
  title: string | (() => string)
  /** Row description (i18n friendly). */
  desc?: string | (() => string)
  /** Row control type; defaults to 'switch' (backward compatible). */
  type?: SidebarSettingToggleType
  /** Lower bound for `type: 'number'` rows (clamped on commit). */
  min?: number
  /** Upper bound for `type: 'number'` rows (clamped on commit). */
  max?: number
  /** Input placeholder for `type: 'text'` rows. */
  placeholder?: string
  /** Unit suffix rendered after the input (e.g. 'px' for a size row). */
  unit?: string
  /** Options of a `type: 'select'` row. */
  options?: readonly SidebarSettingSelectOption[]
  /** Whether a `type: 'select'` row allows picking several options (the
   *  stored value is then an array of option values); defaults to false. */
  multi?: boolean
}

/** Props of a descriptor's custom settings panel (`settings.render`). */
export interface SidebarSettingsRenderProps {
  store: SidebarStore
  service: BetterSidebarService
  prefs: SidebarPrefs
  /** This descriptor's own persisted settings blob (from `pluginSettings[id]`). */
  pluginSettings: Record<string, unknown>
  /** Persist one plugin-owned setting of this descriptor. */
  updatePluginSetting(key: string, value: unknown): void
  /** Close the settings popup. */
  close(): void
}

/** Declarative settings of one registered tab or file viewer. */
export interface SidebarSettingsDeclaration {
  /**
   * Extra settings rows rendered under the feature's own row in the
   * settings page (only while the feature is enabled). Keys must be fields
   * of the host's PrefsSchema (built-ins: 'autoOpenSubagent',
   * 'agentTerminalTools', 'agentOpenTools', 'terminalFontFamily'); unknown
   * keys are dropped by the settings seam.
   */
  toggles?: readonly SidebarSettingToggle[]
  /**
   * Plugin-owned settings rows (v0.12.0+): same row controls as `toggles`
   * (switch/text/number), but the keys are plugin-local and persisted in
   * the sidebar's own prefs document under `pluginSettings[<descriptor id>]`
   * — no host PrefsSchema field needed. Values must be JSON-serializable
   * (the row controls produce strings / numbers / booleans).
   */
  pluginToggles?: readonly SidebarSettingToggle[]
  /**
   * Custom settings panel (v0.12.0+): when given, the gear popup renders
   * this instead of the row lists (`toggles` / `pluginToggles`). Receives
   * the shared store/service, the live prefs, the descriptor's own
   * `pluginSettings` blob, and a persistence helper.
   */
  render?: (props: SidebarSettingsRenderProps) => ReactNode
}

/** Props every tab component receives (builtins and external alike). */
export interface TabComponentProps {
  ctx: Context
  store: SidebarStore
  scope: SessionScope
  tab: SidebarTab
  /** Whether this tab is the active one AND the panel is open (live views pause otherwise). */
  visible: boolean
  /** The explorer's expanded directory set (ExplorerView). */
  expanded?: string[]
  /** The explorer's reveal-highlight set (ExplorerView; "Show in folder" targets). */
  revealed?: string[]
  onToggleDir?: (path: string) => void
  onReferenceFile?: (path: string) => void
  onOpenFile?: (path: string) => void
  onOpenDiff?: (tab: SidebarTab) => void
  onSubagentJump?: (childSessionId: string) => void
}

/** Describes one kind of sidebar tab (builtins register themselves too). */
export interface TabDescriptor {
  /** Unique id; also the `SidebarTab.type` value (`'explorer'`, `'my-plugin:db'`). */
  id: string
  title: string | (() => string)
  icon?: ReactNode | ((size: number) => ReactNode)
  /** + menu sort order (ascending); default 100. */
  order?: number
  /** Hide from the + menu (the editor tab is opened by file-open, not by the menu). */
  hidden?: boolean
  /**
   * + menu disabled predicate (e.g. terminal at capacity). Receives the
   * session scope and the live sidebar state (counts, expansions).
   */
  available?: (ctx: Context, scope: SessionScope, state: SidebarState) => boolean
  /**
   * Single-instance sugar: `true` is shorthand for `dedupeKey: () => id`
   * (opening the tab focuses an existing one of the same type instead of
   * creating a duplicate). An explicit `dedupeKey` always wins when both
   * are given. Builtins: explorer/git/subagent use `single: true`.
   */
  single?: boolean
  /**
   * If provided, opening a tab whose `dedupeKey(tab)` matches an existing
   * tab's key focuses the existing one instead of creating a new one.
   * Returning `undefined` means "no dedup — always open a new tab".
   * Builtins: editor uses `tab => tab.path`; diff uses `tab => tab.id`
   * (openDiffTab mints change-derived ids).
   */
  dedupeKey?: (tab: SidebarTab) => string | undefined
  /**
   * Custom tab creation (minting the `SidebarTab` and any state patches).
   * Return `null` to refuse creation. The terminal builtin uses this to
   * mint `terminal:<n>` ids and bump `nextTerminal`.
   * When omitted, a default `{ id, type, title }` tab is created.
   */
  createTab?: (state: SidebarState) => { tab: SidebarTab; patch?: Partial<SidebarState> } | null
  /**
   * External-link target claim (v0.13.0+): when a GUI external-link click
   * is taken over (the `browserInterceptLinks` master AND the URL's
   * protocol flag — `browserInterceptHttp` / `browserInterceptHttps` —
   * are on), the first registered tab whose `urlTarget(url)` returns true
   * is opened with `openTab({ type, url, title: hostname })` — the URL is
   * the whole payload (the tab reads it from `tab.path`). Registration
   * order wins (first claim first served); a disabled tab type is skipped;
   * a throwing predicate is swallowed (console.error, the type is skipped).
   * The built-in browser tab declares NO urlTarget — it stays the implicit
   * fallback target, so plugins can never be shadowed by it. To host more
   * than one URL at a time, mint per-URL ids through `createTab` (the
   * browser builtin's pattern); otherwise the id safety net focuses the
   * existing tab of the same type and the new URL is not applied.
   */
  urlTarget?: (url: URL) => boolean
  /**
   * Declarative settings shown in the Side card settings page: every
   * registered tab gets an enable/disable switch (icon + title + id), and
   * `settings.toggles` adds nested switches tied to SidebarPrefs fields
   * (e.g. the subagent tab's 'autoOpenSubagent').
   */
  settings?: SidebarSettingsDeclaration
  /**
   * Tab-strip badge (v0.12.0+): a small pill rendered on the tab next to
   * the icon — a number renders as a count (99+ capped), a string renders
   * as-is, null/undefined hides the badge. Called on every tab-bar render,
   * so keep it cheap; a throw is swallowed (no badge shown).
   */
  badge?: (ctx: Context, scope: SessionScope, state: SidebarState) => string | number | null | undefined
  /**
   * Lifecycle callbacks (v0.12.0+). Fired by the SERVICE paths only:
   * `onOpen` when an open actually creates a tab (a dedupe/id-safety-net
   * focus is NOT an open — it fires `onActivate` instead), `onActivate`
   * when a tab is focused (dedupe focus, id-safety-net focus, or the
   * tab-bar activation), `onClose` when a tab is closed through
   * `closeTab`. Builtin-only flows that mutate state directly (the diff
   * split placement, agent-terminal reconcile) never touch external tabs
   * and fire no callbacks. A throwing callback is logged and never breaks
   * the open/close/activate flow.
   */
  onOpen?: (tab: SidebarTab, scope: SessionScope) => void
  onActivate?: (tab: SidebarTab, scope: SessionScope) => void
  onClose?: (tab: SidebarTab, scope: SessionScope) => void
  component: (props: TabComponentProps) => ReactNode
}

/** How the host loads a file's bytes for one viewer. */
export type FileFetchStrategy =
  | 'none'               // no bytes needed (image/pdf/office fetch through mediaUrl themselves)
  | 'fsRead'             // text read through /sidebar/api fs.read
  | 'mediaUrl'           // the viewer gets a media URL string
  | 'custom'             // the viewer's load() fetches its own bytes
  | 'binary-download'    // show a download button (no client-side renderer)

/** Props every file viewer component receives. */
export interface FileViewerProps {
  ctx: Context
  store: SidebarStore
  scope: SessionScope
  path: string
  title: string
  /** The matching descriptor's id (`'code'`, `'my-plugin:csv'`). */
  viewerId: string
  /** fsRead text content (fetchStrategy='fsRead'). */
  content?: string
  truncated?: boolean
  /** mediaUrl for the path (fetchStrategy='mediaUrl'). */
  mediaUrl?: string
  /** custom load() return value (fetchStrategy='custom'). */
  customData?: unknown
  /** Internal (built-in text editor): 'host' asks the viewer to skip its own
   *  toolbar row — the editor host's merged-mode header renders it instead,
   *  fed through the two callbacks below. Viewers that ignore these fields
   *  render exactly as before. */
  toolbar?: 'self' | 'host'
  /** Internal: the viewer reports its toolbar state (mode/dirty/save). */
  onToolbarState?: (state: EditorToolbarState) => void
  /** Internal: the viewer registers its toolbar commands on mount (null on
   *  unmount). */
  onToolbarControls?: (controls: EditorToolbarControls | null) => void
}

/** The toolbar state a text editor reports to the host's merged-mode header. */
export interface EditorToolbarState {
  /** Whether the preview/edit mode toggle applies (markdown/html). */
  modes: boolean
  mode: 'preview' | 'edit'
  dirty: boolean
  /** Whether saving applies (text content loaded). */
  editable: boolean
  saveState: 'idle' | 'saving' | 'saved' | 'failed'
}

/** The commands the host's merged-mode header sends back to the viewer. */
export interface EditorToolbarControls {
  setMode(mode: 'preview' | 'edit'): void
  save(): void
}

/** Describes one file previewer (builtins register themselves too). */
export interface FileViewerDescriptor {
  /** Unique id (`'image'`, `'pdf'`, `'my-plugin:csv'`). */
  id: string
  /** Display name for the settings inventory (falls back to `id` when absent). */
  title?: string | (() => string)
  /** Icon shown in the settings inventory. */
  icon?: ReactNode | ((size: number) => ReactNode)
  /** Lowercase extensions without leading dot (`['png','jpg']`). `[]` = match any (catch-all). */
  exts: readonly string[]
  /** Higher wins; default 0. Builtins use 0; the catch-all `code` viewer uses -100. */
  priority?: number
  fetchStrategy: FileFetchStrategy
  /**
   * Content sniff: when `head` bytes are available the descriptor's `detect`
   * is consulted before its `exts` (per-descriptor, in priority order).
   */
  detect?: (path: string, head: Uint8Array) => boolean
  /** fetchStrategy='custom' loader. `signal` (v0.12.0+) aborts on viewer
   *  teardown / re-match; loaders that ignore it keep working. */
  load?: (path: string, scope: SessionScope, signal?: AbortSignal) => Promise<unknown>
  /**
   * Declarative settings shown in the Side card settings page: every
   * registered viewer gets an enable/disable switch (icon + title + exts).
   */
  settings?: SidebarSettingsDeclaration
  component: (props: FileViewerProps) => ReactNode
}

/** One `openTab` request. */
export interface OpenTabSeed {
  type: string
  /** Overrides the descriptor's title when given (the editor tab shows the file name). */
  title?: string
  /** A file path (the editor tab's content seed). */
  path?: string
  /** A diff reference (the diff tab's content seed). */
  diff?: SidebarTab['diff']
  /** Explicit tab id (defaults to the type). */
  id?: string
  /** A URL the tab navigates to on mount (the browser tab's seed). */
  url?: string
  /** JSON-serializable custom state carried on the minted tab (persisted across reloads; v0.12.0+). */
  meta?: unknown
}

/**
 * The registry service published as `ctx.betterSidebar`.
 */
export interface BetterSidebarService {
  registerTab(descriptor: TabDescriptor): () => void
  registerFileViewer(descriptor: FileViewerDescriptor): () => void
  getTabs(): readonly TabDescriptor[]
  getFileViewers(): readonly FileViewerDescriptor[]
  /** Find a tab descriptor by id (undefined if not registered). */
  getTab(id: string): TabDescriptor | undefined
  /**
   * Whether a tab type is enabled in the side card prefs. An absent
   * `tabsEnabled[id]` entry means enabled — only an explicit `false`
   * disables the type (hidden from the + menu, `openTab` refuses, and
   * derived flows gate on it).
   */
  isTabEnabled(id: string): boolean
  /** Whether a file viewer is enabled (absent `viewersEnabled[id]` = enabled). */
  isViewerEnabled(id: string): boolean
  /**
   * Find a file viewer for a path (priority desc; detect first, then exts).
   * Disabled viewers are skipped, so files fall through to the next match.
   */
  matchFileViewer(path: string, head?: Uint8Array): FileViewerDescriptor | undefined
  /**
   * Open a tab (used by external tabs and the + menu). `title` overrides
   * the descriptor's title when given (the editor tab shows the file name);
   * when the descriptor provides `createTab` it mints the tab itself and
   * `title`/`path`/`id` are ignored. `url` lands the tab with its `path`
   * pre-set to the URL (the browser tab's navigation seed; the caller
   * usually pairs it with a hostname `title`). A disabled tab type is a
   * no-op.
   *
   * `scope` (v0.12.0+) targets a specific session: when given, the open
   * lands in THAT session's sidebar state (loading it if it has none yet)
   * without switching the UI's active session; when absent the open lands
   * in the currently active session (the pre-0.12 behavior).
   *
   * A CONTENT open (a `path` or `url` seed) must land in sight: when the
   * panel hosting the landing pane is collapsed, it is expanded
   * automatically (the right panel by default, the bottom panel when the
   * active pane lives there; on narrow viewports the merged drawer opens).
   * Type-only opens (the + menu, agent-terminal auto-tabs) never expand —
   * the panel behavior is their caller's business.
   *
   * Note: `available` gates the + menu's disabled state only — it does NOT
   * refuse `openTab` (only the settings disable switch does).
   */
  openTab(seed: OpenTabSeed, scope?: SessionScope): void
  /**
   * Close a tab by id (fires descriptor.onClose). An unknown tab id is a
   * strict no-op (no state churn, no callbacks). `scope` (v0.12.0+) rides
   * to the callback (its optional cwd included); absent, the callback gets
   * `{ sessionId }` of the active session.
   */
  closeTab(tabId: string, scope?: SessionScope): void
  /** Subscribe to registry changes (register/dispose). */
  subscribe(listener: () => void): () => void
  /** The plugin version this service instance was built from ('0.12.0'). */
  readonly version: string
  /**
   * Monotonic capability list (v0.12.0+): 'badge' | 'tabLifecycle' |
   * 'updateTab' | 'openFile' | 'targetedOpen' | 'stateSubscription' |
   * 'tabMeta' | 'pluginSettings'. Features are never removed — consumers
   * gate new API usage on membership.
   */
  readonly features: readonly string[]
  /**
   * The current sidebar snapshot: the active session id, its state (panel
   * geometry, open tabs, expansions), and the side card prefs (v0.12.0+).
   * `state`/`sessionId` are undefined until a session becomes active.
   */
  getSnapshot(): SidebarSnapshot
  /** Subscribe to snapshot changes (session switch, state changes, prefs changes). Returns the disposer. */
  subscribeState(listener: () => void): () => void
  /** Update an open tab's display fields (title / path / meta); a missing tab id is a no-op. */
  updateTab(tabId: string, patch: { title?: string; path?: string; meta?: unknown }): void
  /**
   * Activate an open tab (the tab-bar activation path; fires
   * descriptor.onActivate). An unknown tab id is a strict no-op. `scope`
   * (v0.12.0+) rides to the callback like `closeTab`'s.
   */
  activateTab(tabId: string, scope?: SessionScope): void
  /** Open a file in the sidebar editor of `scope`'s session (title defaults to the file name). */
  openFile(scope: SessionScope, path: string, title?: string): void
}

/** Extract the lowercase extension without leading dot from a path. */
function extOfPath(path: string): string {
  const at = path.lastIndexOf('.')
  if (at === -1) return ''
  const base = path.slice(at + 1).toLowerCase()
  return base.includes('/') || base.includes('\\') ? '' : base
}

/** The file name of a path (both separators). */
function baseNameOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * Find the tab type that claims an intercepted external-link URL (v0.13.0+).
 * Walks the descriptors in REGISTRATION order and returns the first one
 * that declares `urlTarget` and matches `url`; a throwing predicate is
 * swallowed (console.error, type skipped) so one broken plugin can never
 * break the whole link pipeline. The caller passes the ENABLED tab
 * descriptors (enablement is the caller's prefs domain — filter
 * `service.getTabs()` through `tabsEnabled` before matching) and falls
 * back to the built-in browser tab when nothing claims the URL (the
 * browser never declares `urlTarget` itself, so it can never shadow a
 * plugin claim).
 */
export function matchUrlTarget(tabs: readonly TabDescriptor[], url: URL): TabDescriptor | undefined {
  for (const tab of tabs) {
    if (tab.urlTarget === undefined) continue
    let claimed = false
    try {
      claimed = tab.urlTarget(url) === true
    } catch (error) {
      console.error('[dsh-better-sidebar] urlTarget error:', error)
      continue
    }
    if (claimed) return tab
  }
  return undefined
}

/**
 * The plugin version this service instance reports. Keep in lockstep with
 * `package.json`'s version — `tests/service.spec.ts` asserts the pair.
 */
export const SIDEBAR_SERVICE_VERSION = '0.17.0'

/**
 * Monotonic capability list consumers use to gate new API usage (features
 * are never removed). Each string names a v0.12.0+ capability:
 * - 'badge': TabDescriptor.badge
 * - 'tabLifecycle': TabDescriptor.onOpen/onActivate/onClose
 * - 'updateTab': BetterSidebarService.updateTab
 * - 'openFile': BetterSidebarService.openFile
 * - 'targetedOpen': BetterSidebarService.openTab(seed, scope?)
 * - 'stateSubscription': getSnapshot/subscribeState
 * - 'tabMeta': SidebarTab.meta (seeds, createTab, updateTab, persistence)
 * - 'pluginSettings': SidebarSettingsDeclaration.pluginToggles/render
 * - 'urlTarget' (v0.13.0): TabDescriptor.urlTarget (external-link claims)
 * - 'settingSelect': SidebarSettingToggle type 'select' (options/multi)
 * - 'floatWindows' (v0.16.0): tabs float as free windows — openTab's dedupe/
 *   id focus targets RAISE the floating window (never duplicate the tab or
 *   expand panels), closeTab on a floating tab closes it with its window.
 */
export const SIDEBAR_FEATURES = [
  'badge',
  'tabLifecycle',
  'updateTab',
  'openFile',
  'targetedOpen',
  'stateSubscription',
  'tabMeta',
  'pluginSettings',
  'urlTarget',
  'settingSelect',
  'floatWindows',
] as const

/** Run one plugin callback; a throw is logged and never breaks the caller. */
function safeCall(fn: () => void): void {
  try {
    fn()
  } catch (error) {
    console.error('[dsh-better-sidebar] plugin callback error:', error)
  }
}

/**
 * Create one BetterSidebar service bound to a store. The service owns the
 * tab/viewer registries (Map + listener set) and proxies openTab/closeTab
 * to the store's reducer. One instance per client plugin activation.
 */
export function createBetterSidebarService(store: SidebarStore): BetterSidebarService {
  const tabs = new Map<string, TabDescriptor>()
  const viewers = new Map<string, FileViewerDescriptor>()
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const fn of [...listeners]) fn()
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  const registerTab = (descriptor: TabDescriptor): (() => void) => {
    if (tabs.has(descriptor.id)) {
      throw new Error(`[dsh-better-sidebar] tab type "${descriptor.id}" already registered`)
    }
    tabs.set(descriptor.id, descriptor)
    notify()
    return () => {
      if (tabs.get(descriptor.id) === descriptor) {
        tabs.delete(descriptor.id)
        notify()
      }
    }
  }

  const registerFileViewer = (descriptor: FileViewerDescriptor): (() => void) => {
    if (viewers.has(descriptor.id)) {
      throw new Error(`[dsh-better-sidebar] file viewer "${descriptor.id}" already registered`)
    }
    viewers.set(descriptor.id, descriptor)
    notify()
    return () => {
      if (viewers.get(descriptor.id) === descriptor) {
        viewers.delete(descriptor.id)
        notify()
      }
    }
  }

  const getTabs = (): readonly TabDescriptor[] => Array.from(tabs.values())
  const getFileViewers = (): readonly FileViewerDescriptor[] => Array.from(viewers.values())
  const getTab = (id: string): TabDescriptor | undefined => tabs.get(id)

  // The enable switches come from the user's side card prefs (the shared
  // store the service is bound to): an absent key means enabled.
  const isTabEnabled = (id: string): boolean => store.getPrefs().tabsEnabled[id] !== false
  const isViewerEnabled = (id: string): boolean => store.getPrefs().viewersEnabled[id] !== false

  const matchFileViewer = (path: string, head?: Uint8Array): FileViewerDescriptor | undefined => {
    const ext = extOfPath(path)
    // Single pass in priority order (descending; stable for equal
    // priorities — insertion order). Each descriptor gets first refusal in
    // its own turn: `detect` (when head bytes are available) beats its own
    // `exts`, and `exts: []` is a catch-all matching any path — so the
    // catch-all `code` viewer (-100) only sees paths no higher-priority
    // descriptor claimed. Disabled viewers are skipped entirely.
    for (const v of Array.from(viewers.values()).sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    )) {
      if (!isViewerEnabled(v.id)) continue
      // Content sniff first (only when head bytes are available).
      if (head !== undefined && v.detect !== undefined) {
        if (v.detect(path, head)) return v
        // A catch-all with detect is SNIFF-ONLY: it must not blind-claim
        // paths it never sniffed (a magic-number viewer must not swallow
        // every file before the real viewers get their turn).
        if (v.exts.length === 0) continue
      } else if (v.exts.length === 0) {
        // Blind catch-all (no detect) claims anything; a sniff-only
        // catch-all (detect defined, no head yet) yields this round.
        if (v.detect === undefined) return v
        continue
      }
      if (v.exts.includes(ext)) return v
    }
    return undefined
  }

  const openTab = (seed: OpenTabSeed, scope?: SessionScope): void => {
    // A type the user disabled in settings never opens — neither from the
    // + menu nor from derived flows (file opens, subagent auto-open,
    // external plugins). Already-open tabs keep rendering.
    if (!isTabEnabled(seed.type)) {
      console.warn(`[dsh-better-sidebar] tab type "${seed.type}" is disabled in the side card settings`)
      return
    }
    const descriptor = tabs.get(seed.type)
    if (descriptor === undefined) return
    // A scope targets another session: the open lands in THAT session's
    // state (loaded on demand) without switching the UI's active session.
    const targetSessionId = scope?.sessionId ?? store.getSnapshot().sessionId
    if (targetSessionId === undefined) return
    const callbackScope: SessionScope = scope ?? { sessionId: targetSessionId }
    // Whether this open targets a session that is NOT the one on screen: a
    // targeted open must not auto-expand panels the user cannot see (the
    // expansion is about landing "in sight" for the CURRENT viewer).
    const activeSessionId = store.getSnapshot().sessionId
    const targetsInactiveSession = scope !== undefined && scope.sessionId !== activeSessionId
    // Lifecycle capture: `created` when the open minted a NEW tab (a
    // dedupe/id-safety-net focus is an ACTIVATION, not an open).
    let created: SidebarTab | undefined
    let activated: SidebarTab | undefined
    const reducer = (state: SidebarState): SidebarState => {
      // Let the descriptor mint the tab (terminal's nextTerminal bump, etc.).
      let tab: SidebarTab
      let next: SidebarState
      if (descriptor.createTab !== undefined) {
        const result = descriptor.createTab(state)
        if (result === null) return state
        tab = result.tab
        next = applyDedupe(state, result.tab, descriptor)
        if (result.patch !== undefined) next = { ...next, ...result.patch }
      } else {
        tab = {
          id: seed.id ?? seed.type,
          type: seed.type,
          // A caller-provided title wins (the editor shows the file name);
          // otherwise the descriptor's (possibly i18n) title is the default.
          title: seed.title ?? (typeof descriptor.title === 'function' ? descriptor.title() : descriptor.title),
          ...(seed.path !== undefined ? { path: seed.path } : {}),
          ...(seed.diff !== undefined ? { diff: seed.diff } : {}),
          ...(seed.meta !== undefined ? { meta: seed.meta } : {}),
        }
        next = applyDedupe(state, tab, descriptor)
      }
      // Classify the landing against the INPUT state FIRST: a FOCUS fires
      // onActivate with the tab that is active NOW; a real creation fires
      // onOpen with the minted tab. Both the dedupeKey match AND the id
      // match count as a focus — a descriptor deduping by key (e.g. editor
      // by path) can focus an existing tab for a NEW requested id, and
      // classifying that as a creation would fire onOpen with a phantom
      // tab that never closes.
      const dedupeKey = descriptor.dedupeKey ?? (descriptor.single === true ? () => descriptor.id : undefined)
      const key = dedupeKey?.(tab)
      const inputTabs = allLeaves(state.splits).concat(allLeaves(state.bottomSplits)).flatMap(leaf => leaf.tabs)
        .concat(state.floats.map(f => f.tab))
      const existedByKey = key !== undefined
        && inputTabs.some(candidate => candidate.type === tab.type && dedupeKey!(candidate) === key)
      const existedById = tabOpenIn(state, tab.id)
      const isCreation = !existedByKey && !existedById
      // A URL seed pre-fills a NEWLY CREATED tab's path (the browser tab
      // navigates to it on mount); a FOCUS must never have its path
      // overwritten. An explicit seed.title still wins over a createTab-
      // minted default title (e.g. the sidebar-browser's hostname title).
      let landed: SidebarState = next
      if (seed.url !== undefined && isCreation) {
        landed = patchTab(next, tab.id, {
          path: seed.url,
          ...(seed.title !== undefined ? { title: seed.title } : {}),
        })
      }
      // Lifecycle capture (before the auto-expand block, which early-returns).
      if (isCreation) {
        // Resolve the ACTUAL landed tab — the url patch mints a new object,
        // so the callback must see the tab that was really inserted.
        const landedTabs = allLeaves(landed.splits).concat(allLeaves(landed.bottomSplits)).flatMap(leaf => leaf.tabs)
        created = landedTabs.find(candidate => candidate.id === tab.id) ?? tab
      } else {
        // A focus happened: resolve the tab that is actually active now and
        // report THAT to onActivate (never the caller's un-inserted seed).
        // The pool covers free windows too — a floating instance focuses by
        // raising, and the callback must see the real (patched) tab.
        const candidates = allLeaves(landed.splits).concat(allLeaves(landed.bottomSplits)).flatMap(leaf => leaf.tabs)
          .concat(landed.floats.map(f => f.tab))
        activated = key !== undefined
          ? candidates.find(candidate => candidate.type === tab.type && dedupeKey!(candidate) === key)
          : candidates.find(candidate => candidate.id === tab.id)
        activated ??= tab
      }
      // A CONTENT open that focuses an existing FLOATING tab is already in
      // sight (free windows render regardless of panel state): expanding a
      // panel for it would point the user at a pane the content is not in.
      if (
        !isCreation
        && floatWithTab(landed, activated?.id ?? tab.id) !== undefined
      ) {
        return landed
      }
      // A CONTENT open (file / browser) must land in sight: when the panel
      // hosting the landing pane is collapsed, expand it. On narrow
      // viewports the two workbenches merge into one drawer, so the drawer
      // (panelOpen) is the only lever; on wide viewports the landing pane's
      // own panel opens — the bottom panel when the active pane lives in the
      // bottom tree, else the right panel. Type-only opens (+ menu,
      // agent-terminal auto-tabs) never expand (the panel behavior is their
      // caller's business). The check runs on the post-dedupe state, so a
      // content open that merely FOCUSES an existing tab expands the panel
      // too — the open must never land out of sight. Opens targeted at an
      // INACTIVE session never expand (nothing is in sight for the user).
      if (
        !targetsInactiveSession
        && typeof window !== 'undefined'
        && (seed.path !== undefined || seed.url !== undefined)
      ) {
        if (isNarrowWidth(window.innerWidth)) {
          if (!landed.panelOpen) return togglePanel(landed)
        } else {
          const hostKey = treeOf(landed, landed.activePane ?? '')
          if (hostKey === 'bottomSplits') {
            if (!landed.bottomOpen) return { ...landed, bottomOpen: true }
          } else if (!landed.panelOpen) {
            return togglePanel(landed)
          }
        }
      }
      return landed
    }
    // A scope targeting ANOTHER session lands the open there without
    // switching the UI; a scope naming the active session (or no scope)
    // takes the regular reduce path so the UI notifies and re-renders.
    if (targetsInactiveSession) {
      store.reduceFor(scope.sessionId, reducer)
    } else {
      store.reduce(reducer)
    }
    if (created !== undefined) safeCall(() => descriptor.onOpen?.(created!, callbackScope))
    else if (activated !== undefined) safeCall(() => descriptor.onActivate?.(activated!, callbackScope))
  }

  const closeTab = (tabId: string, scope?: SessionScope): void => {
    let closed: SidebarTab | undefined
    store.reduce((state) => {
      // Unknown tab ids are a strict no-op: no state churn, no notify, no
      // pointless localStorage rewrite (mirrors updateTab's short-circuit).
      if (!tabOpenIn(state, tabId)) return state
      // A floating tab closes WITH its window — the float is the tab's pane.
      const float = floatWithTab(state, tabId)
      if (float !== undefined) {
        closed = float.tab
        return closeFloatByTab(state, tabId)
      }
      const paneId = findPaneIdOf(state, tabId)
      const leaf = leafWithTab(state[treeOf(state, paneId)], tabId)
      closed = leaf?.tabs.find(tab => tab.id === tabId)
      return closeTabReducer(state, paneId, tabId)
    })
    if (closed !== undefined) {
      const sessionId = scope?.sessionId ?? store.getSnapshot().sessionId
      if (sessionId !== undefined) {
        const descriptor = tabs.get(closed.type)
        // An explicit scope (with its optional cwd) rides to the callback.
        safeCall(() => descriptor?.onClose?.(closed!, scope ?? { sessionId }))
      }
    }
  }

  /** The snapshot the store publishes (state/prefs carry the active session). */
  const getSnapshot = (): SidebarSnapshot => store.getSnapshot()

  /** Store changes: session switch, state mutations, prefs writes. */
  const subscribeState = (listener: () => void): (() => void) => store.subscribe(listener)

  /** Patch an open tab's display fields (a missing tab id is a no-op). */
  const updateTab = (tabId: string, patch: { title?: string; path?: string; meta?: unknown }): void => {
    store.reduce((state) => patchTab(state, tabId, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.path !== undefined ? { path: patch.path } : {}),
      ...(patch.meta !== undefined ? { meta: patch.meta } : {}),
    }))
  }

  /** Activate an open tab (the tab-bar activation path; fires onActivate). */
  const activateTab = (tabId: string, scope?: SessionScope): void => {
    let activated: SidebarTab | undefined
    store.reduce((state) => {
      // Unknown tab ids are a strict no-op (no state churn / notify).
      if (!tabOpenIn(state, tabId)) return state
      // A floating tab "activates" by raising its window — no pane switch.
      const float = floatWithTab(state, tabId)
      if (float !== undefined) {
        activated = float.tab
        return raiseFloat(state, float.id)
      }
      const paneId = findPaneIdOf(state, tabId)
      const leaf = leafWithTab(state[treeOf(state, paneId)], tabId)
      activated = leaf?.tabs.find(tab => tab.id === tabId)
      return activateTabReducer(state, paneId, tabId)
    })
    if (activated !== undefined) {
      const sessionId = scope?.sessionId ?? store.getSnapshot().sessionId
      if (sessionId !== undefined) {
        const descriptor = tabs.get(activated.type)
        // An explicit scope (with its optional cwd) rides to the callback.
        safeCall(() => descriptor?.onActivate?.(activated!, scope ?? { sessionId }))
      }
    }
  }

  /** Open a file in the sidebar editor of `scope`'s session (title defaults
   *  to the file name; the tab id is path-derived, like the internal
   *  open-path interception, so distinct files open side by side). */
  const openFile = (scope: SessionScope, path: string, title?: string): void => {
    openTab({ type: 'editor', title: title ?? baseNameOf(path), path, id: `editor:${path}` }, scope)
  }

  return {
    registerTab,
    registerFileViewer,
    getTabs,
    getFileViewers,
    getTab,
    isTabEnabled,
    isViewerEnabled,
    matchFileViewer,
    openTab,
    closeTab,
    subscribe,
    version: SIDEBAR_SERVICE_VERSION,
    features: SIDEBAR_FEATURES,
    getSnapshot,
    subscribeState,
    updateTab,
    activateTab,
    openFile,
  }
}

/**
 * Apply dedup: if a tab whose `dedupeKey` matches an existing tab of the
 * same type exists, focus it; otherwise land the tab through
 * `openTabInActivePane` (the id safety net + active-pane landing are that
 * reducer's job — not re-implemented here).
 * `single: true` resolves to the id-key sugar when no explicit key is given.
 */
function applyDedupe(state: SidebarState, tab: SidebarTab, descriptor: TabDescriptor): SidebarState {
  const dedupeKey = descriptor.dedupeKey ?? (descriptor.single === true ? () => descriptor.id : undefined)
  const key = dedupeKey?.(tab)
  if (key !== undefined) {
    // The scan covers BOTH trees: opening a single-instance tab from the
    // bottom panel focuses an existing instance wherever it lives.
    for (const leaf of allLeaves(state.splits).concat(allLeaves(state.bottomSplits))) {
      const existing = leaf.tabs.find(t => t.type === tab.type && dedupeKey!(t) === key)
      if (existing !== undefined) return activateTabReducer(state, leaf.id, existing.id)
    }
    // A floating instance focuses by raising its window (no duplicate tab,
    // no panel expansion — the window is the tab's pane).
    const floated = state.floats.find(f => f.tab.type === tab.type && dedupeKey!(f.tab) === key)
    if (floated !== undefined) return raiseFloat(state, floated.id)
  }
  return openTabInActivePane(state, tab)
}

/** Find which pane hosts a tab id ('' if none). Either tree is searched. */
function findPaneIdOf(state: SidebarState, tabId: string): string {
  for (const leaf of allLeaves(state.splits).concat(allLeaves(state.bottomSplits))) {
    if (leaf.tabs.some(t => t.id === tabId)) return leaf.id
  }
  return state.activePane ?? ''
}
