/**
 * "Side card" settings section: the user-facing preferences for the sidebar
 * panel, rendered natively in the DSH Settings shell (nav label "Side card").
 *
 * The section is DECLARATIVE — it renders the enable/disable inventory from
 * the sidebar service's registries instead of hardcoding rows:
 *  - 常规: new conversations open the panel by default (a toggle row), the
 *    default panel width as a percent of the window (number input row), and
 *    the open-path interception toggle — the DSH settings-row recipe
 *    (title/desc left + control right, hairline separators).
 *  - 侧边栏内容: one SMALL CARD per REGISTERED tab type (built-ins and
 *    external plugins alike), laid out in a responsive grid that wraps
 *    several cards per row — icon chip + title + type id, clicked to toggle
 *    the switch persisted in `prefs.tabsEnabled[id]`.
 *  - 文件预览: one SMALL CARD per REGISTERED file viewer — icon chip + title
 *    + the extensions it covers, clicked to toggle `prefs.viewersEnabled[id]`.
 *
 * Every group lives in a container card (the DSH PluginCard recipe: l2
 * hairline, 16px radius, layer-3 fill) with a heading and an inventory count
 * badge (the settings catalogHeading recipe); the section opens with a
 * one-line intro (the DSH section heading+intro recipe).
 *
 * A card's on/off state is its VISUAL STATE: enabled = highlighted (brand
 * border + tinted fill + a compact switch knob at the card's far right),
 * disabled = neutral and dimmed. Features that declare
 * `settings.toggles` carry a labeled settings strip at the card's bottom
 * edge that opens a native Modal (wider than the primitive default) with
 * the related settings as title/desc + custom-switch rows and a Done
 * footer; the popup body scrolls internally when a feature declares many
 * rows (e.g. Terminal's six). The toggles themselves are custom
 * switches: a real checkbox (native semantics and focus) driving a styled
 * track/thumb.
 *
 * Writes ride the plugin's own fenced settings route (the host calls the
 * settings seam in-process — the DSH settings RPC domain does not serve
 * third-party namespaces to configuration clients); the shared SidebarStore
 * is refreshed on success so the very next brand-new session seeds from the
 * new values and the sidebar's consumption points (the + menu, derived
 * flows) re-render immediately. Any failure reverts the optimistic UI and
 * shows the wire error inline — a broken settings surface never crashes the
 * shell.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconChevronDownOutline14,
  IconPlusOutline16,
  IconSettingsOutline16,
  Input,
  Menu,
  Modal,
} from "./ui-primitives"
import clsx from 'clsx'
// Type-only: pulls the settings shell's SlotMap merges ('settings.section').
import type {} from './ui-primitives'
import type { PropsRuntime } from './ui-primitives'
import {
  clampWidthPercent,
  TITLE_BAR_STRIP_MAX,
  TITLE_BAR_STRIP_MIN,
  WIDTH_PERCENT_MAX,
  WIDTH_PERCENT_MIN,
  type SidebarPrefs,
  type TitleBarScheme,
} from './prefs-shared'
import { api } from './api'
import { parsePrefs } from './prefs'
import { AddPluginModal, type PluginKind } from './add-plugin-modal'
import { t } from './locales'
import { parseDesktopEnv } from './desktop-env'
import { getShellPreset, getShellPresets } from './shell-presets'
import type { SidebarStore } from './state'
import type {
  BetterSidebarService,
  FileViewerDescriptor,
  SidebarSettingsRenderProps,
  SidebarSettingToggle,
  TabDescriptor,
} from './service'
import css from './SideCardSection.module.css'

/** Injected business face: the shared store (prefs cache) + the sidebar service (registries). */
export interface SideCardSectionInjected {
  store: SidebarStore
  service: BetterSidebarService
}

/** Full section props: the runtime share plus the injected face. */
export type SideCardSectionProps = PropsRuntime<'settings.section'> & SideCardSectionInjected

/** Map one wire failure to the inline message (the conflict gets friendly copy). */
function messageOf(error: unknown): string {
  if (error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'settings-conflict') {
    return `${t('settingsSaveFailed')} ${t('settingsConflict')}`
  }
  return `${t('settingsSaveFailed')} ${error instanceof Error ? error.message : String(error)}`
}

/** Resolve an i18n-friendly string-or-function value. */
function textOf(value: string | (() => string) | undefined): string {
  if (value === undefined) return ''
  return typeof value === 'function' ? value() : value
}

/** Resolve a descriptor icon (ReactNode or size function). */
function iconOf(icon: ReactNode | ((size: number) => ReactNode) | undefined, size: number): ReactNode {
  if (icon === undefined) return null
  return typeof icon === 'function' ? icon(size) : icon
}

/** Tab inventory order: hidden types (editor/diff) last, then + menu order. */
function tabOrder(a: TabDescriptor, b: TabDescriptor): number {
  if (a.hidden !== b.hidden) return a.hidden === true ? 1 : -1
  return (a.order ?? 100) - (b.order ?? 100)
}

/**
 * The scheme dropdown's current value: the plain scheme, or `preset:<id>`
 * while a preset is active. Falls back to `auto` when the stored preset id
 * is no longer registered (the strip resolves to 0 then anyway).
 */
function titleBarSchemeValue(prefs: SidebarPrefs): string {
  if (prefs.titleBarScheme !== 'preset') return prefs.titleBarScheme
  const preset = getShellPreset(prefs.titleBarPresetId)
  return preset !== undefined ? `preset:${preset.id}` : 'auto'
}

