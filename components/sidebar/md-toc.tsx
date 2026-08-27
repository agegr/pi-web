/**
 * The markdown preview's table of contents: a sticky zero-height bar keeping
 * a small "outline" button pinned at the top-right of the preview's scroll
 * container, visible once the document has at least {@link TOC_MIN_HEADINGS}
 * headings. The button opens a popover outline (h1–h6 collected from the
 * rendered DOM — so headings inside HTML runs count too); clicking an entry
 * expands any collapsed `<details>` ancestor, smooth-scrolls the heading into
 * view and flashes it. The scan re-runs through a MutationObserver so late
 * content (lazy mermaid chunk, shiki highlighting) is picked up.
 *
 * Mount contract: render as a DIRECT child of the scroll container it
 * outlines. The container is discovered through the bar's own DOM position
 * (`parentElement`), not a passed ref — React attaches a parent host
 * element's ref only after its children's layout effects have run, so a
 * ref-based container read here would see null at mount and never re-run.
 * The bar itself renders unconditionally (zero height, pointer-events
 * none), so it never affects the preview layout.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { IconListPenOutline16 } from "./ui-primitives"
import { t } from './locales'
import css from './sidebar.module.css'

/** Fewer headings than this and the button stays hidden (no outline value). */
export const TOC_MIN_HEADINGS = 3

/** One collected outline entry; `el` is the live rendered heading element. */
interface TocEntry {
  level: number
  text: string
  el: HTMLElement
}

/** The signature used to skip no-op rescans (identity-safe setState guard). */
function signatureOf(entries: readonly TocEntry[]): string {
  return entries.map((entry) => `${entry.level}:${entry.text}`).join('\n')
}

export function MdToc(): ReactNode {
  const barRef = useRef<HTMLDivElement>(null)
  const [entries, setEntries] = useState<TocEntry[]>([])
  const [open, setOpen] = useState(false)
  const signatureRef = useRef('')

  useLayoutEffect(() => {
    // The bar's own host ref is attached before this effect runs; the scroll
    // container is its parent by the mount contract above.
    const container = barRef.current?.parentElement ?? null
    if (container === null) return
    const scan = (): void => {
      const found: TocEntry[] = []
      for (const el of container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
        const text = (el.textContent ?? '').trim()
        if (text === '') continue
        found.push({ level: Number(el.tagName.charAt(1)), text, el })
      }
      const signature = signatureOf(found)
      if (signature === signatureRef.current) return
      signatureRef.current = signature
      setEntries(found)
    }
    scan()
    const observer = new MutationObserver(() => { scan() })
    observer.observe(container, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [])

  // Esc closes the popover (the panel is a sibling of the button, so focus
  // stays wherever the user came from — a document listener is the simplest).
  useLayoutEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [open])

  const jump = (entry: TocEntry): void => {
    entry.el.closest('details:not([open])')?.setAttribute('open', '')
    entry.el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const el = entry.el
    const flash = css.tocFlash
    if (flash !== undefined) {
      el.classList.add(flash)
      window.setTimeout(() => { el.classList.remove(flash) }, 1200)
    }
    setOpen(false)
  }

  const showOutline = entries.length >= TOC_MIN_HEADINGS
  return (
    <div className={css.tocBar} ref={barRef}>
      {open && showOutline && (
        <div className={css.tocPanel} data-dsh-md-toc-panel>
          {entries.map((entry, index) => (
            <button
              key={index}
              type="button"
              className={css.tocItem}
              data-level={entry.level}
              title={entry.text}
              onClick={() => { jump(entry) }}
            >
              <span className={css.tocItemLevel}>{entry.level}</span>
              <span className={css.tocItemText}>{entry.text}</span>
            </button>
          ))}
        </div>
      )}
      {showOutline && (
        <button
          type="button"
          className={css.tocButton}
          data-dsh-md-toc=""
          aria-label={t('toc')}
          title={t('toc')}
          aria-expanded={open}
          onClick={() => { setOpen(!open) }}
        >
          <IconListPenOutline16 />
        </button>
      )}
    </div>
  )
}
