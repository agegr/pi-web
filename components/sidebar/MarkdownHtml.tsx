/**
 * The markdown preview's raw-HTML renderer. `markdown-html.ts` lifts HTML
 * runs out of the markdown stream; this module renders them as sanitized DOM
 * alongside the markdown runs (which keep flowing through the shared
 * `MarkdownText`), nests markdown into unclosed block elements the way
 * GitHub's linear HTML output does (`<details>` … fence … `</details>`), and
 * runs an inline pass that turns literal tag text inside rendered markdown
 * (table cells with `<br/>`, `<sub>`, `<img>`) back into elements.
 *
 * Security posture: every HTML string (block leaves, inline text, wrapper
 * open-tag attributes) goes through DOMPurify with an explicit denylist on
 * top of its defaults (no script/style/iframe/forms), anchors are forced to
 * open in a new tab with noopener, and local media `src` attributes are
 * rewritten through the session-scoped `/sidebar/file` media route — the same
 * trust fence the markdown image rewriter (`markdown-images.ts`) uses.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { createElement, type ReactNode } from 'react'
import DOMPurify from 'dompurify'
import { MarkdownText } from "./ui-primitives"
import type { ComponentType } from 'react'
import { lazyChunkComponent } from './lazy-chunk'
import { resolveLocalMediaDest } from './markdown-images'
import {
  analyzeHtmlSegment,
  type AnalyzedMarkdownHtml,
} from './markdown-html'
import { splitMermaidBlocks, type MermaidMarkdownProps } from './mermaid-blocks'
import type { SessionScope } from './api'
import css from './sidebar.module.css'

/** The chunk-resident markdown renderer (mermaid lazy chunk), shared with the
 *  legacy no-HTML preview path in TextEditor. */
export const LazyMermaidMarkdown = lazyChunkComponent<MermaidMarkdownProps>(
  'mermaid',
  (mod) => mod.MermaidMarkdown as ComponentType<MermaidMarkdownProps> | undefined,
)

/** Everything the sanitizers need to resolve local media + scope the route. */
export interface MarkdownHtmlMedia {
  scope: SessionScope
  path: string
  origin: string
}

/** Tag-like text in a rendered text node — the inline pass gate. */
const TAGLIKE_TEXT_RE = /<\/?[a-zA-Z][a-zA-Z0-9-]*[\s/>]/

/** Explicit denylist on top of DOMPurify's defaults: no active content, no
 *  form chrome, no document-level elements inside a preview. */
const PURIFY_FORBID_TAGS = [
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'select', 'textarea', 'meta', 'link', 'base', 'frame', 'frameset', 'applet',
]
const PURIFY_FORBID_ATTR = ['srcdoc', 'formaction']

/**
 * Post-sanitize hardening on a detached element tree: anchors open in a new
 * tab (never navigate the GUI), and local media sources go through the media
 * route so they render instead of being dropped by protocol allowlists.
 */
function postProcessSanitized(root: Element, media: MarkdownHtmlMedia): void {
  for (const anchor of root.querySelectorAll('a[href]')) {
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  }
  for (const element of root.querySelectorAll('img, video, audio, source')) {
    const src = element.getAttribute('src')
    if (src === null) continue
    element.setAttribute('src', resolveLocalMediaDest(src, media.scope, media.path, media.origin))
  }
}

/** Sanitize one balanced HTML span into markup for dangerouslySetInnerHTML. */
function sanitizeHtmlBlock(source: string, media: MarkdownHtmlMedia): string {
  const holder = document.createElement('div')
  holder.innerHTML = DOMPurify.sanitize(source, {
    FORBID_TAGS: PURIFY_FORBID_TAGS,
    FORBID_ATTR: PURIFY_FORBID_ATTR,
  })
  postProcessSanitized(holder, media)
  return holder.innerHTML
}

/**
 * Sanitize literal tag text from a rendered markdown text node. Returns null
 * when nothing real survived (pure prose like `a < b` — the DOMPurify output
 * has no element children), so the caller leaves the text node untouched.
 */
