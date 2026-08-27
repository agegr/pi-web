/**
 * The editor tab's custom settings panel ("打开方式"): the file tree's
 * "open with" configuration — the optional SSH host marking the workspace as
 * remote, and the user-defined editors (name + URL template with `{path}` +
 * whether they speak the VSCode URL dialect). Persisted as the editor
 * blob's `openWith` key through the settings popup's `updatePluginSetting`.
 *
 * The popup renders the declarative rows (the editorExplorer picker) ABOVE
 * this panel — SettingsBody renders the custom panel after the row list, so
 * this component owns only its own section.
 */
import { useState } from 'react'
import { IconCloseOutline16 } from "./ui-primitives"
import {
  isValidCustomEditor,
  newCustomEditorId,
  parseOpenWithConfig,
  type CustomEditor,
  type OpenWithConfig,
} from './open-with'
import { t } from './locales'
import css from './SideCardSection.module.css'

export function OpenWithSettings(props: {
  pluginSettings: Record<string, unknown>
  updatePluginSetting: (key: string, value: unknown) => void
}) {
  const { pluginSettings, updatePluginSetting } = props
  // Local draft seeded from the persisted blob (each commit re-renders the
  // popup with the round-tripped prefs; the local state stays authoritative
  // while the popup is open, so typing never fights an in-flight write).
  const [draft, setDraft] = useState<OpenWithConfig>(() => parseOpenWithConfig(pluginSettings.openWith))

  const commit = (next: OpenWithConfig): void => {
    setDraft(next)
    updatePluginSetting('openWith', next)
  }

  const setSshHost = (sshHost: string): void => commit({ ...draft, sshHost })

  const patchCustom = (id: string, patch: Partial<CustomEditor>): void => {
    commit({
      ...draft,
      customEditors: draft.customEditors.map(editor => editor.id === id ? { ...editor, ...patch } : editor),
    })
  }

  const removeCustom = (id: string): void => {
    commit({
      ...draft,
      customEditors: draft.customEditors.filter(editor => editor.id !== id),
      // A removed editor can never stay pinned (the menu prunes unknown ids
      // anyway; this keeps the blob clean).
      pinned: draft.pinned.filter(pinnedId => pinnedId !== `custom:${id}`),
    })
  }

  const addCustom = (): void => {
    commit({
      ...draft,
      customEditors: [...draft.customEditors, { id: newCustomEditorId(), name: '', urlTemplate: '', isVscodeFamily: false }],
    })
  }

  const hasInvalid = draft.customEditors.some(editor => !isValidCustomEditor(editor))

  return (
    <div className={css.popupRows}>
      <div className={css.popupRow}>
        <span className={css.rowText}>
          <span className={css.title}>{t('openWithSettingsSshTitle')}</span>
          <span className={css.desc}>{t('openWithSettingsSshDesc')}</span>
        </span>
        <input
          className={css.typedInput}
          value={draft.sshHost}
          placeholder={t('openWithSettingsSshPlaceholder')}
          spellCheck={false}
          onChange={(event) => { setSshHost(event.target.value) }}
        />
      </div>
      <div className={css.popupRow}>
        <span className={css.rowText}>
          <span className={css.title}>{t('openWithSettingsCustomTitle')}</span>
          <span className={css.desc}>{t('openWithSettingsCustomDesc')}</span>
        </span>
        <span className={css.control}>
          <button type="button" className={css.done} onClick={addCustom}>
            {t('openWithSettingsAdd')}
          </button>
        </span>
      </div>
      {draft.customEditors.map(editor => (
        <div key={editor.id} className={css.openWithEditorRow}>
          <input
            className={css.openWithEditorInput}
            value={editor.name}
            placeholder={t('openWithSettingsName')}
            spellCheck={false}
            onChange={(event) => { patchCustom(editor.id, { name: event.target.value }) }}
          />
          <input
            className={css.openWithEditorTemplate}
            value={editor.urlTemplate}
            placeholder={t('openWithSettingsTemplate')}
            spellCheck={false}
            onChange={(event) => { patchCustom(editor.id, { urlTemplate: event.target.value }) }}
          />
          <label className={css.openWithFamily} title={t('openWithSettingsFamilyDesc')}>
            <input
              type="checkbox"
              checked={editor.isVscodeFamily}
              onChange={(event) => { patchCustom(editor.id, { isVscodeFamily: event.currentTarget.checked }) }}
            />
            <span>{t('openWithSettingsFamily')}</span>
          </label>
          <button
            type="button"
            className={css.openWithRemove}
            aria-label={t('openWithSettingsRemove')}
            title={t('openWithSettingsRemove')}
            onClick={() => { removeCustom(editor.id) }}
          >
            <IconCloseOutline16 size={14} />
          </button>
        </div>
      ))}
      {hasInvalid && (
        <div className={css.openWithHint} role="note">
          {t('openWithSettingsInvalidHint')}
        </div>
      )}
    </div>
  )
}
