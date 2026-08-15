# Typography and Readability Design

## Status

Locked for implementation. This is step B only: type tokens, size floor, and secondary-text contrast. Spacing, density, and interaction feedback are a later optional step.

## Objective

Make Pi Web easier to read without changing its Codex-dense layout or shipping a new UI font. Replace scattered `px` type with a small semantic token set, lift chrome below 12px, set chat body to 15px, and split `--text-muted` / `--text-dim` so helper copy is actually readable.

## Context

Pi Web is a local product UI (`PRODUCT.md`: quiet, precise, familiar; Codex desktop is the visual reference). Today:

- UI face is the system stack (`-apple-system`, `Segoe UI`, `Roboto`). CJK falls through to PingFang / YaHei on the OS, but the stack does not name them.
- Code face is already `@fontsource-variable/noto-sans-mono` via `--font-mono`.
- `html, body` are `font-size: 14px`. Almost every other size in `app/globals.css` is a raw `px` value. Many chrome strings are 9–11px.
- Light `--text-muted` and `--text-dim` are the same color (`#6b7280`). Small type on `--bg-panel` is the main readability failure.

Users chose: step B now (type + readability), moderate scale, keep current faces, deepen and split gray text. Step C (spacing / density / interaction) is deferred.

## Goals

- One semantic type ramp in `app/globals.css` (`:root`), consumed by product UI.
- Root font size `16px` so `rem` tokens match the agreed pixel sizes. Existing `px` padding / gap / heights stay as-is.
- Chat / markdown body at 15px. Sidebar and settings chrome at 13px. Nothing in product UI below 12px, except the existing iOS input exception.
- `--text-muted` is readable helper copy. `--text-dim` is only for true tertiary metadata (timestamps, counts).
- Light and dark both use the split. Body `--text` does not change.
- English / Chinese keep using the system UI stack. No new font package.

## Non-goals

- Do not add a UI webfont (Inter, Geist, CJK families, etc.).
- Do not restyle padding, gap, radius, shadow, or motion. That is step 2.
- Do not change Agent, session, SSE, or API behavior.
- Do not rewrite exported session HTML or third-party highlight CSS.
- Do not introduce a 65ch reading column in this slice (not approved).
- Do not treat a slightly fuller sidebar as a bug. Larger type is the point.

## Approaches considered

1. **Patch raw `px` in place.** Fast, drifts immediately, easy to miss dark mode.
2. **Semantic tokens, then replace by role (chosen).** One source of truth; step 2 can add spacing tokens later without revisiting type.
3. **Extract a full design system / DESIGN.md / Tailwind theme rewrite.** Too large; pulls spacing and components into this slice.

## Token architecture

Define tokens on `:root`. Dark mode (`html.dark`) overrides only color tokens.

### Faces

| Token | Value |
|---|---|
| `--font-ui` | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif` |
| `--font-mono` | keep the existing Noto Sans Mono stack |

`html, body` use `--font-ui`. `pre, code` keep `--font-mono`.

### Sizes

Root: `html, body { font-size: 16px; }`. All type tokens are `rem`.

| Role | Token | Size | Use |
|---|---|---|---|
| Chat body | `--text-chat` | `0.9375rem` (15px) | User / assistant messages, `.markdown-body` prose |
| UI chrome | `--text-ui` | `0.8125rem` (13px) | Sidebar rows, settings fields, buttons, inputs |
| Title | `--text-title` | `0.875rem` (14px) | Settings / dialog titles, empty-state headings |
| Meta | `--text-meta` | `0.75rem` (12px) | Timestamps, helper copy, role labels, section labels |

`--text-meta` is the floor. Product UI must not use a computed font-size below 12px.

### Leading

| Token | Value | Use |
|---|---|---|
| `--leading-prose` | `1.55` | Chat, markdown, dialog body copy |
| `--leading-ui` | `1.35` | Sidebar rows, controls, compact chrome |
| `--leading-title` | `1.25` | Titles |

### Weight

| Token | Value | Use |
|---|---|---|
| `--weight-regular` | `400` | Body and most chrome |
| `--weight-medium` | `600` | Labels, selected rows, buttons |
| `--weight-semibold` | `650` | Titles |

Do not keep one-off weights (580 / 620 / 630) on product type.

### Color

Light (change muted / dim only):

| Token | Value | Role |
|---|---|---|
| `--text` | `#1a1a1a` | unchanged body ink |
| `--text-muted` | `#4b5563` | helper copy, role labels, secondary sentences |
| `--text-dim` | `#6b7280` | timestamps, counts, truly tertiary meta |