/** Viewer inventory order: priority desc (the catch-all `code` comes last). */
function viewerOrder(a: FileViewerDescriptor, b: FileViewerDescriptor): number {
  return (b.priority ?? 0) - (a.priority ?? 0)
}

/** Whether a feature declares any secondary settings (gear button shows). */
function hasSettings(feature: TabDescriptor | FileViewerDescriptor): boolean {
  const settings = feature.settings
  return settings !== undefined && (
    (settings.toggles?.length ?? 0) > 0
    || (settings.pluginToggles?.length ?? 0) > 0
    || settings.render !== undefined
  )
}

/** A feature's display name (viewers fall back to their id). */
function featureNameOf(feature: TabDescriptor | FileViewerDescriptor): string {
  return textOf('title' in feature ? feature.title : undefined) || feature.id
}

/**
 * Merge one plugin-owned setting into a pluginSettings map (pure, v0.12.0+).
 * Sequential merges are additive: each call spreads the map it was GIVEN,
 * so building from the latest optimistic map keeps earlier keys intact
 * (two same-tick writes must not drop each other).
 */
export function mergePluginSetting(
  pluginSettings: Record<string, Record<string, unknown>>,
  descriptorId: string,
  key: string,
  value: unknown,
): Record<string, Record<string, unknown>> {
  return {
    ...pluginSettings,
    [descriptorId]: { ...(pluginSettings[descriptorId] ?? {}), [key]: value },
  }
}

/**
 * Render a custom settings panel (`settings.render`) with error containment:
 * a throwing panel shows an inline error line instead of breaking the whole
 * settings page.
 */
function SettingsRender(props: {
  render: (renderProps: SidebarSettingsRenderProps) => ReactNode
  renderProps: SidebarSettingsRenderProps
}) {
  let content: ReactNode
  try {
    content = props.render(props.renderProps)
  } catch (error) {
    content = (
      <div className={css.error} role="alert">
        {t('settingsSaveFailed')} {error instanceof Error ? error.message : String(error)}
      </div>
    )
  }
  return <>{content}</>
}

/**
 * The custom switch: a real checkbox (hidden, native semantics and focus)
 * driving a styled track/thumb. Used by the general toggle rows and the
 * secondary settings popup rows.
 */
function Switch(props: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  const { checked, onChange, label } = props
  return (
    <label className={css.switch}>
      <input
        type="checkbox"
        className={css.switchInput}
        checked={checked}
        aria-label={label}
        onChange={event => { onChange(event.currentTarget.checked) }}
      />
      <span className={css.switchTrack} aria-hidden="true">
        <span className={css.switchThumb} />
      </span>
    </label>
  )
}

/**
 * The body of a feature's secondary settings popup: one row (title/desc +
 * control) per declared setting. Switches render the custom switch; text and
 * number rows render a free-form / numeric input committed on blur/Enter
 * (clamped to the declared min/max). Extracted so the rows are testable
 * without opening the Modal (the Modal portal renders only while open).
 */
export function FeatureSettingsRows(props: {
  toggles: readonly SidebarSettingToggle[]
  prefs: SidebarPrefs
  onToggle: (toggle: SidebarSettingToggle, next: boolean) => void
  /** Commit one text/number row; returns the canonical value the row should
   *  display (clamped for numbers, the current pref when the input is
   *  invalid). Optional: rows with no handler keep their draft. */
  onCommit?: (toggle: SidebarSettingToggle, raw: string) => string
  /** Commit one select row: the picked option's value (single) or the array
   *  of picked values (`multi: true`). Optional: rows with no handler are
   *  display-only. */
  onSelectValue?: (toggle: SidebarSettingToggle, next: unknown) => void
  /** Explicit value source (v0.12.0+): when given, rows read their values
   *  from it instead of the `prefs` face — plugin-owned rows read their
   *  own blob, so a plugin key can never collide with (or silently read)
   *  a host pref of the same name. (Named `valueSource`, not `valueOf`:
   *  the latter collides with the inherited Object.prototype.valueOf.) */
  valueSource?: (key: string) => unknown
}) {
  const { toggles, prefs, onToggle, onCommit, onSelectValue, valueSource } = props
  const read = valueSource ?? ((key: string): unknown => (prefs as unknown as Record<string, unknown>)[key])
  return (
    <div className={css.popupRows}>
      {toggles.map(toggle => {
        const title = textOf(toggle.title)
        if (toggle.type === 'select') {
          return (
            <SelectRow
              key={toggle.key}
              toggle={toggle}
              title={title}
              value={read(toggle.key)}
              onSelectValue={onSelectValue}
            />
          )
        }
        if ((toggle.type ?? 'switch') === 'switch') {
          return (
            <div key={toggle.key} className={css.popupRow}>
              <span className={css.rowText}>
                <span className={css.title}>{title}</span>
                {textOf(toggle.desc) !== '' && <span className={css.desc}>{textOf(toggle.desc)}</span>}
              </span>
              <Switch
                label={title}
                checked={read(toggle.key) === true}
                onChange={(next) => { onToggle(toggle, next) }}
              />
            </div>
          )
        }
        const value = String(read(toggle.key) ?? '')
        // Keyed by the committed value: a failed commit reverts prefs, the
        // key changes, and the row remounts with the stored value (typing
        // never changes the key, so mid-edit drafts survive re-renders).
        return (
          <TypedRow
            key={`${toggle.key}:${value}`}
            toggle={toggle}
            title={title}
            value={value}
            onCommit={onCommit}
          />
        )
      })}
    </div>
  )
}

