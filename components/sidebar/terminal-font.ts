/**
 * Terminal font resolution: the user's custom font prefs (SidebarPrefs,
 * configured under the terminal card's secondary settings) turned into the
 * xterm options. Kept as a pure module (no DOM, no xterm) so the fallback
 * chain and clamping are unit-testable without mounting a terminal.
 */
import { clampTerminalFontSize, type SidebarPrefs } from './prefs-shared'

/** The built-in fallback stack when neither the user nor the theme sets one. */
export const DEFAULT_TERMINAL_FONT_FAMILY = '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

/**
 * Icon fonts appended to whichever base stack wins, so shell prompts that
 * draw glyphs from the Nerd Font Private Use Areas resolve to a real glyph
 * instead of the missing-glyph box (aka tofu).
 *
 * Why this is needed even though the OS "should" fall back automatically:
 * prompt frameworks (starship, powerlevel10k, oh-my-posh) take their icons
 * from the PUA. Chromium's implicit system fallback reliably covers the
 * *BMP* PUA (U+E000–U+F8FF — e.g. the U+E0B0 powerline separator) but NOT
 * the *supplementary-plane* PUA-B (U+F0000+) where Nerd Fonts v3 relocated
 * the Material Design icon set. Naming the families explicitly makes the
 * browser consult them per character, which covers both planes.
 *
 * Deliberately NOT listed: color-emoji families. Chromium routes genuine
 * emoji code points through a dedicated emoji fallback path (which is why
 * emoji already render), so naming them buys nothing here — while placing a
 * color font ahead of the generic family risks capturing BMP symbols the
 * prompt expects in monospace (U+26A0 ⚠, U+2714 ✔ …) and rendering them as
 * wide color glyphs that break the cell grid.
 *
 * Ordering rationale: the symbols-only patches ship glyphs without Latin,
 * so they can never hijack ASCII metrics — the safest first hop. The
 * fully-patched distributions follow for users who installed one of those
 * instead. Both the `… Mono` and proportional family names are listed
 * because the Nerd Fonts installers register them as distinct families.
 *
 * These are strictly *appended*, never prepended: xterm derives its cell
 * metrics from the first entry, so the base font must stay in front or the
 * whole grid would be re-measured against an icon font.
 */
export const ICON_FONT_FALLBACKS: readonly string[] = [
  // Symbols-only patches (glyph coverage without Latin) — ideal fallbacks.
  '"Symbols Nerd Font Mono"',
  '"Symbols Nerd Font"',
  // Common fully-patched Nerd Font distributions.
  '"Hack Nerd Font Mono"',
  '"Hack Nerd Font"',
  '"JetBrainsMono Nerd Font Mono"',
  '"JetBrainsMono Nerd Font"',
  '"FiraCode Nerd Font Mono"',
  '"FiraCode Nerd Font"',
  '"CaskaydiaCove Nerd Font Mono"',
  '"CaskaydiaCove Nerd Font"',
  '"SauceCodePro Nerd Font Mono"',
  '"UbuntuMono Nerd Font Mono"',
  '"Iosevka Nerd Font Mono"',
  '"MesloLGS Nerd Font Mono"',
  '"MesloLGS NF"',
]

/** The symbols-only patch count at the head of {@link ICON_FONT_FALLBACKS}
 *  (these carry no Latin glyphs, so they can never hijack ASCII metrics). */
const SYMBOLS_ONLY_COUNT = 2

/**
 * CSS generic font families. A generic is a catch-all that always resolves,
 * so icon fonts must be spliced in *before* the first one to stay reachable.
 */
const GENERIC_FAMILIES = new Set([
  'monospace', 'serif', 'sans-serif', 'cursive', 'fantasy',
  'system-ui', 'ui-monospace', 'ui-serif', 'ui-sans-serif', 'ui-rounded',
  'math', 'emoji', 'fangsong',
])

/**
 * CSS-wide keywords. These are only valid as an *entire* declaration value,
 * so a stack cannot be appended to one.
 */
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer'])

/** Normalize one family name for comparison: unquote, collapse runs of
 *  whitespace, casefold. */
