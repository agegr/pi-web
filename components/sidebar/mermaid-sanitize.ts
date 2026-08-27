/**
 * SVG sanitization for mermaid-rendered diagrams (markdown preview). The
 * diagrams come from untrusted markdown sources, so the emitted SVG is
 * re-sanitized before it reaches dangerouslySetInnerHTML — defense in depth
 * on top of mermaid's own `securityLevel: 'strict'` (labels escaped, click
 * directives inert) and `htmlLabels: false` (labels as real SVG <text>).
 *
 * What is stripped, and why:
 * - `foreignObject`: the only channel that can carry raw HTML inside an
 *   SVG document — with it gone, a hostile label cannot smuggle an
 *   <img onerror> / <iframe> through the XML parse (any non-SVG element
 *   outside foreignObject makes the XML parse fail and the whole diagram
 *   is rejected).
 * - `script` and foreign HTML elements (`img`/`iframe`/`object`/`embed`/
 *   `video`/`audio`/`input`/`button`/`form`/`link`/`meta`/`base`): belt and
 *   braces — real browsers reject these outside foreignObject at XML parse
 *   time (→ '') while lenient parsers keep them, so they are stripped
 *   explicitly instead of relying on the parser alone. Element names are
 *   matched case-insensitively (XML preserves their case; the output is
 *   re-parsed as HTML whose parser normalizes tag casing, so `<sCrIpT>` /
 *   `<foreignobject>` would otherwise come back as script/foreignObject).
 * - `@*` / `on*` attributes: event-handler channels (Vue-style directives
 *   and native listeners), matched case-insensitively — the output is
 *   re-parsed as HTML whose parser normalizes attribute casing, so
 *   `oNload`/`OnClick` must not survive either.
 * - ALL `href` / `xlink:href` attributes: the diagrams are static (no
 *   bindFunctions, no click navigation), so links carry no value — and an
 *   attacker-controlled URL (even an http(s) one) could otherwise navigate
 *   the whole GUI away from the sidebar. Removing every href keeps the
 *   surface deterministic.
 *
 * Parsing happens with `image/svg+xml`, so a malformed SVG fails the XML
 * parse and the function returns '' (the caller surfaces the error
 * fallback) instead of ever passing the raw string through; only a document
 * whose root is an `<svg>` element is accepted.
 */
/** Element local names stripped case-insensitively (all lowercase). */
const STRIP_ELEMENTS = new Set([
  'foreignobject',
  'script',
  'img',
  'iframe',
  'object',
  'embed',
  'video',
  'audio',
  'input',
  'button',
  'form',
  'link',
  'meta',
  'base',
])

/** A parse failure keeps nothing of the input: the caller shows the error. */
export function sanitizeSvg(svg: string): string {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return ''
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  } catch {
    return ''
  }
  if (doc.querySelector('parsererror') !== null) return ''
  if (doc.documentElement === null || doc.documentElement.localName !== 'svg') return ''
  doc.querySelectorAll('*').forEach((node) => {
    // XML element names preserve case; the string is later re-parsed as HTML
    // whose parser normalizes tag casing — so mixed-case spellings of the
    // strip list (e.g. `<sCrIpT>`, `<foreignobject>`) must be caught the
    // same way as their canonical forms.
    if (STRIP_ELEMENTS.has(node.localName.toLowerCase())) {
      node.remove()
      return
    }
    for (const attribute of [...node.attributes]) {
      const name = attribute.name
      // XML attribute names preserve case; the string is later re-parsed as
      // HTML (dangerouslySetInnerHTML), whose parser normalizes attribute
      // casing — so a mixed-case `oNload`/`HREF` must be caught the same way
      // as its lowercase form. Compare on the lowercased name, remove with
      // the original.
      const normalized = name.toLowerCase()
      if (normalized.startsWith('@') || normalized.startsWith('on')) {
        node.removeAttribute(name)
        continue
      }
      if (normalized === 'href' || normalized === 'xlink:href') {
        node.removeAttribute(name)
      }
    }
  })
  return new XMLSerializer().serializeToString(doc.documentElement)
}
