/**
 * Shared "Side card" preference vocabulary (types + constants), consumed by
 * BOTH halves: the host registers the schemastery schema over these values
 * (config.ts) and the client reads/writes them through the settings RPC
 * (client/prefs.ts, client/SideCardSection.tsx). Kept free of schemastery so
 * the browser bundle never pulls the schema runtime in.
 */

/** The user-settings namespace holding the side card preferences. */
export const SIDEBAR_PREFS_NS = 'dsh-better-sidebar'

/** User-facing side card preferences (new-conversation defaults). */
export interface SidebarPrefs {
  /** Whether a brand-new conversation opens the side card by default. */
  openByDefault: boolean
  /** Default panel width as a percent of the window width (20–60). */
  defaultWidthPercent: number
  /**
   * Whether the sidebar auto-activates (opens the panel) and expands the
   * Subagent page when the current conversation spawns a new subagent.
   */
  autoOpenSubagent: boolean
  /**
   * Whether the sidebar auto-activates (opens the panel) and expands the
   * Jobs page when a NEW background job appears for the current
   * conversation (any new job id, not just the first one).
   */
  autoOpenJobs: boolean
  /**
   * Whether the model-facing agent terminal tools (terminal_create / list /
   * send / read / wait_for / resize / signal / close) are injected into the
   * model's toolset. Off by default: the feature stays dormant until the
   * user explicitly enables it in the side card settings.
   */
  agentTerminalTools: boolean
  /**
   * Whether the model-facing `sidebar_open` tool is injected into the
   * model's toolset — one tool that lets the model actively open a local
   * file, a local folder (as a tree rooted there), or an HTTP(S) page in
   * the calling session's sidebar. Off by default: the feature stays
   * dormant until the user explicitly enables it in the side card settings.
   */
  agentOpenTools: boolean
  /**
   * Custom terminal font-family stack (a CSS font-family value, e.g.
   * `'JetBrains Mono', monospace`). Empty string follows the app's theme
   * monospace font (`--ds-font-family-code`). Applied live to every
   * terminal tab; configured under the terminal card's secondary settings.
   */
  terminalFontFamily: string
  /**
   * Custom terminal font size in px (9–32). Applied live to every terminal
   * tab; configured under the terminal card's secondary settings.
   */
  terminalFontSize: number
  /**
   * Whether expanding the bottom panel for the FIRST time in a session tries
   * to open a fresh terminal tab there (the terminal quota/type still gates
   * the attempt). On by default; the switch lives under the terminal tab's
   * row in the Side card settings.
   */
  bottomPanelAutoTerminal: boolean
  /**
   * Whether chat-side file opens (tool-row path links, the produced-files
   * row, prose file mentions — every path that funnels through the client
   * runtime's `ctx.workspaces.openPath`) open in the sidebar editor instead
   * of the Host OS's default application. On by default; the editor tab's
   * own enable switch gates it too (both must be on for the takeover).
   */
  interceptOpenPath: boolean
  /**
   * Whether the editor tab runs in merged mode: a path input replaces the
   * plain header and a toggleable file-tree panel (with a global name
   * search) docks at the tab's right edge. On by default; also makes brand
   * new sessions seed an empty editor tab (tree panel open) instead of the
   * explorer tab. The switch lives under the editor card's gear in the
   * Side card settings; off restores the pre-merge editor exactly.
   */
  editorExplorer: boolean
  /**
   * The shell the UI and agent terminals spawn (absolute path or bare
   * executable name). Empty (default) keeps the legacy resolution order:
   * `cordis.patch.yml` `config.shell`, then `$SHELL` / login shell /
   * `powershell.exe` on Windows. Set it from the terminal card's gear in
   * the Side card settings (or the yaml) to pin a specific shell — takes
   * effect for terminals opened afterwards.
   */
  terminalShell: string
  /**
   * Explicit arguments for `terminalShell`, space-separated (empty keeps
   * the platform defaults; when set, they fully replace them — same
   * contract as the yaml `shellArgs`).
   */
  terminalShellArgs: string
  /**
   * Title-bar / shell compatibility scheme (the "位置兼容模式" setting):
   * - `auto` (default): CONSERVATIVE — only the standard Window Controls
   *   Overlay API (present in frameless Chromium shells that draw the
   *   native caption buttons over web content) contributes real geometry;
   *   without it nothing is modified, so plain-browser (web) behavior is
   *   untouched.
   * - `web`: EXPLICIT "DSH official web" — never adapt, not even WCO
   *   geometry (the user declares they run the plain web UI).
   * - `preset`: apply the built-in shell preset named by
   *   `titleBarPresetId` (data-driven, opt-in — see shell-presets.ts).
   * - `custom`: apply the free-form `customCss` (and the legacy
   *   `titleBarStripPx` strip).
   */
  titleBarScheme: TitleBarScheme
  /**
   * The built-in shell preset id applied while `titleBarScheme` is
   * `preset` ('' = no preset — nothing extra is applied).
   */
  titleBarPresetId: string
  /**
   * Free-form CSS injected into the page (last in the cascade, so it can
   * override the plugin's styles; use `!important` to override JS-written
   * inline CSS variables). Applied while `titleBarScheme` is `custom`.
   */
  customCss: string
  /**
   * LEGACY (kept for read-migration and downgrade mirroring only): position
   * compatibility mode flag. The UI writes `titleBarScheme` instead; a
   * stored `true` without a scheme migrates to the `custom` scheme (with
   * `titleBarStripPx` preserved).
   */
  titleBarCompat: boolean
  /**
   * LEGACY (kept for read-migration and downgrade mirroring only): the
   * reserved top strip height in px used by the `custom` scheme (0–120,
   * default 40). Drives the `--dsh-title-bar-strip` CSS variable: the
   * toggle cluster drops `strip + 3px` and the right panel's content
   * starts `strip` px below its top edge.
   */
  titleBarStripPx: number
  /**
   * Whether the HTML previewer drops its sandboxed iframe. Sandbox ON (the
   * default) renders previewed HTML in an opaque-origin iframe that cannot
   * touch the GUI; turning it OFF runs the previewed page with the GUI's
   * own origin — full read/write access to session files and internal
   * APIs. Only for trusted local content; the setting copy warns.
   */
  htmlViewerNoSandbox: boolean
  /**
   * Whether a newly opened HTML preview starts UNSANDBOXED (the per-surface
   * temporary unlock pre-applied). Off by default: previews open sandboxed
   * and the status row offers the one-tap unlock; when on, previews open
   * in the red unsandboxed state and the status row offers a one-tap
   * restore for the current file.
   */
  htmlViewerDefaultUnsafe: boolean
  /**
   * Whether the browser tab drops its sandboxed iframe. Sandbox ON (the
   * default) keeps browsed sites in an opaque origin with no GUI access;
   * turning it OFF runs any visited site with the GUI's own origin — it
   * can read session data and act as the logged-in GUI. Only for trusted
   * sites; the setting copy warns.
   */
  browserNoSandbox: boolean
  /**
   * MASTER switch: whether clicking an EXTERNAL link in the GUI (chat
   * messages, tool rows, prose mentions) is taken over into the sidebar at
   * all. On by default; the per-protocol granularity lives in
   * `browserInterceptHttp` / `browserInterceptHttps` (the protocol flag
   * must also be on), and the target tab's own enable switch gates it too.
   * Ctrl/Cmd+click always bypasses the takeover. Kept as the master so old
   * documents keep their meaning with no migration (an explicit `false`
   * stays "never take over").
   */
  browserInterceptLinks: boolean
  /**
   * Whether clicking an http EXTERNAL link in the GUI opens the sidebar
   * (the built-in browser tab, or a plugin tab that declares `urlTarget`)
   * instead of a new browser tab. On by default; gated on the
   * `browserInterceptLinks` master and the target tab's own enable switch.
   */
  browserInterceptHttp: boolean
  /**
   * Whether clicking an https EXTERNAL link in the GUI opens the sidebar
   * instead of a new browser tab. OFF by default — most https sites (e.g.
   * GitHub) refuse iframe embedding, so the system browser is the smoother
   * default; gated on the `browserInterceptLinks` master and the target
   * tab's own enable switch.
   */
  browserInterceptHttps: boolean
  /**
   * Comma-separated allowlist of local (loopback) authorities the browser
   * tab may navigate to — `localhost`, `127.0.0.1`, `127.0.0.1:5174`, or
   * host:port pairs. Empty by default: loopback addresses stay blocked so a
   * browsed page cannot probe local services. Each entry is either a bare
   * hostname (all ports) or host:port; the GUI's own origin is always
   * allowed regardless. The iframe sandbox still renders allowed local
   * pages in an opaque origin, exactly like any other site.
   */
  browserAllowedLoopback: string
  /**
   * Per-tab enable switches, keyed by tab descriptor id (`'explorer'`,
   * `'my-plugin:db'`). An ABSENT key means enabled — only an explicit
   * `false` disables a tab type (hidden from the + menu, `openTab` refuses,
   * and derived flows like subagent auto-open / agent-terminal tabs stop).
   * Already-open tabs of a disabled type keep rendering (closing one
   * prevents reopening), matching the "existing conversations keep their
   * own layouts" rule.
   */
  tabsEnabled: Record<string, boolean>
  /**
   * Per-viewer enable switches, keyed by file viewer descriptor id
   * (`'image'`, `'my-plugin:csv'`). An ABSENT key means enabled; a disabled
   * viewer is skipped by `matchFileViewer` so files fall through to the
   * next matching viewer (or the download button when none match).
   */
  viewersEnabled: Record<string, boolean>
  /**
   * Plugin-owned settings blobs (v0.12.0+), keyed by descriptor id: each
   * registered tab/viewer that declares `settings.pluginToggles` (or writes
   * through `settings.render`'s `updatePluginSetting`) persists its values
   * here — an open map, so third-party keys need no host PrefsSchema field.
   * Values are JSON-serializable (the row controls produce strings /
   * numbers / booleans; custom panels are responsible for their own).
   */
  pluginSettings: Record<string, Record<string, unknown>>
}

