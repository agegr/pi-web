/**
 * Full-window upload progress over the files tree: a blurred scrim (same mask
 * token as the repo's Modal primitive) with a card showing the target
 * directory, file-level progress, and a cancel button. Esc cancels too —
 * clicking the scrim does not, so a stray click can never abort an upload.
 * Rendered inside TreePanel (absolute inset-0), so it covers only the file
 * window and never the conversation column.
 */
import { useEffect, type ReactNode } from 'react'
import { IconUploadOutline16 } from './icons'
import { t } from './locales'
import { uploadHintText } from './upload'
import css from './sidebar.module.css'

export function UploadOverlay(props: {
  /** Absolute upload directory (the session workspace or a tree directory). */
  dir: string
  done: number
  total: number
  /** Relative path of the file being uploaded ('' when none is in flight). */
  current: string
  onCancel: () => void
  /** True while cancellation is in flight (disables the cancel button). */
  cancelling?: boolean
}): ReactNode {
  const { dir, done, total, current, onCancel, cancelling } = props
  // Esc cancels (MermaidModal-style native listener; the overlay is not a
  // focus-trapped dialog, so a window listener is the honest scope).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onCancel])

  const percent = total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100))
  return (
    <div className={css.uploadOverlay} role="dialog" aria-modal="true" aria-label={t('uploadingTo', { dir })}>
      <div className={css.uploadOverlayCard}>
        <div className={css.uploadOverlayTitle} title={dir}>
          <IconUploadOutline16 size={16} />
          <span>{t('uploadingTo', { dir })}</span>
        </div>
        <div
          className={css.uploadOverlayProgress}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-valuetext={t('uploadProgress', { done, total, name: current })}
        >
          <div className={css.uploadOverlayProgressFill} style={{ width: `${percent}%` }} />
        </div>
        <div className={css.uploadOverlayStatus}>{uploadHintText(done, total, current, dir, t)}</div>
        <button type="button" className={css.uploadOverlayCancel} disabled={cancelling} onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
    </div>
  )
}
