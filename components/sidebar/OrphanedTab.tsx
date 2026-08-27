/**
 * Placeholder shown when a persisted tab's type is not registered (the
 * contributing plugin is not installed / not yet loaded). The tab is kept
 * in state so it can recover if the plugin loads later; the user can close
 * it through the tab bar's X button as usual. This is the graceful-
 * degradation path for the open tab-type set: {@link Sidebar} renders this
 * instead of crashing on an unknown type.
 */
import type { ReactNode } from 'react'
import { t } from './locales'
import css from './sidebar.module.css'
import type { TabComponentProps } from './service'

export function OrphanedTab(props: TabComponentProps): ReactNode {
  const { tab } = props
  return (
    <div className={css.editor}>
      <div className={css.editorHeader}>
        <span className={css.editorTitle} title={tab.type}>{tab.title}</span>
      </div>
      <div className={css.editorPlaceholder}>
        <span>{t('pluginNotLoaded')}</span>
        <code className={css.orphanedType}>{tab.type}</code>
      </div>
    </div>
  )
}
