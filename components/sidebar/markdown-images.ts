/**
 * Markdown-preview local-image resolution. The shared `MarkdownText` (from
 * @deepseek-ai/dsh-client-ui-primitives) only renders absolute http(s) image
 * URLs — relative links are disabled for chat security — so a local image in
 * a previewed `.md` (`![alt](./img.png)`, an absolute `/cwd/img.png`, or a
 * reference definition) would otherwise fall back to its alt text. This
 * dependency-free helper rewrites those destinations into absolute
 * `/sidebar/file` media URLs (prefixed with the GUI's own origin) so
 * `MarkdownText` accepts them; the host media route then serves the bytes,
 * still restricted to files under the session cwd.
 */

import type { SessionScope } from './api'
import { isAbsolutePath } from './paths'

/**
 * True for a destination that is a remote URL — an absolute `scheme:` URL
 * that is not a Windows drive path (`C:\...`). http/https/data/mailto etc.
 * all match here and are handed back to `MarkdownText` untouched.
 */
function isRemoteUrl(dest: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(dest) && !/^[A-Za-z]:[\\/]/.test(dest)
}

/**
 * Collapse `.`/`..` segments of an absolute local path, preserving its root
 * (POSIX `/`), its Windows drive (`C:\`), or its UNC `\\server\share`
 * prefix. The host's `requireAbsolute` (`path.resolve`) normalizes anyway,
 * but producing a canonical path here keeps the `/sidebar/file` URL clean.
 */
function normalizeLocalPath(path: string): string {
  const drive = /^([A-Za-z]:)[\\/]/.exec(path)?.[1]
  const body = drive !== undefined ? path.slice(drive.length) : path
  const parts = body.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') { out.pop(); continue }
    out.push(part)
  }
  if (drive !== undefined) return `${drive}\\${out.join('\\')}`
  const separator = path.startsWith('\\') ? '\\' : '/'
  const root = path.startsWith('/') ? '/' : path.startsWith('\\') ? '\\\\' : ''
  return `${root}${out.join(separator)}`
}

/**
 * Rewrite markdown image destinations that point at local files into
 * absolute `/sidebar/file` media URLs. Relative destinations resolve against
 * the opened file's directory (normalizing `.`/`..` segments); absolute
 * local paths pass through. Remote (http/https/data/mailto) and `#`-anchor
 * destinations are left untouched for `MarkdownText`. Reference-style images
 * (`![x][id]` + `[id]: url`) are covered by rewriting their definition lines.
 *
 * Code spans (`` `...` ``) and fenced code blocks (``` ```...``` ```) are
 * masked before rewriting so documentation that demonstrates `![alt](./img.png)`
 * is not mutated into a `/sidebar/file` URL. Reference definitions are only
 * rewritten when their label is actually referenced by an image (collapsed
 * `[![][id]]`, full `![alt][id]`, or shortcut `![]` referencing the next
 * definition) — a plain link `[text][id]` must not have its destination
 * redirected to the media route.
 * @param text - The raw markdown source (inline + reference images).
 * @param scope - The session scope (sessionId + cwd) for the media route.
 * @param filePath - The absolute path of the opened `.md` file.
 * @param origin - The GUI's own origin (`window.location.origin`); injected
 * so the core rewrite stays pure and unit-testable.
 * @returns The markdown with local image destinations rewritten in place.
 */
/**
 * Resolve one media destination against the session's media route: local
 * (relative or absolute) paths become absolute `/sidebar/file` URLs (prefixed
 * with the GUI's own origin so the shared MarkdownText http(s) allowlist
 * accepts them), while remote URLs, `#`-anchors and empty destinations are
 * returned untouched. Shared by the markdown image rewriter below and by the
 * preview's raw-HTML sanitizer (`markdown-html.tsx`, which meets the same
 * allowlist when rendering `<img src="./x.png">` inside HTML blocks).
 */
export function resolveLocalMediaDest(
  dest: string,
  scope: SessionScope,
  filePath: string,
  origin: string,
): string {
  const trimmed = dest.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return dest
  if (isRemoteUrl(trimmed)) return dest
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const directory = slash === -1 ? '/' : filePath.slice(0, slash + 1)
  const candidate = isAbsolutePath(trimmed) ? trimmed : directory + trimmed
  // Mirrors api.ts fileUrl/mediaUrl for the /sidebar/file media route, made
  // absolute so the shared MarkdownText http(s) allowlist accepts it.
  const params = new URLSearchParams({ sessionId: scope.sessionId, path: normalizeLocalPath(candidate) })
  if (scope.cwd !== undefined && scope.cwd !== '') params.set('cwd', scope.cwd)
  return `${origin}/sidebar/file?${params.toString()}`
}

export function rewriteLocalImageUrls(
  text: string,
  scope: SessionScope,
  filePath: string,
  origin: string,
): string {
  const resolve = (dest: string): string => resolveLocalMediaDest(dest, scope, filePath, origin)

  // Mask fenced code blocks and inline code spans so image-looking text
  // inside documentation examples is never rewritten. The sentinel uses a
  // character unlikely to appear in prose; the original spans are restored
  // after the image rewrite.
  const masks: string[] = []
  const masked = text
    .replace(/```[\s\S]*?```/g, (block) => { masks.push(block); return `\u0000${masks.length - 1}\u0000` })
    .replace(/`[^`\n]*`/g, (span) => { masks.push(span); return `\u0000${masks.length - 1}\u0000` })

  const inline = masked.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, alt, dest) => {
    return `![${alt}](${resolve(dest)})`
  })

  // Collect labels referenced by image syntax (full `![alt][id]` and
  // collapsed `![][id]`) so only those reference definitions are rewritten.
  // A shortcut reference (`![alt]` with no `[id]`) resolves to the label
  // text `alt` itself; include it too. Plain links `[text][id]` never match
  // the leading `!` and are left untouched.
  const imageLabels = new Set<string>()
  const labelRe = /!\[([^\]]*)\](?:\[((?:[^\][]|\[[^\]]*\])*)\])?/g
  let labelMatch: RegExpExecArray | null
  while ((labelMatch = labelRe.exec(inline)) !== null) {
    const alt = labelMatch[1] ?? ''
    const ref = labelMatch[2]
    imageLabels.add(ref !== undefined && ref !== '' ? ref.toLowerCase() : alt.toLowerCase())
  }

  const refsRewritten = inline.replace(/^(\s*\[([^\]]+)\]:\s*)(<[^>]+>|[^\s]+)/gm, (match, head: string, label: string, dest: string) => {
    if (!imageLabels.has(label.toLowerCase())) return match
    return `${head}${resolve(dest.replace(/^<|>$/g, ''))}`
  })

  return refsRewritten.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => masks[Number(index)] ?? '')
}
