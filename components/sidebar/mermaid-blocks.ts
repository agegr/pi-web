/**
 * Markdown/mermaid fence detection for the markdown preview. The preview
 * renders the WHOLE document through one DSH `MarkdownText` pass (so
 * cross-fence semantics — reference-style links, footnotes, list
 * continuity — stay intact) and the mermaid lazy chunk then swaps the
 * rendered `language-mermaid` code blocks for diagrams. This module's pure
 * splitter exists to detect whether the source contains a mermaid fence at
 * all, so the mermaid chunk is only fetched when needed (unit-tested in
 * tests/mermaid-blocks.spec.ts).
 */

/** One fenced mermaid diagram lifted out of the markdown source. */
export interface MermaidBlock {
  kind: 'mermaid'
  /** The raw diagram source between the fences (info string stripped). */
  code: string
}

/** A span of plain markdown source (may itself contain non-mermaid fences). */
export interface MarkdownBlock {
  kind: 'markdown'
  text: string
}

export type MdBlock = MarkdownBlock | MermaidBlock

/** Props of the chunk-resident `MermaidMarkdown` component (shared contract). */
export interface MermaidMarkdownProps {
  /** The full markdown source (rendered in a single MarkdownText pass). */
  text: string
  codeLabels: { copyLabel: string; copiedLabel: string }
}

/** CommonMark opening fence: 0-3 spaces indent + a run of 3+ backticks or tildes. */
export const OPEN_FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

/** A closing-fence line: 0-3 spaces indent + 3+ backticks/tildes + trailing spaces only. */
export const CLOSE_FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

/** Parse the info string from the line tail after the fence run; null when invalid. */
export function fenceInfo(rest: string, fence: string): string | null {
  const info = rest.trimStart().split(/\s+/)[0] ?? ''
  // CommonMark: a backtick fence's info string may not contain backticks —
  // such a line is not an opening fence at all.
  if (fence.charAt(0) === '`' && info.includes('`')) return null
  return info
}

/** True when the fence info string names mermaid (bare or `mermaid{...}`). */
function isMermaidInfo(info: string): boolean {
  const word = info.toLowerCase()
  return word === 'mermaid' || word.startsWith('mermaid{')
}

/**
 * Split markdown source into md/mermaid blocks for detection: only fences
 * whose info string names mermaid are lifted; every other line stays in the
 * markdown stream untouched. CommonMark fence rules are honored — opening
 * fences of 3+ backticks OR tildes, and a closing fence must use the same
 * character with at least as many characters as the opening fence. An
 * unterminated mermaid fence swallows the rest of the file (the same
 * recovery CommonMark applies to open fences).
 */
export function splitMermaidBlocks(text: string): MdBlock[] {
  if (text === '') return []
  const lines = text.split('\n')
  const blocks: MdBlock[] = []
  let markdown: string[] = []
  let index = 0
  const flushMarkdown = (): void => {
    if (markdown.length === 0) return
    blocks.push({ kind: 'markdown', text: markdown.join('\n') })
    markdown = []
  }
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const fenceMatch = OPEN_FENCE_RE.exec(line)
    if (fenceMatch === null) {
      markdown.push(line)
      index += 1
      continue
    }
    const fence = fenceMatch[1]!
    // The line tail after the whole matched prefix (indent + fence run).
    const rest = line.slice(fenceMatch.index + fenceMatch[0].length)
    const info = fenceInfo(rest, fence)
    if (info === null || !isMermaidInfo(info)) {
      markdown.push(line)
      index += 1
      continue
    }
    flushMarkdown()
    const char = fence.charAt(0)
    const length = fence.length
    const code: string[] = []
    index += 1
    while (index < lines.length) {
      const candidate = lines[index] ?? ''
      const close = CLOSE_FENCE_RE.exec(candidate)
      if (close !== null && close[1]!.charAt(0) === char && close[1]!.length >= length) break
      code.push(candidate)
      index += 1
    }
    // Consume the closing fence (or run off the end on an open fence).
    index += 1
    blocks.push({ kind: 'mermaid', code: code.join('\n') })
  }
  flushMarkdown()
  return blocks
}