function sanitizeInlineHtml(text: string, media: MarkdownHtmlMedia): string | null {
  const holder = document.createElement('span')
  holder.innerHTML = DOMPurify.sanitize(text, {
    FORBID_TAGS: PURIFY_FORBID_TAGS,
    FORBID_ATTR: PURIFY_FORBID_ATTR,
  })
  if (holder.firstElementChild === null) return null
  postProcessSanitized(holder, media)
  return holder.innerHTML
}

/**
 * Sanitize a wrapper open tag (`<details open>`) into React props. Returns
 * null when DOMPurify dropped the whole tag (denied element) — the renderer
 * then treats the wrapper as transparent. `class`/`for` map to their React
 * names; `style` is dropped (React needs an object; wrappers with inline
 * styles are vanishingly rare and not worth a CSS parser).
 */
function sanitizeTagProps(tag: string, attrs: string): Record<string, string> | null {
  const probe = DOMPurify.sanitize(`<${tag}${attrs}></${tag}>`, {
    FORBID_TAGS: PURIFY_FORBID_TAGS,
    FORBID_ATTR: PURIFY_FORBID_ATTR,
  })
  const holder = document.createElement('div')
  holder.innerHTML = probe
  const element = holder.firstElementChild
  if (element === null || element.tagName.toLowerCase() !== tag) return null
  const props: Record<string, string> = {}
  for (const attr of element.attributes) {
    if (/^on/i.test(attr.name) || !/^[a-zA-Z][a-zA-Z0-9:._-]*$/.test(attr.name)) continue
    if (attr.name === 'style') continue
    props[attr.name === 'class' ? 'className' : attr.name === 'for' ? 'htmlFor' : attr.name] = attr.value
  }
  return props
}

/**
 * The inline pass: walk the rendered markdown's text nodes and swap any that
 * contain tag-like text for a sanitized `<span data-html-inline>`. Rendered
 * code (inline `code`, `pre`, the host `.md-code-block`, mermaid mounts, and
 * spans this pass already produced) is skipped. The same commit-then-operate
 * pattern the mermaid swap uses: React keeps owning the host tree, only leaf
 * text nodes are replaced, and a text change re-renders the subtree fresh.
 */
function runInlineHtmlPass(container: HTMLElement, media: MarkdownHtmlMedia): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = (node as Text).parentElement
      if (parent === null) return NodeFilter.FILTER_REJECT
      if (parent.closest('code, pre, .md-code-block, [data-mermaid-processed], [data-html-inline]')) {
        return NodeFilter.FILTER_REJECT
      }
      return TAGLIKE_TEXT_RE.test((node as Text).data)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
    },
  })
  const targets: Text[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) targets.push(node as Text)
  for (const node of targets) {
    const html = sanitizeInlineHtml(node.data, media)
    if (html === null) continue
    const span = document.createElement('span')
    span.setAttribute('data-html-inline', '')
    span.innerHTML = html
    node.replaceWith(span)
  }
}

interface MarkdownSegmentProps {
  text: string
  hasMermaid: boolean
  media: MarkdownHtmlMedia
  codeLabels: { copyLabel: string; copiedLabel: string }
}

/**
 * One markdown run of a split document: the shared MarkdownText pass (or the
 * mermaid chunk renderer when the run contains a mermaid fence), plus the
 * inline HTML pass. The pass runs after every text change and is re-armed by
 * a MutationObserver so it also catches content that appears late (the lazy
 * mermaid chunk mounting, shiki highlighting settling) — it is idempotent and
 * skips its own output, so mutation feedback settles after one extra pass.
 */
function MarkdownSegment({ text, hasMermaid, media, codeLabels }: MarkdownSegmentProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const container = containerRef.current
    if (container === null) return
    runInlineHtmlPass(container, media)
    let scheduled = false
    const observer = new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        runInlineHtmlPass(container, media)
      })
    })
    observer.observe(container, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [text, media])
  return (
    <div ref={containerRef}>
      {hasMermaid
        ? <LazyMermaidMarkdown text={text} codeLabels={codeLabels} />
        : <MarkdownText text={text} codeLabels={codeLabels} />}
    </div>
  )
}