function normalizeFamily(family: string): string {
  return family
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Split a CSS font-family stack on its top-level commas.
 *
 * Naive `split(',')` would corrupt quoted family names containing a comma
 * and function values such as `var(--x, monospace)`, so quotes (with
 * backslash escapes) and parentheses are tracked.
 *
 * @param stack - a CSS font-family stack.
 * @returns the trimmed, non-empty family entries in source order.
 */
function splitFamilies(stack: string): string[] {
  const entries: string[] = []
  let buffer = ''
  let quote: string | null = null
  let depth = 0
  for (let i = 0; i < stack.length; i += 1) {
    const char = stack[i] as string
    if (quote !== null) {
      // Escapes are copied verbatim so `\"` does not close the quote.
      if (char === '\\' && i + 1 < stack.length) {
        buffer += char + (stack[i + 1] as string)
        i += 1
        continue
      }
      buffer += char
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      buffer += char
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (char === ',' && depth === 0) {
      entries.push(buffer)
      buffer = ''
      continue
    }
    buffer += char
  }
  entries.push(buffer)
  return entries.map(entry => entry.trim()).filter(entry => entry !== '')
}

/**
 * Append {@link ICON_FONT_FALLBACKS} to a CSS font-family stack, keeping
 * the caller's own entries and order intact.
 *
 * - Families already named in `stack` are not duplicated (quote-, case- and
 *   whitespace-insensitive), so a user who already lists their Nerd Font
 *   keeps their exact priority.
 * - The icon fonts are spliced in ahead of the *first* generic family
 *   (`monospace` etc.), because a generic always resolves: anything after it
 *   would never be consulted. A stack that OPENS with a generic is the one
 *   exception: only the symbols-only patches (no Latin) may precede it — a
 *   fully-patched Nerd Font there would become xterm's measuring base font
 *   and override the user/theme family precedence, so it is placed after the
 *   generic instead.
 * - Idempotent — re-applying to an already-topped-up stack is a no-op, which
 *   matters because `TerminalView` diffs the resolved value against the live
 *   `term.options.fontFamily` before reflowing.
 *
 * @param stack - a CSS font-family stack (base font first).
 * @returns the stack with icon fallbacks merged in.
 */
export function withIconFontFallbacks(stack: string): string {
  const entries = splitFamilies(stack)
  if (entries.length === 0) return ICON_FONT_FALLBACKS.join(', ')

  const present = new Set(entries.map(normalizeFamily))
  const notPresent = (family: string): boolean => !present.has(normalizeFamily(family))
  const symbolsOnly = ICON_FONT_FALLBACKS.slice(0, SYMBOLS_ONLY_COUNT).filter(notPresent)
  const patched = ICON_FONT_FALLBACKS.slice(SYMBOLS_ONLY_COUNT).filter(notPresent)
  if (symbolsOnly.length === 0 && patched.length === 0) return entries.join(', ')

  const firstGeneric = entries.findIndex(entry => GENERIC_FAMILIES.has(normalizeFamily(entry)))
  const cut = firstGeneric === -1 ? entries.length : firstGeneric
  // A fully-patched distribution ships Latin glyphs: placed ahead of a
  // LEADING generic (cut === 0) it would become xterm's measuring/base font
  // and override the user/theme family precedence. Only the symbols-only
  // patches — which carry no Latin — may precede it; the patched fonts go
  // after the generic (still reachable per character, never the base).
  if (cut === 0) {
    return [...symbolsOnly, entries[0]!, ...patched, ...entries.slice(1)].join(', ')
  }
  return [...entries.slice(0, cut), ...symbolsOnly, ...patched, ...entries.slice(cut)].join(', ')
}

/**
 * Reduce one link of the base-family chain to a usable stack, or `''` when
 * it cannot carry appended fallbacks so the next link should win.
 *
 * Rejecting CSS-wide keywords matters because the theme font arrives as a
 * raw token value (`tokenValue('--ds-font-family-code')`); skins do set
 * tokens to `initial`/`inherit`/`unset` (see `effectiveTokenValue` in
 * `theme.ts`, which guards the color tokens for the same reason). Appending
 * to such a value yields an invalid `font-family`, which the CSSOM discards
 * silently — the terminal would lose the theme font *and* the icon fonts.
 */
function usableBase(value: string | undefined): string {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') return ''
  if (CSS_WIDE_KEYWORDS.has(trimmed.toLowerCase())) return ''
  return trimmed
}

/**
 * Resolve the xterm font options for the given prefs.
 *
 * The base family keeps its existing precedence — user pref > theme code
 * font > built-in stack — and then {@link withIconFontFallbacks} tops it up
 * so prompt icons resolve regardless of which base won.
 *
 * @param prefs - the current side card preferences.
 * @param themeFontFamily - the app's theme code font (`--ds-font-family-code`
 *   token value, read live by the caller); undefined when the token is absent.
 * @returns the `fontFamily` / `fontSize` xterm options.
 */
export function resolveTerminalFont(
  prefs: SidebarPrefs,
  themeFontFamily: string | undefined,
): { fontFamily: string; fontSize: number } {
  const base = usableBase(prefs.terminalFontFamily)
    || usableBase(themeFontFamily)
    || DEFAULT_TERMINAL_FONT_FAMILY
  return {
    fontFamily: withIconFontFallbacks(base),
    fontSize: clampTerminalFontSize(prefs.terminalFontSize),
  }
}
