/**
 * Client-side read of the user-facing "Side card" preferences. The host owns
 * the namespace through the settings seam (in-process); the DSH settings RPC
 * domain only serves allowlisted namespaces to configuration clients, so the
 * client reads and writes THIS namespace through the plugin's own fenced
 * /sidebar routes instead (api.settingsGet/settingsUpdate). Any failure
 * (route rejected, namespace absent, a field of the wrong type, a value out
 * of the contract range) falls back to the schema defaults — the side card
 * must keep working exactly as composed when the settings surface is missing.
 */
import type { api } from './api'
import {
  clampTerminalFontSize,
  clampTitleBarStrip,
  clampWidthPercent,
  SIDEBAR_PREFS_DEFAULTS,
  TITLE_BAR_SCHEMES,
  TITLE_BAR_STRIP_DEFAULT,
  type SidebarPrefs,
  type TitleBarScheme,
} from './prefs-shared'

export {
  SIDEBAR_PREFS_DEFAULTS,
  TITLE_BAR_SCHEMES,
  TITLE_BAR_STRIP_DEFAULT,
  clampTerminalFontSize,
  clampTitleBarStrip,
  clampWidthPercent,
}
export type { SidebarPrefs, TitleBarScheme }

/** The settings wire face the preferences need (a subset of the plugin api). */
export type SidebarSettingsClient = Pick<typeof api, 'settingsGet' | 'settingsUpdate'>

/** Validate one raw resolved value into {@link SidebarPrefs}. Used for the
 * settings.get payload AND the settings.update response (both carry the
 * layered resolved value); any malformed field falls back to its default.
 * @param value - the raw resolved section from the settings wire.
 * @returns validated prefs (always well-formed).
 */
export function parsePrefs(value: unknown): SidebarPrefs {
  if (value === null || typeof value !== 'object') return { ...SIDEBAR_PREFS_DEFAULTS }
  const record = value as Record<string, unknown>
  return {
    openByDefault: typeof record.openByDefault === 'boolean'
      ? record.openByDefault
      : SIDEBAR_PREFS_DEFAULTS.openByDefault,
    defaultWidthPercent: typeof record.defaultWidthPercent === 'number' && Number.isFinite(record.defaultWidthPercent)
      ? clampWidthPercent(record.defaultWidthPercent)
      : SIDEBAR_PREFS_DEFAULTS.defaultWidthPercent,
    autoOpenSubagent: typeof record.autoOpenSubagent === 'boolean'
      ? record.autoOpenSubagent
      : SIDEBAR_PREFS_DEFAULTS.autoOpenSubagent,
    autoOpenJobs: typeof record.autoOpenJobs === 'boolean'
      ? record.autoOpenJobs
      : SIDEBAR_PREFS_DEFAULTS.autoOpenJobs,
    agentTerminalTools: typeof record.agentTerminalTools === 'boolean'
      ? record.agentTerminalTools
      : SIDEBAR_PREFS_DEFAULTS.agentTerminalTools,
    agentOpenTools: typeof record.agentOpenTools === 'boolean'
      ? record.agentOpenTools
      : SIDEBAR_PREFS_DEFAULTS.agentOpenTools,
    bottomPanelAutoTerminal: typeof record.bottomPanelAutoTerminal === 'boolean'
      ? record.bottomPanelAutoTerminal
      : SIDEBAR_PREFS_DEFAULTS.bottomPanelAutoTerminal,
    terminalFontFamily: typeof record.terminalFontFamily === 'string'
      ? record.terminalFontFamily
      : SIDEBAR_PREFS_DEFAULTS.terminalFontFamily,
    terminalShell: typeof record.terminalShell === 'string'
      ? record.terminalShell
      : SIDEBAR_PREFS_DEFAULTS.terminalShell,
    terminalShellArgs: typeof record.terminalShellArgs === 'string'
      ? record.terminalShellArgs
      : SIDEBAR_PREFS_DEFAULTS.terminalShellArgs,
    terminalFontSize: typeof record.terminalFontSize === 'number' && Number.isFinite(record.terminalFontSize)
      ? clampTerminalFontSize(record.terminalFontSize)
      : SIDEBAR_PREFS_DEFAULTS.terminalFontSize,
    interceptOpenPath: typeof record.interceptOpenPath === 'boolean'
      ? record.interceptOpenPath
      : SIDEBAR_PREFS_DEFAULTS.interceptOpenPath,
    editorExplorer: typeof record.editorExplorer === 'boolean'
      ? record.editorExplorer
      : SIDEBAR_PREFS_DEFAULTS.editorExplorer,
    // The title-bar scheme (auto | web | preset | custom). The schema
    // declares the field WITHOUT a default, so documents written by older
    // plugin versions resolve without it — migrate from the legacy fields:
    // a document that ALREADY HAS VALUES (the manual compat flag on, or a
    // non-default strip px — both only reachable through the old gear
    // popup) maps to the `custom` scheme so the user's numbers keep
    // working; a pristine document keeps the conservative `auto` scheme.
    titleBarScheme: isTitleBarScheme(record.titleBarScheme)
      ? record.titleBarScheme
      : (record.titleBarCompat === true || hasLegacyStripValue(record.titleBarStripPx) ? 'custom' : 'auto'),
    titleBarPresetId: typeof record.titleBarPresetId === 'string'
      ? record.titleBarPresetId
      : SIDEBAR_PREFS_DEFAULTS.titleBarPresetId,
    customCss: typeof record.customCss === 'string'
      ? record.customCss
      : SIDEBAR_PREFS_DEFAULTS.customCss,
    titleBarCompat: typeof record.titleBarCompat === 'boolean'
      ? record.titleBarCompat
      : SIDEBAR_PREFS_DEFAULTS.titleBarCompat,
    titleBarStripPx: typeof record.titleBarStripPx === 'number' && Number.isFinite(record.titleBarStripPx)
      ? clampTitleBarStrip(record.titleBarStripPx)
      : SIDEBAR_PREFS_DEFAULTS.titleBarStripPx,
    htmlViewerNoSandbox: typeof record.htmlViewerNoSandbox === 'boolean'
      ? record.htmlViewerNoSandbox
      : SIDEBAR_PREFS_DEFAULTS.htmlViewerNoSandbox,
    htmlViewerDefaultUnsafe: typeof record.htmlViewerDefaultUnsafe === 'boolean'
      ? record.htmlViewerDefaultUnsafe
      : SIDEBAR_PREFS_DEFAULTS.htmlViewerDefaultUnsafe,
    browserNoSandbox: typeof record.browserNoSandbox === 'boolean'
      ? record.browserNoSandbox
      : SIDEBAR_PREFS_DEFAULTS.browserNoSandbox,
    browserInterceptLinks: typeof record.browserInterceptLinks === 'boolean'
      ? record.browserInterceptLinks
      : SIDEBAR_PREFS_DEFAULTS.browserInterceptLinks,
    browserInterceptHttp: typeof record.browserInterceptHttp === 'boolean'
      ? record.browserInterceptHttp
      : SIDEBAR_PREFS_DEFAULTS.browserInterceptHttp,
    browserInterceptHttps: typeof record.browserInterceptHttps === 'boolean'
      ? record.browserInterceptHttps
      : SIDEBAR_PREFS_DEFAULTS.browserInterceptHttps,
    browserAllowedLoopback: typeof record.browserAllowedLoopback === 'string'
      ? record.browserAllowedLoopback
      : SIDEBAR_PREFS_DEFAULTS.browserAllowedLoopback,
    tabsEnabled: booleanMapOf(record.tabsEnabled),
    viewersEnabled: booleanMapOf(record.viewersEnabled),
    pluginSettings: pluginSettingsMapOf(record.pluginSettings),
  }
}