/**
 * One text/number row: a controlled input whose draft is local state,
 * committed on blur/Enter through the parent's onCommit. The parent's
 * canonical return is adopted (clamped numbers, stored value for invalid
 * input); a `unit` suffix renders after the input (e.g. 'px').
 */
function TypedRow(props: {
  toggle: SidebarSettingToggle
  title: string
  value: string
  onCommit?: (toggle: SidebarSettingToggle, raw: string) => string
}) {
  const { toggle, title, value, onCommit } = props
  const [draft, setDraft] = useState(value)
  const commit = (): void => {
    const canonical = onCommit?.(toggle, draft) ?? draft
    setDraft(canonical)
  }
  const number = toggle.type === 'number'
  return (
    <div className={css.popupRow}>
      <span className={css.rowText}>
        <span className={css.title}>{title}</span>
        {textOf(toggle.desc) !== '' && <span className={css.desc}>{textOf(toggle.desc)}</span>}
      </span>
      <span className={css.control}>
        <Input
          type={number ? 'number' : 'text'}
          className={number ? css.typedInputNumber : css.typedInput}
          value={draft}
          min={toggle.min}
          max={toggle.max}
          step={1}
          placeholder={toggle.placeholder}
          aria-label={title}
          onChange={(event: any) => { setDraft(event.currentTarget.value) }}
          onBlur={commit}
          onKeyDown={(event: any) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        {toggle.unit !== undefined && <span className={css.suffix}>{toggle.unit}</span>}
      </span>
    </div>
  )
}
/**
 * The multi-line custom-CSS input (scheme `custom`): a monospace textarea
 * whose draft is local state, committed on blur or Cmd/Ctrl+Enter through
 * the parent's handler. Keyed by the stored value so an external commit
 * remounts it with the canonical text (same pattern as TypedRow).
 */
function CssDraft(props: {
  value: string
  onCommit: (raw: string) => void
  label: string
  placeholder?: string
}) {
  const { value, onCommit, label, placeholder } = props
  const [draft, setDraft] = useState(value)
  return (
    <textarea
      className={css.cssTextArea}
      rows={6}
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      spellCheck={false}
      onChange={event => { setDraft(event.currentTarget.value) }}
      onBlur={() => { onCommit(draft) }}
      onKeyDown={event => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.currentTarget.blur()
      }}
    />
  )
}

/**
 * The reusable dropdown — the primitives Menu, NOT a native <select>: a
 * closed anchor button (picked option text + chevron) opening one Menu item
 * per option (big-icon cards when any option carries an icon). Single-pick
 * commits the option's value and closes; `multi` toggles membership and
 * commits the picked values as an array (in options order), staying open.
 * Shared by the declarative select rows (SelectRow) and the title-bar
 * scheme dropdown on the General row.
 */
function SelectMenu(props: {
  label: string
  value: unknown
  options: readonly {
    value: string | number | boolean
    title: string | (() => string)
    desc?: string | (() => string)
    icon?: ReactNode | ((size: number) => ReactNode)
  }[]
  multi?: boolean
  onSelect: (next: unknown) => void
  placeholder?: string
}) {
  const { label, value, options, multi, onSelect, placeholder } = props
  const [open, setOpen] = useState(false)
  const hasIcons = options.some(option => option.icon !== undefined)
  const picked: readonly unknown[] = multi ? (Array.isArray(value) ? value : []) : [value]
  const selected = options.filter(option => picked.includes(option.value))

  /** Commit one picked option (toggle semantics under multi). */
  const pick = (index: number): void => {
    const option = options[index]
    if (option === undefined) return
    if (!multi) {
      onSelect(option.value)
      setOpen(false)
      return
    }
    const current = Array.isArray(value) ? [...value] : []
    const at = current.indexOf(option.value)
    if (at >= 0) current.splice(at, 1)
    else current.push(option.value)
    // Stable wire order: follow the declared options order, not pick order.
    onSelect(options.filter(o => current.includes(o.value)).map(o => o.value))
  }

  const anchor = (
    <button
      type="button"
      className={css.selectAnchor}
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => { setOpen(now => !now) }}
    >
      {!multi && hasIcons && selected[0] !== undefined && (
        <span className={css.selectAnchorIcon}>{iconOf(selected[0].icon, 16)}</span>
      )}
      <span className={css.selectAnchorText}>
        {selected.length === 0 ? (placeholder ?? '—') : selected.map(option => textOf(option.title)).join(', ')}
      </span>
      <IconChevronDownOutline14 size={12} />
    </button>
  )

  return (
    <Menu
      open={open}
      anchor={anchor}
      items={options.map((option, index) => ({
        id: String(index),
        label: hasIcons
          ? (
            <span className={css.selectOption}>
              <span className={css.selectOptionIcon}>{iconOf(option.icon, 24)}</span>
              <span className={css.selectOptionText}>
                <span className={css.title}>{textOf(option.title)}</span>
                {textOf(option.desc) !== '' && <span className={css.desc}>{textOf(option.desc)}</span>}
              </span>
            </span>
          )
          : textOf(option.title),
      }))}
      selectedId={!multi && selected[0] !== undefined ? String(options.indexOf(selected[0])) : undefined}
      selectedIds={multi ? selected.map(option => String(options.indexOf(option))) : undefined}
      onSelect={(id) => { pick(Number(id)) }}
      onClose={() => { setOpen(false) }}
      portal
    />
  )
}

/**
 * One select row: a dropdown over the toggle's declared `options` (the
 * shared SelectMenu). When any option carries an icon, the dropdown renders
 * big-icon option cards (icon + title + desc) and the closed anchor shows
 * the selected option's icon as well; without icons both are a single line
 * of text. Single-pick commits the option's value and closes; `multi`
 * toggles membership, commits the picked values as an array (in options
 * order), and stays open.
 */
