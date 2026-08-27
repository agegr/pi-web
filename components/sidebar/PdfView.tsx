/** Browser-native PDF preview with an always-available download fallback. */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { downloadUrl, mediaUrl, type SessionScope } from './api'
import { t } from './locales'
import css from './sidebar.module.css'

export function PdfView(props: { scope: SessionScope; path: string; title: string }) {
  const { scope, path, title } = props
  const [load, setLoad] = useState<
    | { status: 'loading' }
    | { status: 'ready'; url: string }
    | { status: 'error'; message: string }
  >({ status: 'loading' })
  const [interactionBlocked, setInteractionBlocked] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const shieldRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    setLoad({ status: 'loading' })
    void (async () => {
      try {
        const response = await fetch(mediaUrl(scope, path), { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const bytes = await response.arrayBuffer()
        if (controller.signal.aborted) return
        // A direct iframe navigation may download when an old host process or
        // proxy cached application/octet-stream. The Blob URL owns an explicit
        // PDF MIME and therefore consistently opens the browser PDF viewer.
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        setLoad({ status: 'ready', url: objectUrl })
      } catch (error) {
        if (controller.signal.aborted) return
        setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    })()
    return () => {
      controller.abort()
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
  }, [scope.sessionId, scope.cwd, path])

  useEffect(() => {
    const block = (): void => {
      setInteractionBlocked(true)
      if (frameRef.current !== null) frameRef.current.style.pointerEvents = 'none'
      if (shieldRef.current !== null) shieldRef.current.style.pointerEvents = 'auto'
    }
    const unblock = (): void => {
      setInteractionBlocked(false)
      if (frameRef.current !== null) frameRef.current.style.pointerEvents = ''
      if (shieldRef.current !== null) shieldRef.current.style.pointerEvents = 'none'
    }
    const blockForResize = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element
        && target.closest(`.${css.panelResize}, .${css.divider}`) !== null) {
        block()
      }
    }
    // An iframe is a separate browsing context and otherwise swallows the
    // dragover/pointer stream as soon as the cursor crosses it. Temporarily
    // remove it from hit-testing while a tab drag or pane resize is active.
    document.addEventListener('dragstart', block, true)
    document.addEventListener('dragend', unblock, true)
    document.addEventListener('drop', unblock, true)
    window.addEventListener('pointerdown', blockForResize, true)
    window.addEventListener('pointerup', unblock, true)
    window.addEventListener('pointercancel', unblock, true)
    window.addEventListener('blur', unblock)
    return () => {
      document.removeEventListener('dragstart', block, true)
      document.removeEventListener('dragend', unblock, true)
      document.removeEventListener('drop', unblock, true)
      window.removeEventListener('pointerdown', blockForResize, true)
      window.removeEventListener('pointerup', unblock, true)
      window.removeEventListener('pointercancel', unblock, true)
      window.removeEventListener('blur', unblock)
    }
  }, [])

  return (
    <div className={css.editorPdf}>
      <div className={css.editorPdfToolbar}>
        <a className={css.editorDownloadLink} href={downloadUrl(scope, path)} download>
          {t('downloadToView')}
        </a>
      </div>
      <div className={css.editorPdfStage}>
        {load.status === 'loading' && <div className={css.editorPlaceholder}>{t('loading')}</div>}
        {load.status === 'error' && <div className={css.editorError}>{load.message}</div>}
        {load.status === 'ready' && (
          <iframe
            ref={frameRef}
            className={clsx(css.editorPdfFrame, interactionBlocked && css.editorPdfFrameBlocked)}
            src={load.url}
            title={title}
          />
        )}
        <div
          ref={shieldRef}
          className={clsx(css.editorPdfDragShield, interactionBlocked && css.editorPdfDragShieldActive)}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
