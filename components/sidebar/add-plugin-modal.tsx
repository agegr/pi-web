/**
 * The "add plugin" modals (Side card settings → the dashed cards at the
 * end of the 侧边栏内容 / 文件预览 grids): declare that the sidebar's
 * extension points — tab pages and file previewers — are open to plugins
 * (registered through `ctx.betterSidebar`), point at the GitHub topic page
 * for discovery, and show the repo's recommended plugin catalog of the
 * matching kind (name / url / description / install script).
 *
 * Per entry there are two actions:
 * - 「跳转」opens the plugin's repo in a REAL new browser tab (window.open
 *   — a button, so the sidebar link takeover cannot reroute it);
 * - 「安装」only COPIES the install script to the clipboard (writeClipboard)
 *   with a transient "已复制" feedback on the button — the user pastes and
 *   runs it wherever they manage their DSH profile. No terminal is opened,
 *   nothing is closed, nothing can fail outward.
 *
 * The body is extracted as {@link PluginListBody} so tests render it
 * directly — the Modal primitive runs hooks unconditionally, so an open
 * Modal must never be renderToString'd (same rule as the settingsFor popup
 * in SideCardSection); the modal itself mounts only while open.
 */
import { useState, type ReactNode } from 'react'
import { Modal, writeClipboard } from "./ui-primitives"
import type { BetterSidebarService } from './service'
import { PLUGIN_TOPIC_URL, type PluginEntry } from './plugins-shared'
import { builtinTabPlugins } from './plugins-tabs'
import { builtinViewerPlugins } from './plugins-viewers'
import { t } from './locales'
import css from './SideCardSection.module.css'

/** Which extension point the modal is adding a plugin for. */
export type PluginKind = 'tab' | 'viewer'

/** The catalog of one kind (kept in two repo files: plugins-tabs.ts /
 *  plugins-viewers.ts). */
function catalogOf(kind: PluginKind): readonly PluginEntry[] {
  return kind === 'tab' ? builtinTabPlugins : builtinViewerPlugins
}

/** How long the "已复制" feedback stays on the copy button. */
const COPIED_FEEDBACK_MS = 1500

/** The modal body: the GitHub topic button + the recommended plugin list
 *  with per-entry jump/copy buttons (extracted for direct testing). */