/** Range contract of {@link SidebarPrefs.defaultWidthPercent}. */
export const WIDTH_PERCENT_MIN = 20
export const WIDTH_PERCENT_MAX = 60
export const WIDTH_PERCENT_DEFAULT = 35

/** Range contract of {@link SidebarPrefs.terminalFontSize}. */
export const TERMINAL_FONT_SIZE_MIN = 9
export const TERMINAL_FONT_SIZE_MAX = 32
export const TERMINAL_FONT_SIZE_DEFAULT = 13

/** Range contract of {@link SidebarPrefs.titleBarStripPx}. */
export const TITLE_BAR_STRIP_MIN = 0
export const TITLE_BAR_STRIP_MAX = 120
export const TITLE_BAR_STRIP_DEFAULT = 40

/** The title-bar / shell compatibility schemes (see {@link SidebarPrefs.titleBarScheme}). */
export const TITLE_BAR_SCHEMES = ['auto', 'web', 'preset', 'custom'] as const
export type TitleBarScheme = typeof TITLE_BAR_SCHEMES[number]

/** Fallback prefs used whenever the settings document is unreachable or malformed. */
export const SIDEBAR_PREFS_DEFAULTS: SidebarPrefs = {
  openByDefault: false,
  defaultWidthPercent: WIDTH_PERCENT_DEFAULT,
  autoOpenSubagent: true,
  autoOpenJobs: true,
  agentTerminalTools: false,
  agentOpenTools: false,
  bottomPanelAutoTerminal: true,
  terminalFontFamily: '',
  terminalFontSize: TERMINAL_FONT_SIZE_DEFAULT,
  interceptOpenPath: true,
  editorExplorer: false,
  terminalShell: '',
  terminalShellArgs: '',
  titleBarScheme: 'auto',
  titleBarPresetId: '',
  customCss: '',
  titleBarCompat: false,
  titleBarStripPx: TITLE_BAR_STRIP_DEFAULT,
  htmlViewerNoSandbox: false,
  htmlViewerDefaultUnsafe: false,
  browserNoSandbox: false,
  browserInterceptLinks: true,
  browserInterceptHttp: true,
  browserInterceptHttps: false,
  browserAllowedLoopback: '',
  tabsEnabled: {},
  viewersEnabled: {},
  pluginSettings: {},
}

/** Clamp one width percent into the contract range (shared by schema and client reads). */
export function clampWidthPercent(value: number): number {
  return Math.min(WIDTH_PERCENT_MAX, Math.max(WIDTH_PERCENT_MIN, Math.round(value)))
}

/** Clamp one terminal font size into the contract range (shared by schema and client reads). */
export function clampTerminalFontSize(value: number): number {
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(value)))
}

/** Clamp one title-bar strip height into the contract range (shared by schema and client reads). */
export function clampTitleBarStrip(value: number): number {
  return Math.min(TITLE_BAR_STRIP_MAX, Math.max(TITLE_BAR_STRIP_MIN, Math.round(value)))
}
