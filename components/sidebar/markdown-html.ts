/**
 * Raw-HTML block detection for the markdown preview. The shared `MarkdownText`
 * renders raw HTML as literal text (a chat-security stance), so a GitHub-style
 * README (`<div align="center">` badge walls, `<details>` collapsibles with
 * markdown inside, table cells full of inline tags) previews as source soup.
 * This module's pure splitter lifts those HTML runs OUT of the markdown stream
 * before rendering: markdown runs keep flowing through `MarkdownText` (shiki /
 * KaTeX / GFM intact, mermaid chunk path unchanged) while HTML runs render as
 * sanitized DOM (see markdown-html.tsx).
 *
 * Splitting follows CommonMark's shape closely enough for real-world READMEs:
 * a line outside code fences that starts with a block-level tag (type-6 list
 * below) or `<!--` opens an HTML run that extends to the next blank line
 * (comments end at the line containing `-->`). Inline-only tags (`<b>`, `<br>`,
 * `<a>`…) never open a run — they stay in the markdown stream and are handled
 * by the inline pass instead. Unclosed block tags (`<details>` … markdown …
 * `</details>`) are surfaced by {@link analyzeHtmlSegment} as ordered parts so
 * the renderer can nest the in-between markdown inside the open element, the
 * way GitHub's linear HTML output nests.
 */

import { CLOSE_FENCE_RE, OPEN_FENCE_RE, fenceInfo } from './mermaid-blocks'

/** A run of raw HTML lines lifted out of the markdown stream. */
export interface HtmlSegment {
  kind: 'html'
  text: string
}

/** A run of markdown source (may contain non-mermaid fences, inline HTML…). */
export interface MarkdownHtmlSegment {
  kind: 'markdown'
  text: string
}

export type MdHtmlSegment = MarkdownHtmlSegment | HtmlSegment

/** The doc-wide analysis the preview consumes (all pure, unit-tested here). */
export interface AnalyzedMarkdownHtml {
  /** The document split into markdown / html runs (empty input → []). */
  segments: MdHtmlSegment[]
  /** True when at least one html run was lifted out. */
  hasBlockHtml: boolean
  /** True when the source contains any tag-like text (block OR inline). */
  hasInlineHtml: boolean
  /** Every reference definition found in the markdown runs (`[label]: dest`
   *  lines), joined — appended to each markdown run so `[text][id]` keeps
   *  resolving across the lifted HTML runs (first-match wins makes the
   *  appended copy inert inside runs that already define it). */
  referenceDefinitions: string
}

/**
 * CommonMark HTML-block type-6 tag names (block-level elements), lowercased.
 * A line starting with one of these (open or close) outside a fence begins an
 * HTML run. `<summary>` is CommonMark-inline but intentionally included: it is
 * the idiomatic first child of a `<details>` run in GitHub-flavored READMEs.
 */
export const HTML_BLOCK_TAGS: ReadonlySet<string> = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body',
  'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
  'hr', 'html', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'nav',
  'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'picture', 'pre',
  'section', 'source', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'title', 'tr', 'track', 'ul', 'video',
])

/** HTML void elements — never pushed on the balance stack. */
const VOID_TAGS: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
])

/** A block-tag line start: indent + `<` or `</` + tag name + space/`/`/`>`. */
const HTML_BLOCK_START_RE = /^ {0,3}<\/?([a-zA-Z][a-zA-Z0-9-]*)[\s/>]/

/** A comment-open line start (CommonMark type 2). */
const COMMENT_START_RE = /^ {0,3}<!--/

/** Tag-like text anywhere — the cheap gate for the inline pass. */
const TAGLIKE_RE = /<\/?[a-zA-Z][a-zA-Z0-9-]*[\s/>]/

/** One HTML tag token (open/close/void) in a lifted HTML run. */
interface HtmlToken {
  kind: 'open' | 'close' | 'void'
  tag: string
  /** Raw attribute source of an open tag (between the name and `>`/`/>`). */
  attrs: string
  start: number
  end: number
}

/** A comment range within a run — tags inside comments are not tokens. */
interface CommentRange {
  start: number
  end: number
}