Dark:

| Token | Value |
|---|---|
| `--text` | `#e8e8e8` (unchanged) |
| `--text-muted` | `#d1d5db` |
| `--text-dim` | `#9ca3af` |

`--text-muted` must meet ≥ 4.5:1 against `--bg` and `--bg-panel` in both themes. `--text-dim` is allowed to be weaker because it is not body text; do not use it for sentences the user must read to act.

## Surfaces

Replace raw type properties with tokens. Do not retune box model properties unless a line of text is clipped after the size lift; then change only that rule's `min-height`.

**In scope**

- `app/globals.css`: sidebar, chat, markdown, composer, settings, dialogs, quick switcher, file preview, trajectory, desktop context, empty states, and any other product type in that file.
- `components/ChatMinimap.module.css`.
- Hard-coded `font-size` / `font-weight` / `line-height` in product components that bypass the stylesheet.

**Role mapping**

- Chat bubbles and `.markdown-body` → `--text-chat` + `--leading-prose`.
- Markdown headings and inline code stay `em` so they track `--text-chat`. Do not add a second heading scale.
- Sidebar rows, settings controls, dialog buttons / inputs → `--text-ui` + `--leading-ui`.
- Dialog / settings headings → `--text-title` + `--leading-title` + `--weight-semibold`.
- Timestamps, search meta, plan counts → `--text-meta` + `--text-dim`.
- Helper sentences (errors, hints, “save first”) → `--text-meta` + `--text-muted`.

**Exceptions (keep)**

- iOS / narrow-viewport inputs that are already `16px` to prevent Safari focus zoom. Do not shrink them to `--text-ui`.
- Icon glyph sizes (for example 20px empty-state icons).
- Exported HTML from the Pi SDK, `.output`, and highlight.js themes.

**Out of scope**

- padding, gap, radius, shadow, motion.
- New npm or font dependencies.
- Agent / session / API code.

## Implementation constraints

- No new runtime dependencies.
- Do not run `npm run build` or `npm run pack:tanstack` during this work.
- Dual Next / TanStack surfaces share `app/globals.css`; there is no second type sheet to invent.
- Do not edit `PRODUCT.md` for this slice. Personality stays Codex-dense; only type tokens change.

## Testing and verification

No new Agent or API tests. Add a focused static check (Node test next to other CSS / UI tests) that reads `app/globals.css` and `components/ChatMinimap.module.css` and fails if a product `font-size` is `9px`, `10px`, `11px`, `9.5px`, or `10.5px`. Allowlist only the iOS `16px` input rules if the scanner would otherwise flag unrelated values. Token definitions themselves are not violations.

Also:

- `node_modules/.bin/tsc --noEmit`
- `npm test`
- ESLint on touched files
- `git diff --check`

Manual after implementation, light and dark:

- Sidebar session list
- Long chat with markdown and inline code
- Settings, including 视觉工具
- A Codex dialog
- Trajectory / context chrome
- Browser zoom 200%

Pass: no product chrome below 12px, helper copy readable, system UI + Noto Mono unchanged, no clipped glyphs that were not fixed with a local `min-height`.

Fail does **not** include “the sidebar shows fewer rows.” That is expected.

## Deferred (step 2, not this spec)

Spacing rhythm, control density, hover / focus / pressed consistency. Do not start that work in the type PR.