/** A sanitized, balanced HTML span rendered as its own block. */
function HtmlLeaf({ html }: { html: string }): ReactNode {
  return (
    <div className={css.editorHtmlBlock} data-dsh-html-segment dangerouslySetInnerHTML={{ __html: html }} />
  )
}

/** One fully-prepared HTML run: sanitized leaves + wrapper opens/closes. */
type PreparedHtmlPart =
  | { kind: 'html'; html: string }
  | { kind: 'open'; tag: string; props: Record<string, string> | null }
  | { kind: 'close' }

type PreparedSegment =
  | { kind: 'markdown'; text: string; hasMermaid: boolean }
  | { kind: 'html'; parts: PreparedHtmlPart[] }

interface MarkdownDocumentProps {
  info: AnalyzedMarkdownHtml
  media: MarkdownHtmlMedia
  codeLabels: { copyLabel: string; copiedLabel: string }
}

/**
 * The split-document renderer: markdown runs render through MarkdownSegment,
 * HTML runs render as sanitized leaves, and unclosed block elements lower the
 * following runs into themselves until their close part pops the frame (the
 * renderer's frame stack persists across segments). Stray closes at the top
 * level render nothing (the sanitizer/parser would drop them anyway), and
 * frames still open at the end of the document are closed like a browser
 * parser would. Sanitization runs once per prepared change, in a memo.
 */
export function MarkdownDocument({ info, media, codeLabels }: MarkdownDocumentProps): ReactNode {
  const prepared = useMemo<PreparedSegment[]>(() => info.segments.map((segment): PreparedSegment => {
    if (segment.kind === 'markdown') {
      const defs = info.referenceDefinitions
      const text = defs === '' ? segment.text : `${segment.text}\n\n${defs}`
      return {
        kind: 'markdown',
        text,
        hasMermaid: splitMermaidBlocks(text).some((block) => block.kind === 'mermaid'),
      }
    }
    return {
      kind: 'html',
      parts: analyzeHtmlSegment(segment.text).parts.map((part): PreparedHtmlPart => {
        if (part.kind === 'html') return { kind: 'html', html: sanitizeHtmlBlock(part.html, media) }
        if (part.kind === 'open') return { kind: 'open', tag: part.tag, props: sanitizeTagProps(part.tag, part.attrs) }
        return { kind: 'close' }
      }),
    }
  // `media` is a memoized object in the host (TextEditor); identity tracks
  // scope/path/origin changes so sanitization re-runs exactly when needed.
  }), [info, media])

  const nodes: ReactNode[] = []
  const frames: { tag: string; props: Record<string, string> | null; children: ReactNode[] }[] = []
  const emit = (node: ReactNode): void => {
    const frame = frames[frames.length - 1]
    if (frame !== undefined) frame.children.push(node)
    else nodes.push(node)
  }
  let key = 0
  for (const segment of prepared) {
    if (segment.kind === 'markdown') {
      emit(<MarkdownSegment key={`md-${key += 1}`} text={segment.text} hasMermaid={segment.hasMermaid} media={media} codeLabels={codeLabels} />)
      continue
    }
    for (const part of segment.parts) {
      if (part.kind === 'html') {
        if (part.html.trim() === '') continue
        emit(<HtmlLeaf key={`html-${key += 1}`} html={part.html} />)
      } else if (part.kind === 'open') {
        frames.push({ tag: part.tag, props: part.props, children: [] })
      } else {
        const frame = frames.pop()
        if (frame === undefined) continue
        if (frame.props === null) {
          for (const child of frame.children) emit(child)
        } else {
          emit(createElement(frame.tag, { ...frame.props, key: `wrap-${key += 1}` }, ...frame.children))
        }
      }
    }
  }
  while (frames.length > 0) {
    const frame = frames.pop()!
    if (frame.props === null) {
      for (const child of frame.children) emit(child)
    } else {
      emit(createElement(frame.tag, { ...frame.props, key: `wrap-${key += 1}` }, ...frame.children))
    }
  }
  return <>{nodes}</>
}