/** A full tag match including its `>` (token regex; quotes guard `>` inside attrs). */
const TAG_TOKEN_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
const COMMENT_RE = /<!--[\s\S]*?-->/g

/**
 * Tokenize a lifted HTML run into tags (comments are located first so tags
 * inside them are skipped). Text between tokens is not tokenized — it stays
 * part of the raw `html` spans the part analysis slices out.
 */
function tokenizeHtml(source: string): HtmlToken[] {
  const comments: CommentRange[] = []
  for (const match of source.matchAll(COMMENT_RE)) {
    comments.push({ start: match.index, end: match.index + match[0].length })
  }
  const inComment = (index: number): boolean =>
    comments.some((range) => index >= range.start && index < range.end)
  const tokens: HtmlToken[] = []
  for (const match of source.matchAll(TAG_TOKEN_RE)) {
    if (inComment(match.index)) continue
    const closing = match[1] === '/'
    const tag = match[2]!.toLowerCase()
    let attrs = match[3] ?? ''
    // Self-closing syntax (`<div/>`) behaves as void regardless of the name.
    const selfClosing = /\/\s*$/.test(attrs)
    if (selfClosing) attrs = attrs.replace(/\/\s*$/, '')
    tokens.push({
      kind: closing ? 'close' : selfClosing || VOID_TAGS.has(tag) ? 'void' : 'open',
      tag,
      attrs,
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return tokens
}

/** One structural piece of a lifted HTML run, in document order. */
export type HtmlPart =
  | { kind: 'html'; html: string }
  | { kind: 'open'; tag: string; attrs: string }
  | { kind: 'close'; tag: string }

/** The run's structure relative to the surrounding document nesting. */
export interface HtmlSegmentShape {
  parts: HtmlPart[]
}

/**
 * Reduce a lifted HTML run to ordered parts: balanced spans become `html`
 * leaves, unclosed open tags become `open` (a wrapper the renderer lowers
 * following markdown runs into), unmatched closes become `close` (pops one
 * wrapper level). A mismatched close pops through the matching open — the
 * HTML parser's implicit-close behavior. Runs with no structural tags reduce
 * to a single `html` part.
 */
export function analyzeHtmlSegment(source: string): HtmlSegmentShape {
  const tokens = tokenizeHtml(source)
  const stack: { token: HtmlToken }[] = []
  const unmatchedCloses: HtmlToken[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token.kind === 'void') continue
    if (token.kind === 'open') {
      stack.push({ token })
      continue
    }
    // Close: pop through the nearest matching open (implicit closes inside).
    let matchAt = -1
    for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
      if (stack[depth]!.token.tag === token.tag) { matchAt = depth; break }
    }
    if (matchAt === -1) {
      unmatchedCloses.push(token)
      continue
    }
    stack.length = matchAt
  }

  // Structural tokens in source order: unmatched closes + surviving opens.
  const structural: Array<{ token: HtmlToken; kind: 'open' | 'close' }> = []
  for (const token of unmatchedCloses) structural.push({ token, kind: 'close' })
  for (const entry of stack) structural.push({ token: entry.token, kind: 'open' })
  structural.sort((a, b) => a.token.start - b.token.start)

  if (structural.length === 0) return { parts: [{ kind: 'html', html: source }] }

  const parts: HtmlPart[] = []
  let cursor = 0
  for (const { token, kind } of structural) {
    if (token.start > cursor) parts.push({ kind: 'html', html: source.slice(cursor, token.start) })
    parts.push(kind === 'open'
      ? { kind: 'open', tag: token.tag, attrs: token.attrs }
      : { kind: 'close', tag: token.tag })
    cursor = token.end
  }
  if (cursor < source.length) parts.push({ kind: 'html', html: source.slice(cursor) })
  return { parts }
}

/**
 * Split markdown source into markdown / html runs (fence-aware: an HTML-looking
 * line inside any fenced code block is content, not a run start). Blank lines
 * terminate HTML runs and are dropped between segments (they carry no markdown
 * semantics the preview needs); everything else stays byte-identical.
 */
export function splitHtmlBlocks(text: string): MdHtmlSegment[] {
  if (text === '') return []
  const lines = text.split('\n')
  const segments: MdHtmlSegment[] = []
  let markdown: string[] = []
  let html: string[] = []
  /** Fence state: the char + length of the currently open fence, if any. */
  let openFence: { char: string; length: number } | null = null
  /** Comment state: an HTML comment run ends at the line containing `-->`. */
  let inComment = false
  /** True while accumulating a blank-line-terminated HTML run. */
  let inHtmlRun = false

  const flushMarkdown = (): void => {
    // Separator blank lines around HTML runs carry no markdown semantics.
    while (markdown.length > 0 && isBlank(markdown[markdown.length - 1] ?? '')) markdown.pop()
    if (markdown.length === 0) return
    segments.push({ kind: 'markdown', text: markdown.join('\n') })
    markdown = []
  }
  const flushHtml = (): void => {
    if (html.length === 0) return
    segments.push({ kind: 'html', text: html.join('\n') })
    html = []
    inHtmlRun = false
    inComment = false
  }
  const isBlank = (line: string): boolean => /^[ \t]*$/.test(line)

  for (const line of lines) {
    if (openFence !== null) {
      const close = CLOSE_FENCE_RE.exec(line)
      if (close !== null && close[1]!.charAt(0) === openFence.char && close[1]!.length >= openFence.length) {
        openFence = null
      }
      markdown.push(line)
      continue
    }
    const fenceMatch = OPEN_FENCE_RE.exec(line)
    if (fenceMatch !== null) {
      const fence = fenceMatch[1]!
      const rest = line.slice(fenceMatch.index + fenceMatch[0].length)
      const info = fenceInfo(rest, fence)
      if (info !== null) {
        openFence = { char: fence.charAt(0), length: fence.length }
        markdown.push(line)
        continue
      }
      // Not a valid fence (backtick info containing backticks): plain text.
      markdown.push(line)
      continue
    }

    if (inComment) {
      html.push(line)
      if (line.includes('-->')) flushHtml()
      continue
    }
    if (inHtmlRun) {
      if (isBlank(line)) {
        flushHtml()
        continue
      }
      html.push(line)
      continue
    }

    if (COMMENT_START_RE.test(line)) {
      flushMarkdown()
      html.push(line)
      inComment = true
      if (line.includes('-->')) flushHtml()
      continue
    }
    const htmlMatch = HTML_BLOCK_START_RE.exec(line)
    const tag = htmlMatch?.[1]?.toLowerCase()
    if (htmlMatch !== null && tag !== undefined && HTML_BLOCK_TAGS.has(tag)) {
      flushMarkdown()
      html.push(line)
      inHtmlRun = true
      continue
    }
    // Blank lines only survive inside a markdown run (paragraph separators);
    // at a run boundary they are separators and are dropped.
    if (isBlank(line) && markdown.length === 0) continue
    markdown.push(line)
  }
  flushMarkdown()
  flushHtml()
  return segments
}

/** A reference definition line: `[label]: destination` (up to 3 spaces indent). */
const REFERENCE_DEF_RE = /^ {0,3}\[((?:[^\][]|\[[^\]]*\])*)\]:\s*(?:<([^<>]*)>|(\S+))/

/**
 * Collect the reference definitions of every markdown run (HTML runs cannot
 * define them), in document order, newline-joined for appending.
 */
export function collectReferenceDefinitions(segments: readonly MdHtmlSegment[]): string {
  const defs: string[] = []
  for (const segment of segments) {
    if (segment.kind !== 'markdown') continue
    for (const line of segment.text.split('\n')) {
      if (REFERENCE_DEF_RE.test(line)) defs.push(line)
    }
  }
  return defs.join('\n')
}

/**
 * The whole-document gate + split the preview consumes. `hasInlineHtml` is a
 * cheap source-level regex (code-fence content may false-positive; the inline
 * pass skips rendered code blocks anyway, so a false positive only costs the
 * enhanced render path, never a behavior change).
 */
export function analyzeMarkdownHtml(text: string): AnalyzedMarkdownHtml {
  const segments = splitHtmlBlocks(text)
  return {
    segments,
    hasBlockHtml: segments.some((segment) => segment.kind === 'html'),
    hasInlineHtml: TAGLIKE_RE.test(text),
    referenceDefinitions: collectReferenceDefinitions(segments),
  }
}