export function PluginListBody(props: { service: BetterSidebarService; kind: PluginKind }) {
  const { service, kind } = props
  // Which entry's copy button currently shows the "已复制" feedback.
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // Live catalog filter (name / id / description). A free-text search keeps
  // the list usable once the catalogs grow beyond a handful of entries:
  // every keystroke narrows the rendered rows, so a long catalog never
  // becomes a wall of scrolling.
  const [query, setQuery] = useState('')

  const catalog = catalogOf(kind)
  const needle = query.trim().toLowerCase()
  const matches = (entry: PluginEntry): boolean => {
    if (needle === '') return true
    const description = typeof entry.description === 'function' ? entry.description() : entry.description
    return entry.name.toLowerCase().includes(needle)
      || entry.id.toLowerCase().includes(needle)
      || description.toLowerCase().includes(needle)
  }
  const filtered = catalog.filter(matches)
  // Group by the optional category (stable order: category order of first
  // appearance, uncategorized entries last under the plain list).
  const groups = new Map<string | undefined, PluginEntry[]>()
  for (const entry of filtered) {
    const key = entry.category === undefined ? undefined : (typeof entry.category === 'function' ? entry.category() : entry.category)
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [entry])
    else list.push(entry)
  }

  /** Copy the entry's install script to the clipboard and flash the button's
   *  "已复制" label for a moment. The feedback ONLY appears after a
   *  successful write — when the clipboard is unavailable or denied
   *  (writeClipboard resolves false) nothing is shown, so the user is never
   *  told to paste a command that was not placed on the clipboard. Never
   *  closes anything, never throws outward. */
  const copy = async (entry: PluginEntry): Promise<void> => {
    const written = await writeClipboard(entry.install)
    if (!written) return
    setCopiedId(entry.id)
    window.setTimeout(() => {
      setCopiedId(current => (current === entry.id ? null : current))
    }, COPIED_FEEDBACK_MS)
  }

  /** Open the plugin's repo in a REAL new browser tab (window.open — a
   *  button, so the sidebar link takeover cannot reroute it). */
  const jump = (entry: PluginEntry): void => {
    window.open(entry.url, '_blank', 'noopener')
  }

  /** One catalog row (extracted so the group render stays flat). */
  const renderEntry = (entry: PluginEntry): ReactNode => (
    <div key={entry.id} className={css.pluginEntry}>
      <div className={css.pluginEntryHead}>
        {/* The name is a BUTTON on the same window.open path as the
            jump button: as an anchor it would be caught by the
            document-capture link takeover (which ignores
            target=_blank) and land in the sidebar browser. */}
        <button
          type="button"
          className={css.pluginName}
          aria-label={`${t('openPlugin')}: ${entry.name}`}
          onClick={() => { jump(entry) }}
        >
          {entry.name}
        </button>
        <span className={css.pluginEntryActions}>
          <button
            type="button"
            className={css.pluginJumpBtn}
            aria-label={`${t('openPlugin')}: ${entry.name}`}
            onClick={() => { jump(entry) }}
          >
            {t('openPlugin')}
          </button>
          <button
            type="button"
            className={css.pluginCopyBtn}
            aria-label={`${t('copyInstall')}: ${entry.name}`}
            onClick={() => { copy(entry) }}
          >
            {copiedId === entry.id ? t('copied') : t('copy')}
          </button>
        </span>
      </div>
      <div className={css.pluginDesc}>
        {typeof entry.description === 'function' ? entry.description() : entry.description}
      </div>
      <code className={css.pluginInstall}>{entry.install}</code>
    </div>
  )

  return (
    <div className={css.pluginList}>
      <button
        type="button"
        className={css.pluginTopicBtn}
        onClick={() => { window.open(PLUGIN_TOPIC_URL, '_blank', 'noopener') }}
      >
        {t('addPluginsBrowseMore')}
      </button>
      <input
        type="search"
        className={css.pluginSearch}
        placeholder={t('addPluginsSearch')}
        aria-label={t('addPluginsSearch')}
        value={query}
        onChange={event => { setQuery(event.currentTarget.value) }}
      />
      <div className={css.groupHeading}>
        <span>{t('addPluginsRecommended')}</span>
        <span className={css.count}>{filtered.length}</span>
      </div>
      {catalog.length === 0 ? (
        <div className={css.pluginEmpty}>{t('addPluginsEmpty')}</div>
      ) : filtered.length === 0 ? (
        <div className={css.pluginEmpty}>{t('addPluginsNoMatch')}</div>
      ) : (
        <div className={css.pluginEntries}>
          {[...groups.entries()].map(([category, entries]) => (
            <div key={category ?? '\u0000'} className={css.pluginGroup}>
              {category !== undefined && (
                <div className={css.pluginGroupHeading}>{category}</div>
              )}
              {entries.map(renderEntry)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** The modal itself (mounted only while open — see the module comment). */
export function AddPluginModal(props: { service: BetterSidebarService; onClose: () => void; kind: PluginKind }) {
  const { service, onClose, kind } = props
  return (
    <Modal
      open
      onClose={onClose}
      title={kind === 'tab' ? t('addPluginsTabCard') : t('addPluginsViewerCard')}
      description={kind === 'tab' ? t('addPluginsTabDesc') : t('addPluginsViewerDesc')}
      closeLabel={t('close')}
      className={css.pluginModal}
      footer={(
        <button type="button" className={css.done} onClick={onClose}>
          {t('settingsDone')}
        </button>
      )}
    >
      <PluginListBody service={service} kind={kind} />
    </Modal>
  )
}
