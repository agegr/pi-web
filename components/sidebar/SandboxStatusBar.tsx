/**
 * The live sandbox status row of the two built-in web surfaces (HTML
 * preview and the browser tab): a green "sandbox on" state with a one-tap
 * TEMPORARY unlock, or a RED "sandbox off" state (global setting or the
 * temporary unlock) with a restore action.
 *
 * The temporary unlock is component state only — it never writes the
 * global side card setting (`htmlViewerNoSandbox` / `browserNoSandbox`);
 * it lasts until the surface unmounts (tab switch / file switch) or the
 * user restores the sandbox from the row. When the global setting already
 * drops the sandbox, no unlock/restore action is offered (changing the
 * global setting is the settings page's job) — the red warning stands.
 */
import clsx from 'clsx'
import { t } from './locales'
import css from './sidebar.module.css'

export function SandboxStatusBar(props: {
  /** The effective sandbox state (global pref OR the local temporary unlock). */
  sandboxed: boolean
  /** Whether the sandbox is off due to the LOCAL temporary unlock (shows the restore action). */
  local: boolean
  /** The red-state explanation (e.g. "the page runs with full GUI privileges"). */
  dangerCopy: string
  onUnlock: () => void
  onRestore: () => void
}) {
  const { sandboxed, local, dangerCopy, onUnlock, onRestore } = props
  if (sandboxed) {
    const copy = t('sandboxStatusOn')
    return (
      <div className={clsx(css.sandboxStatus, css.sandboxStatusOn)}>
        <span className={css.sandboxDot} />
        <span className={css.sandboxStatusText} title={copy}>{copy}</span>
        <button
          type="button"
          className={css.sandboxAction}
          onClick={onUnlock}
        >
          {t('sandboxUnlock')}
        </button>
      </div>
    )
  }
  return (
    <div className={clsx(css.sandboxStatus, css.sandboxStatusOff)}>
      <span className={css.sandboxDot} />
      <span className={css.sandboxStatusText} title={dangerCopy}>{dangerCopy}</span>
      {local && (
        <button
          type="button"
          className={css.sandboxAction}
          onClick={onRestore}
        >
          {t('sandboxRestore')}
        </button>
      )}
    </div>
  )
}