function SelectRow(props: {
  toggle: SidebarSettingToggle
  title: string
  value: unknown
  onSelectValue?: (toggle: SidebarSettingToggle, next: unknown) => void
}) {
  const { toggle, title, value, onSelectValue } = props
  return (
    <div className={css.popupRow}>
      <span className={css.rowText}>
        <span className={css.title}>{title}</span>
        {textOf(toggle.desc) !== '' && <span className={css.desc}>{textOf(toggle.desc)}</span>}
      </span>
      <span className={css.control}>
        <SelectMenu
          label={title}
          value={value}
          options={toggle.options ?? []}
          multi={toggle.multi === true}
          onSelect={(next) => { onSelectValue?.(toggle, next) }}
        />
      </span>
    </div>
  )
}

/**
 * The secondary settings popup body of one feature (tab or viewer):
 * - the host-prefs `toggles` rows, then the plugin-owned `pluginToggles`
 *   rows (their values live in `pluginSettings[feature.id]`, projected onto
 *   the prefs face so the shared row renderer reads them);
 * - `settings.render` (custom panel) AFTER those rows when declared — the
 *   custom panel is an extension of the row list, not a replacement, so a
 *   feature can keep its declarative rows (e.g. the editor's
 *   open-behavior picker) and still ship a custom configuration area.
 */
export function SettingsBody(props: {
  feature: TabDescriptor | FileViewerDescriptor
  prefs: SidebarPrefs
  store: SidebarStore
  service: BetterSidebarService
  onToggle: (toggle: SidebarSettingToggle, next: boolean) => void
  onCommit: (toggle: SidebarSettingToggle, raw: string) => string
  onSelectValue: (toggle: SidebarSettingToggle, next: unknown) => void
  onPluginToggle: (toggle: SidebarSettingToggle, next: boolean) => void
  onPluginCommit: (toggle: SidebarSettingToggle, raw: string) => string
  onPluginSelectValue: (toggle: SidebarSettingToggle, next: unknown) => void
  onPluginWrite: (key: string, value: unknown) => void
  onClose: () => void
}) {
  const { feature, prefs, store, service, onToggle, onCommit, onSelectValue, onPluginToggle, onPluginCommit, onPluginSelectValue, onPluginWrite, onClose } = props
  const render = feature.settings?.render
  const toggles = feature.settings?.toggles ?? []
  const pluginToggles = feature.settings?.pluginToggles ?? []
  if (render === undefined && toggles.length === 0 && pluginToggles.length === 0) return null
  // Plugin rows read their values from the descriptor's OWN blob through
  // an explicit value source — no projection onto the prefs face, so a
  // plugin key can never collide with (or silently read) a host pref of
  // the same name.
  const pluginBlob = prefs.pluginSettings[feature.id] ?? {}
  return (
    <div>
      {(toggles.length > 0 || pluginToggles.length > 0) && (
        <div className={css.popupRows}>
          {toggles.length > 0 && (
            <FeatureSettingsRows
              toggles={toggles}
              prefs={prefs}
              onToggle={onToggle}
              onCommit={onCommit}
              onSelectValue={onSelectValue}
            />
          )}
          {pluginToggles.length > 0 && (
            <FeatureSettingsRows
              toggles={pluginToggles}
              prefs={prefs}
              onToggle={onPluginToggle}
              onCommit={onPluginCommit}
              onSelectValue={onPluginSelectValue}
              valueSource={(key) => pluginBlob[key]}
            />
          )}
        </div>
      )}
      {render !== undefined && (
        <SettingsRender
          render={render}
          renderProps={{
            store,
            service,
            prefs,
            pluginSettings: prefs.pluginSettings[feature.id] ?? {},
            updatePluginSetting: onPluginWrite,
            close: onClose,
          }}
        />
      )}
    </div>
  )
}

/**
 * Render the Side card preferences section.
 * @param props - composed slot props (runtime share + injected store/service).
 * @returns the section element tree.
 */