/**
 * Validate the plugin-owned settings map (v0.12.0+): `{ descriptorId: { key:
 * value } }`, nested open maps. Any non-object value (or a malformed whole)
 * falls back to the empty map — the schema defaults already guard the wire
 * shape, this is the client's second line.
 */
function pluginSettingsMapOf(value: unknown): Record<string, Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, Record<string, unknown>> = {}
  for (const [id, blob] of Object.entries(value as Record<string, unknown>)) {
    if (blob !== null && typeof blob === 'object' && !Array.isArray(blob)) {
      out[id] = blob as Record<string, unknown>
    }
  }
  return out
}

/**
 * Validate one enable-switch map (per-tab / per-viewer). Only boolean values
 * survive; a non-object or a non-boolean entry falls back to the empty map /
 * drops the entry — an absent key means the feature stays enabled.
 */
function booleanMapOf(value: unknown): Record<string, boolean> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, boolean> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'boolean') out[key] = item
  }
  return out
}

/** Type guard for the title-bar scheme union (anything else falls back). */
function isTitleBarScheme(value: unknown): value is TitleBarScheme {
  return typeof value === 'string' && (TITLE_BAR_SCHEMES as readonly string[]).includes(value)
}

/**
 * Whether the legacy document carries an explicit strip value (only
 * reachable through the old gear popup): a stored number different from the
 * default counts as "the user already configured something" and migrates to
 * the `custom` scheme.
 */
function hasLegacyStripValue(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value !== TITLE_BAR_STRIP_DEFAULT
}

/**
 * Read the resolved side card preferences through the plugin's settings route.
 * @param settings - the settings wire face (the plugin api by default).
 * @returns validated prefs, or the schema defaults when the route rejects,
 * the namespace is absent, or a stored value violates the contract.
 */
export async function loadPrefs(settings: SidebarSettingsClient): Promise<SidebarPrefs> {
  try {
    const view = await settings.settingsGet()
    return parsePrefs(view.value)
  } catch {
    // Transport/fence rejection or a malformed response: keep the defaults.
    return { ...SIDEBAR_PREFS_DEFAULTS }
  }
}

/**
 * Read the external-disable flag from the same settings route: the
 * dsh-web-ui family's aionui-panel provider choice. True only when the host
 * resolved `aionui-panel.rightPanel` to 'aionui-panel' — while true the
 * sidebar must not mount (the two right panels are mutually exclusive). Any
 * failure (route rejected, aionui absent, malformed response) reads false,
 * so a missing family never hides the sidebar.
 * @param settings - the settings wire face (the plugin api by default).
 * @returns the external-disable flag (false on any failure).
 */
export async function loadExternalDisable(settings: SidebarSettingsClient): Promise<boolean> {
  try {
    const view = await settings.settingsGet()
    return view.externalDisable === true
  } catch {
    return false
  }
}