export function SideCardSection({ store, service }: SideCardSectionProps) {
  const [prefs, setPrefs] = useState<SidebarPrefs>(() => store.getPrefs())
  const [widthDraft, setWidthDraft] = useState<string>(String(store.getPrefs().defaultWidthPercent))
  const [error, setError] = useState<string | null>(null)
  // Which feature's secondary settings popup is open (null = closed).
  const [settingsFor, setSettingsFor] = useState<TabDescriptor | FileViewerDescriptor | null>(null)
  // Whether the position-compat strip popup (the gear on the 常规 row) is open.
  const [stripSettingsOpen, setStripSettingsOpen] = useState(false)
  // The parsed desktop environment (URL stamps — see desktop-env.ts). Used
  // ONLY to badge matching presets in the scheme dropdown ("已检测");
  // nothing is auto-applied.
  const detectedEnv = useMemo(() => parseDesktopEnv(), [])
  // Whether the "add plugin" modal (a dashed card at the end of the
  // 侧边栏内容 / 文件预览 grids) is open, and for which extension point
  // (null = closed).
  const [addPluginsOpen, setAddPluginsOpen] = useState<PluginKind | null>(null)
  // The LATEST optimistic prefs, kept in sync with the state. Nested-map
  // merges (tabsEnabled / viewersEnabled / pluginSettings) MUST build from
  // this ref, not from the render-time `prefs`: two same-tick writes (e.g.
  // a settings panel updating several plugin keys at once) would otherwise
  // both spread the stale map and the later patch would drop the earlier
  // key even though the commits are serialized.
  const optimisticRef = useRef(prefs)
  useEffect(() => { optimisticRef.current = prefs }, [prefs])

  // The declarative inventory: the registered tab types and file viewers.
  // Local state + service.subscribe (registry changes are rare — plugin
  // load/unload — so a plain effect is enough; no external-store ceremony).
  const [tabs, setTabs] = useState<TabDescriptor[]>(() => [...service.getTabs()].sort(tabOrder))
  const [viewers, setViewers] = useState<FileViewerDescriptor[]>(() => [...service.getFileViewers()].sort(viewerOrder))
  useEffect(() => service.subscribe(() => {
    setTabs([...service.getTabs()].sort(tabOrder))
    setViewers([...service.getFileViewers()].sort(viewerOrder))
  }), [service])

  // The settings document revision (guards concurrent writes). A ref: commits
  // read the freshest value at execution time, no re-render needed.
  const revisionRef = useRef<number | undefined>(undefined)
  // Whether the user already wrote since mount: the mount read must not
  // clobber a newer optimistic edit (the window is milliseconds, but a slow
  // route must never silently revert a just-made change).
  const dirtyRef = useRef(false)
  // Serialize commits: a queued write must observe the previous write's
  // revision; a failed write must not poison the queue for later ones.
  const inFlightRef = useRef<Promise<unknown>>(Promise.resolve())

  // Sync the persisted document once on mount: the revision and the current
  // values (another tab may have changed them since the store hydrated).
  useEffect(() => {
    let cancelled = false
    void api.settingsGet().then((view) => {
      if (cancelled) return
      revisionRef.current = view.revision
      if (dirtyRef.current) return
      const next = parsePrefs(view.value)
      setPrefs(next)
      setWidthDraft(String(next.defaultWidthPercent))
    }).catch(() => { /* the store's defaults stay authoritative */ })
    return () => { cancelled = true }
  }, [])

  /** Persist one patch through the settings route (serialized, revision-guarded). */
  const commit = (patch: Record<string, unknown>): Promise<{ ok: boolean; prefs: SidebarPrefs }> => {
    dirtyRef.current = true
    const run = inFlightRef.current.then(async () => {
      const view = await api.settingsUpdate(
        { ...patch },
        revisionRef.current,
      )
      const next = parsePrefs(view.value)
      revisionRef.current = view.revision
      store.setPrefs(next)
      return next
    })
    // A failed commit must not poison the queue: later writes still run.
    inFlightRef.current = run.then(() => undefined, () => undefined)
    return run.then(
      (next) => ({ ok: true, prefs: next }),
      (caught) => {
        setError(messageOf(caught))
        return { ok: false, prefs }
      },
    )
  }

  /** Settle one commit: success adopts the server values, failure reverts. */
  const applyOutcome = (previous: SidebarPrefs, outcome: { ok: boolean; prefs: SidebarPrefs }): void => {
    const settled = outcome.ok ? outcome.prefs : previous
    setPrefs(settled)
    setWidthDraft(String(settled.defaultWidthPercent))
  }

  /** Optimistically apply one pref patch, then commit (revert on failure). */
  const applyPref = (patch: Record<string, unknown>): void => {
    const previous = optimisticRef.current
    const next = { ...previous, ...patch } as SidebarPrefs
    optimisticRef.current = next
    setPrefs(next)
    setError(null)
    void commit(patch).then(outcome => applyOutcome(previous, outcome))
  }

  const onToggle = (next: boolean): void => {
    applyPref({ openByDefault: next })
  }

  /** Flip one per-tab enable switch (merge into the tabsEnabled map). */
  const onToggleTab = (id: string, next: boolean): void => {
    applyPref({ tabsEnabled: { ...optimisticRef.current.tabsEnabled, [id]: next } })
  }

  /** Flip one per-viewer enable switch (merge into the viewersEnabled map). */
  const onToggleViewer = (id: string, next: boolean): void => {
    applyPref({ viewersEnabled: { ...optimisticRef.current.viewersEnabled, [id]: next } })
  }

  /** Flip one declaratively-declared toggle (a SidebarPrefs boolean field). */
  const onToggleSetting = (toggle: SidebarSettingToggle, next: boolean): void => {
    applyPref({ [toggle.key]: next })
  }

  /** Commit one declaratively-declared select row (the option's value, or an
   *  array of values under `multi`). */
  const onSelectSetting = (toggle: SidebarSettingToggle, next: unknown): void => {
    applyPref({ [toggle.key]: next })
  }

  /**
   * Commit one declaratively-declared text/number row. Numbers are parsed
   * and clamped to the toggle's declared min/max (an unparsable input falls
   * back to the CURRENT stored value, mirroring the width row); text rows
   * persist as-is (empty is meaningful, e.g. the theme-default font).
   * Returns the canonical value the row should display.
   */
  const onCommitSetting = (toggle: SidebarSettingToggle, raw: string): string => {
    if (toggle.type === 'number') {
      const parsed = Number(raw)
      const fallback = String((prefs as unknown as Record<string, unknown>)[toggle.key] ?? '')
      if (!Number.isFinite(parsed)) return fallback
      let clamped = Math.round(parsed)
      if (toggle.min !== undefined) clamped = Math.max(toggle.min, clamped)
      if (toggle.max !== undefined) clamped = Math.min(toggle.max, clamped)
      applyPref({ [toggle.key]: clamped })
      return String(clamped)
    }
    applyPref({ [toggle.key]: raw })
    return raw
  }

  /**
   * Pick the title-bar / shell compatibility scheme. Mirrors the legacy
   * `titleBarCompat` flag (true = anything but the conservative auto) so
   * documents stay readable by older plugin versions.
   */
  /**
   * Pick the title-bar / shell compatibility scheme from the dropdown. The
   * option values are `auto` | `web` | `custom` | `preset:<id>`; selecting
   * a preset stores both the scheme and its id. Mirrors the legacy
   * `titleBarCompat` flag (true for preset/custom) so documents stay
   * readable by older plugin versions.
   */
  const onSchemeSelect = (value: unknown): void => {
    if (typeof value !== 'string') return
    if (value === 'auto' || value === 'web' || value === 'custom') {
      applyPref({ titleBarScheme: value, titleBarCompat: value === 'custom' })
      return
    }
    if (value.startsWith('preset:') && getShellPreset(value.slice('preset:'.length)) !== undefined) {
      applyPref({
        titleBarScheme: 'preset',
        titleBarPresetId: value.slice('preset:'.length),
        titleBarCompat: true,
      })
    }
  }

  /** Commit the free-form custom CSS (scheme `custom`). */
  const commitCustomCss = (raw: string): void => {
    applyPref({ customCss: raw })
  }

  /** Persist one plugin-owned setting of one descriptor (merged into the pluginSettings blob). */
  const applyPluginSetting = (descriptorId: string, key: string, value: unknown): void => {
    applyPref({ pluginSettings: mergePluginSetting(optimisticRef.current.pluginSettings, descriptorId, key, value) })
  }

  /** Flip one plugin-owned switch row (same row shape, plugin-scoped key). */
  const onPluginToggle = (descriptorId: string, toggle: SidebarSettingToggle, next: boolean): void => {
    applyPluginSetting(descriptorId, toggle.key, next)
  }

  /** Commit one plugin-owned text/number row (clamped like the host rows). */
  const onPluginCommitSetting = (descriptorId: string, toggle: SidebarSettingToggle, raw: string): string => {
    if (toggle.type === 'number') {
      const parsed = Number(raw)
      const blob = prefs.pluginSettings[descriptorId] ?? {}
      const fallback = String(blob[toggle.key] ?? '')
      if (!Number.isFinite(parsed)) return fallback
      let clamped = Math.round(parsed)
      if (toggle.min !== undefined) clamped = Math.max(toggle.min, clamped)
      if (toggle.max !== undefined) clamped = Math.min(toggle.max, clamped)
      applyPluginSetting(descriptorId, toggle.key, clamped)
      return String(clamped)
    }
    applyPluginSetting(descriptorId, toggle.key, raw)
    return raw
  }

  const commitWidth = (): void => {
    const parsed = Number(widthDraft)
    if (!Number.isFinite(parsed)) {
      setWidthDraft(String(prefs.defaultWidthPercent))
      return
    }
    const clamped = clampWidthPercent(parsed)
    const previous = prefs
    setPrefs({ ...previous, defaultWidthPercent: clamped })
    setWidthDraft(String(clamped))
    setError(null)
    void commit({ defaultWidthPercent: clamped }).then(outcome => applyOutcome(previous, outcome))
  }

  /**
   * One SMALL toggle card for the responsive inventory grid: the card's main
   * area is the switch (click to flips, visual state IS the state), the icon
   * sits in a rounded chip, the check badge pins to the far right, and a
   * feature that declares related settings gets a labeled SETTINGS STRIP
   * across the card's bottom edge (gear icon + text) opening its settings
   * popup — discoverable at rest, not a hover-only ghost corner button.
   */
  const renderCard = (props: {
    title: string
    desc: string
    icon?: ReactNode
    enabled: boolean
    onToggle: (next: boolean) => void
    /** A feature with declared related settings shows the settings strip. */
    onOpenSettings?: () => void
  }) => {
    const hasSettings = props.onOpenSettings !== undefined
    return (
      <div
        className={clsx(css.card, props.enabled && css.cardOn)}
      >
        <button
          type="button"
          className={css.cardMain}
          aria-pressed={props.enabled}
          title={props.desc}
          onClick={() => { props.onToggle(!props.enabled) }}
        >
          <span className={css.cardTop}>
            {props.icon !== null && props.icon !== undefined && (
              <span className={css.cardIconChip}>{props.icon}</span>
            )}
            <span className={css.cardTitle}>{props.title}</span>
            {props.enabled && (
              <span className={css.cardSwitch} aria-hidden="true">
                <span className={css.cardSwitchTrack}>
                  <span className={css.cardSwitchThumb} />
                </span>
              </span>
            )}
          </span>
          <span className={css.cardDesc}>{props.desc}</span>
        </button>
        {hasSettings && (
          <button
            type="button"
            className={css.cardSettings}
            aria-label={`${props.title} ${t('settingsPopup')}`}
            onClick={props.onOpenSettings}
          >
            <IconSettingsOutline16 size={12} />
            <span>{t('settingsPopup')}</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={css.section}>
      <p className={css.intro}>{t('settingsIntro')}</p>

      {/* The managing plugin's own identity: name + version badge, so the
          section is attributable at a glance (the version is the service
          instance's, kept in lockstep with package.json by
          tests/service.spec.ts). */}
      <div className={css.versionBadge}>
        <span className={css.versionBadgeName}>DSH-better-sidebar</span>
        <span className={css.versionBadgeTag}>v{service.version}</span>
      </div>

      {/* 常规: the DSH settings-row recipe — title/desc left, control right. */}
      <div className={css.group}>
        <div className={css.groupHeading}>{t('settingsGeneralTitle')}</div>
        <div className={css.row}>
          <span className={css.rowText}>
            <span className={css.title}>{t('settingsOpenTitle')}</span>
            <span className={css.desc}>{t('settingsOpenDesc')}</span>
          </span>
          <Switch
            label={t('settingsOpenTitle')}
            checked={prefs.openByDefault}
            onChange={onToggle}
          />
        </div>
        <div className={css.row}>
          <span className={css.rowText}>
            <span className={css.title}>{t('settingsWidthTitle')}</span>
            <span className={css.desc}>{t('settingsWidthDesc')}</span>
          </span>
          <span className={css.control}>
            <Input
              type="number"
              className={css.percentInput}
              value={widthDraft}
              min={WIDTH_PERCENT_MIN}
              max={WIDTH_PERCENT_MAX}
              step={1}
              aria-label={t('settingsWidthTitle')}
              onChange={(event: any) => { setWidthDraft(event.currentTarget.value) }}
              onBlur={commitWidth}
              onKeyDown={(event: any) => { if (event.key === "Enter") event.currentTarget.blur() }}
            />
            <span className={css.suffix}>{t('settingsWidthSuffix')}</span>
          </span>
        </div>
        <div className={css.row}>
          <span className={css.rowText}>
            <span className={css.title}>{t('settingsOpenPathTitle')}</span>
            <span className={css.desc}>{t('settingsOpenPathDesc')}</span>
          </span>
          <Switch
            label={t('settingsOpenPathTitle')}
            checked={prefs.interceptOpenPath}
            onChange={(next) => { applyPref({ interceptOpenPath: next }) }}
          />
        </div>
        <div className={css.row}>
          <span className={css.rowText}>
            <span className={css.title}>{t('settingsOpenToolsTitle')}</span>
            <span className={css.desc}>{t('settingsOpenToolsDesc')}</span>
          </span>
          <Switch
            label={t('settingsOpenToolsTitle')}
            checked={prefs.agentOpenTools}
            onChange={(next) => { applyPref({ agentOpenTools: next }) }}
          />
        </div>
        <div className={css.row}>
          <span className={css.rowText}>
            <span className={css.title}>{t('settingsTitleBarTitle')}</span>
            <span className={css.desc}>{t('settingsTitleBarDesc')}</span>
          </span>
          <span className={css.control}>
            {/*
              The scheme dropdown (the shared SelectMenu — NOT a native
              select): 自动检测 (default) / DSH官方Web / 各壳兼容方案 /
              自定义方案. Matching presets carry a 「已检测」 desc badge
              (suggestion only). The 自定义方案 row keeps its gear (the
              popup with the shift distance + custom CSS) — the other
              schemes need no further settings.
            */}
            <SelectMenu
              label={t('settingsTitleBarTitle')}
              value={titleBarSchemeValue(prefs)}
              options={[
                { value: 'auto', title: t('settingsSchemeAutoTitle'), desc: t('settingsSchemeAutoDesc') },
                { value: 'web', title: t('settingsSchemeWebTitle'), desc: t('settingsSchemeWebDesc') },
                ...getShellPresets().map(preset => ({
                  value: `preset:${preset.id}`,
                  title: preset.title,
                  desc: preset.detect?.(detectedEnv) === true
                    ? `${preset.desc}（${t('settingsSchemeDetectedSuffix')}）`
                    : preset.desc,
                })),
                { value: 'custom', title: t('settingsSchemeCustomTitle'), desc: t('settingsSchemeCustomDesc') },
              ]}
              onSelect={onSchemeSelect}
            />
            {prefs.titleBarScheme === 'custom' && (
              <button
                type="button"
                className={css.rowGear}
                aria-label={`${t('settingsTitleBarTitle')} ${t('settingsPopup')}`}
                title={t('settingsPopup')}
                onClick={() => { setStripSettingsOpen(true) }}
              >
                <IconSettingsOutline16 size={14} />
              </button>
            )}
          </span>
        </div>
      </div>

      {/* 侧边栏内容: one small card per registered tab type in a responsive
          grid; features declaring `settings.toggles` open their settings in
          the popup (gear corner button) instead of nested inline rows. */}
      <div className={css.group}>
        <div className={css.groupHeading}>
          <span>{t('settingsTabsTitle')}</span>
          <span className={css.count}>{tabs.length}</span>
        </div>
        <div className={css.grid}>
          {tabs.map(tab => (
            <Fragment key={tab.id}>
              {renderCard({
                title: textOf(tab.title),
                desc: tab.id,
                icon: iconOf(tab.icon, 16),
                enabled: prefs.tabsEnabled[tab.id] !== false,
                onToggle: (next) => { onToggleTab(tab.id, next) },
                // The settings gear only while the feature is enabled: its
                // related settings are dormant while the feature is off.
                onOpenSettings: prefs.tabsEnabled[tab.id] !== false && hasSettings(tab)
                  ? () => { setSettingsFor(tab) }
                  : undefined,
              })}
            </Fragment>
          ))}
          {/* The "add tab plugin" entry: same card size as the inventory,
              but a dashed border — it opens the TAB-registration plugin
              modal instead of toggling a feature. */}
          <button
            type="button"
            className={clsx(css.card, css.addCard)}
            onClick={() => { setAddPluginsOpen('tab') }}
          >
            <span className={css.cardTop}>
              <span className={css.cardIconChip}>
                <IconPlusOutline16 size={16} />
              </span>
              <span className={css.cardTitle}>{t('addPluginsTabCard')}</span>
            </span>
            <span className={css.cardDesc}>{t('addPluginsTabCardDesc')}</span>
          </button>
        </div>
      </div>

      {/* 文件预览: one small card per registered file viewer. */}
      <div className={css.group}>
        <div className={css.groupHeading}>
          <span>{t('settingsViewersTitle')}</span>
          <span className={css.count}>{viewers.length}</span>
        </div>
        <div className={css.grid}>
          {viewers.map(viewer => (
            <Fragment key={viewer.id}>
              {renderCard({
                title: textOf(viewer.title) || viewer.id,
                desc: viewer.exts.length === 0 ? t('settingsViewerCatchAll') : viewer.exts.join(' · '),
                icon: iconOf(viewer.icon, 16),
                enabled: prefs.viewersEnabled[viewer.id] !== false,
                onToggle: (next) => { onToggleViewer(viewer.id, next) },
                onOpenSettings: prefs.viewersEnabled[viewer.id] !== false && hasSettings(viewer)
                  ? () => { setSettingsFor(viewer) }
                  : undefined,
              })}
            </Fragment>
          ))}
          {/* The "add preview plugin" entry: dashed card opening the
              FILE-PREVIEWER registration modal. */}
          <button
            type="button"
            className={clsx(css.card, css.addCard)}
            onClick={() => { setAddPluginsOpen('viewer') }}
          >
            <span className={css.cardTop}>
              <span className={css.cardIconChip}>
                <IconPlusOutline16 size={16} />
              </span>
              <span className={css.cardTitle}>{t('addPluginsViewerCard')}</span>
            </span>
            <span className={css.cardDesc}>{t('addPluginsViewerCardDesc')}</span>
          </button>
        </div>
      </div>

      {/* The secondary settings popup: a feature's declared related settings
          as title/desc + switch rows in a wider-than-default Modal with a
          Done footer (Modal chrome is the app's own). Mounted only while a
          feature is open — the Modal primitive runs hooks unconditionally,
          so a closed-but-mounted Modal would break SSR (and the
          renderToString spec) under the test dual-react split.
          Content: the host-prefs `toggles` rows, the plugin-owned
          `pluginToggles` rows (their values live in pluginSettings[id]),
          then the custom `settings.render` panel when declared. */}
      {settingsFor !== null && (
        <Modal
          open
          onClose={() => { setSettingsFor(null) }}
          title={featureNameOf(settingsFor)}
          description={t('settingsPopupDesc', { feature: featureNameOf(settingsFor) })}
          closeLabel={t('close')}
          className={css.popupDialog}
          footer={(
            <button type="button" className={css.done} onClick={() => { setSettingsFor(null) }}>
              {t('settingsDone')}
            </button>
          )}
        >
          <SettingsBody
            feature={settingsFor}
            prefs={prefs}
            onToggle={onToggleSetting}
            onCommit={onCommitSetting}
            onSelectValue={onSelectSetting}
            onPluginToggle={(toggle, next) => { onPluginToggle(settingsFor.id, toggle, next) }}
            onPluginCommit={(toggle, raw) => onPluginCommitSetting(settingsFor.id, toggle, raw)}
            onPluginSelectValue={(toggle, next) => { applyPluginSetting(settingsFor.id, toggle.key, next) }}
            onPluginWrite={(key, value) => { applyPluginSetting(settingsFor.id, key, value) }}
            onClose={() => { setSettingsFor(null) }}
            store={store}
            service={service}
          />
        </Modal>
      )}

      {/* The custom-scheme popup (opened by the gear next to the scheme
          dropdown when 自定义方案 is active): the shift distance in px and
          the free-form custom CSS. The OTHER schemes (自动检测 / DSH官方Web /
          壳预设) need no further settings — the scheme itself is chosen on
          the 常规 row. Mounted only while open (the Modal SSR rule above). */}
      {stripSettingsOpen && (
        <Modal
          open
          onClose={() => { setStripSettingsOpen(false) }}
          title={t('settingsTitleBarTitle')}
          description={t('settingsPopupDesc', { feature: t('settingsTitleBarTitle') })}
          closeLabel={t('close')}
          className={css.popupDialog}
          footer={(
            <button type="button" className={css.done} onClick={() => { setStripSettingsOpen(false) }}>
              {t('settingsDone')}
            </button>
          )}
        >
          <div className={css.popupRows}>
            <FeatureSettingsRows
              toggles={[{
                key: 'titleBarStripPx',
                type: 'number',
                title: () => t('settingsTitleBarStripTitle'),
                desc: () => t('settingsTitleBarStripDesc'),
                min: TITLE_BAR_STRIP_MIN,
                max: TITLE_BAR_STRIP_MAX,
                unit: 'px',
              }]}
              prefs={prefs}
              onToggle={onToggleSetting}
              onCommit={onCommitSetting}
            />
            <CssDraft
              key={prefs.customCss}
              value={prefs.customCss}
              label={t('settingsCustomCssTitle')}
              placeholder={t('settingsCustomCssPlaceholder')}
              onCommit={commitCustomCss}
            />
          </div>
        </Modal>
      )}

      {/* The "add plugin" modal (opened by the dashed cards above): declares
          the extension point of the clicked kind, opens the GitHub topic,
          and lists the matching recommended plugin catalog with per-entry
          install buttons (the install flow opens a ~/.dsh terminal with
          the command pre-typed; failures render inline here, in settings
          only). Mounted only while open (Modal runs hooks unconditionally
          — same SSR rule as the settings popup above). */}
      {addPluginsOpen !== null && (
        <AddPluginModal
          service={service}
          onClose={() => { setAddPluginsOpen(null) }}
          kind={addPluginsOpen}
        />
      )}

      {error !== null && (
        <div className={css.error} role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
