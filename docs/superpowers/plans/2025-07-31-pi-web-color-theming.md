# Pi Web Color Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-selectable color theme palette (Default / Sky / Lavender / Mint / Coral) on top of the existing light/dark mode, persisted in `localStorage`, and fully backward compatible.

**Architecture:** Extend the existing CSS custom-property theming in `app/globals.css` and the `useTheme` hook to track two independent dimensions: mode (`html.dark`) and color theme (`html[data-theme]`). Add a small hover palette component rendered next to the existing light/dark toggle in `AppShell`.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS v4, TypeScript, CSS custom properties, `localStorage`.

## Global Constraints

- Never run `next build` during local development (per repo `AGENTS.md`).
- Use `npm run dev` on port `30141` for manual testing.
- Typecheck command: `node_modules/.bin/tsc --noEmit`
- Lint command: `npm run lint`
- All `localStorage` writes must be wrapped in `try/catch` to handle private mode / quota.
- Existing light/dark toggle behavior and View Transition animation must be preserved.
- Existing `localStorage` key `"pi-theme"` must keep storing only `"light" | "dark"`.
- New files follow existing conventions under `components/` and `hooks/`.
- UI text must be translatable via `lib/i18n/messages/*.ts`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `app/globals.css` | Theme color variable definitions + palette hover styles |
| `app/layout.tsx` | Inline script sets initial `data-theme` before React hydration |
| `hooks/useTheme.ts` | Exposes `colorTheme`, `setColorTheme` alongside existing mode APIs |
| `hooks/useTheme.test.mjs` | Source-level unit tests for the new color theme helpers |
| `components/ColorThemePalette.tsx` | Hover palette with 5 color swatches |
| `components/AppShell.tsx` | Wraps existing theme toggle and renders `<ColorThemePalette />` |
| `lib/i18n/messages/en.ts` | English labels for theme names |
| `lib/i18n/messages/zh-CN.ts` | Chinese labels for theme names |

---

### Task 1: Add theme color CSS variables and palette styles

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Produces: CSS selectors `html[data-theme="sky"]:not(.dark)`, `html[data-theme="sky"].dark`, etc., plus `.theme-toggle-wrap`, `.color-theme-palette`, `.color-theme-swatch` component classes.

- [ ] **Step 1: Insert theme color definitions after `html.dark` block**

Add the following CSS immediately after the existing `html.dark { ... }` block and before the `::view-transition-old(root)` block:

```css
/* Theme color presets — each provides both light and dark variants.
   Default colors live in :root and html.dark; they are intentionally not
   repeated here so existing users are unaffected when no theme is set. */

html[data-theme="sky"]:not(.dark) {
  --bg: #f0f9ff;
  --bg-panel: #e0f2fe;
  --bg-hover: #bae6fd;
  --bg-selected: #7dd3fc;
  --border: #bae6fd;
  --text: #0c4a6e;
  --text-muted: #0369a1;
  --text-dim: #38bdf8;
  --accent: #0284c7;
  --accent-hover: #0369a1;
  --user-bg: #bae6fd;
  --assistant-bg: #ffffff;
  --tool-bg: #f1f5f9;
}
html[data-theme="sky"].dark {
  --bg: #0c4a6e;
  --bg-panel: #075985;
  --bg-hover: #0369a1;
  --bg-selected: #0ea5e9;
  --border: #0369a1;
  --text: #f0f9ff;
  --text-muted: #bae6fd;
  --text-dim: #7dd3fc;
  --accent: #7dd3fc;
  --accent-hover: #bae6fd;
  --user-bg: #0369a1;
  --assistant-bg: #0c4a6e;
  --tool-bg: #172554;
}

html[data-theme="lavender"]:not(.dark) {
  --bg: #faf5ff;
  --bg-panel: #f3e8ff;
  --bg-hover: #e9d5ff;
  --bg-selected: #d8b4fe;
  --border: #e9d5ff;
  --text: #2e1065;
  --text-muted: #6d28d9;
  --text-dim: #a78bfa;
  --accent: #7c3aed;
  --accent-hover: #6d28d9;
  --user-bg: #e9d5ff;
  --assistant-bg: #ffffff;
  --tool-bg: #f5f3ff;
}
html[data-theme="lavender"].dark {
  --bg: #2e1065;
  --bg-panel: #4c1d95;
  --bg-hover: #5b21b6;
  --bg-selected: #7c3aed;
  --border: #5b21b6;
  --text: #f5f3ff;
  --text-muted: #ddd6fe;
  --text-dim: #c4b5fd;
  --accent: #c4b5fd;
  --accent-hover: #ddd6fe;
  --user-bg: #5b21b6;
  --assistant-bg: #2e1065;
  --tool-bg: #312e81;
}

html[data-theme="mint"]:not(.dark) {
  --bg: #f0fdf4;
  --bg-panel: #dcfce7;
  --bg-hover: #bbf7d0;
  --bg-selected: #86efac;
  --border: #bbf7d0;
  --text: #064e3b;
  --text-muted: #047857;
  --text-dim: #34d399;
  --accent: #059669;
  --accent-hover: #047857;
  --user-bg: #bbf7d0;
  --assistant-bg: #ffffff;
  --tool-bg: #f1f5f9;
}
html[data-theme="mint"].dark {
  --bg: #064e3b;
  --bg-panel: #065f46;
  --bg-hover: #047857;
  --bg-selected: #10b981;
  --border: #047857;
  --text: #ecfdf5;
  --text-muted: #6ee7b7;
  --text-dim: #34d399;
  --accent: #6ee7b7;
  --accent-hover: #a7f3d0;
  --user-bg: #047857;
  --assistant-bg: #064e3b;
  --tool-bg: #14532d;
}

html[data-theme="coral"]:not(.dark) {
  --bg: #fff5f5;
  --bg-panel: #ffe4e6;
  --bg-hover: #fecdd3;
  --bg-selected: #fda4af;
  --border: #fecdd3;
  --text: #881337;
  --text-muted: #be123c;
  --text-dim: #fb7185;
  --accent: #e11d48;
  --accent-hover: #be123c;
  --user-bg: #fecdd3;
  --assistant-bg: #ffffff;
  --tool-bg: #f8fafc;
}
html[data-theme="coral"].dark {
  --bg: #7f1d1d;
  --bg-panel: #991b1b;
  --bg-hover: #b91c1c;
  --bg-selected: #dc2626;
  --border: #b91c1c;
  --text: #fff1f2;
  --text-muted: #fecdd3;
  --text-dim: #fda4af;
  --accent: #ff8fa3;
  --accent-hover: #ffb3c1;
  --user-bg: #b91c1c;
  --assistant-bg: #7f1d1d;
  --tool-bg: #450a0f;
}
```

- [ ] **Step 2: Add palette hover styles after the theme color blocks**

In the same file, append the following component styles after the theme color definitions:

```css
/* Color theme palette — rendered next to the light/dark toggle. */
.theme-toggle-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding-bottom: 8px;
  margin-bottom: -8px;
}

.color-theme-palette {
  position: absolute;
  top: 100%;
  right: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin-top: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 100;
  min-width: 160px;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(-4px);
  transition: opacity 0.1s ease, transform 0.1s ease, visibility 0s linear 0.3s;
}
.theme-toggle-wrap:hover .color-theme-palette,
.theme-toggle-wrap:has(.color-theme-palette:hover) .color-theme-palette,
.color-theme-palette:hover {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translateY(0);
  transition-delay: 0s;
}

.color-theme-swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  transition: transform 0.12s ease;
  padding: 0;
}
.color-theme-swatch:hover {
  transform: scale(1.15);
}
.color-theme-swatch.is-active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 3px var(--accent);
}

.color-theme-swatch.swatch-default {
  background: linear-gradient(135deg, #4b5563 50%, #f9fafb 50%);
  border: 1px solid rgba(0, 0, 0, 0.16);
  box-shadow: none;
}
.color-theme-swatch.swatch-sky { background: #0ea5e9; }
.color-theme-swatch.swatch-lavender { background: #8b5cf6; }
.color-theme-swatch.swatch-mint { background: #10b981; }
.color-theme-swatch.swatch-coral { background: #f43f5e; }

.color-theme-palette-label {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  margin-right: 4px;
}
```

- [ ] **Step 3: Manual test**

Run:

```bash
npm run dev
```

Open DevTools → Elements → `<html>`. Manually add `data-theme="sky"` to `<html>` and toggle `class="dark"`. Verify computed CSS variables (`--bg`, `--accent`, `--user-bg`, etc.) match the values above.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "feat(themes): add sky/lavender/mint/coral color presets and palette styles"
```

---

### Task 2: Pre-set selected theme before React hydration

**Files:**
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `localStorage.getItem("pi-color-theme")`.
- Produces: `data-theme` attribute on `<html>` before first paint.

- [ ] **Step 1: Replace the inline initialization script**

Find the existing `<script dangerouslySetInnerHTML={{ __html: ... }} />` in `app/layout.tsx` and replace its `__html` string with:

```tsx
<script
  dangerouslySetInnerHTML={{
    __html: `(function(){try{var t=localStorage.getItem("pi-theme");if(t==="dark")document.documentElement.classList.add("dark");var c=localStorage.getItem("pi-color-theme");if(c&&c!=="default")document.documentElement.setAttribute("data-theme",c);}catch(e){}})();`,
  }}
/>
```

Keep `suppressHydrationWarning` on the `<html>` element unchanged.

- [ ] **Step 2: Manual test**

1. Open DevTools → Application → Local Storage → `http://127.0.0.1:30141`.
2. Set `pi-color-theme` to `"sky"`.
3. Hard-refresh the page (`Ctrl+F5` / `Cmd+Shift+R`).
4. In DevTools → Elements, confirm `<html data-theme="sky">` is present **before** the page finishes rendering (pause with `debugger` in the console or use a throttled CPU if needed).
5. Delete `pi-color-theme` and refresh; confirm `data-theme` is absent (Default theme).

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(themes): read initial color theme from localStorage before hydration"
```

---

### Task 3: Extend useTheme hook with color theme API

**Files:**
- Modify: `hooks/useTheme.ts`
- Create: `hooks/useTheme.test.mjs`

**Interfaces:**
- Consumes: `document.documentElement.getAttribute("data-theme")`, `localStorage`.
- Produces: `colorTheme: ColorTheme`, `setColorTheme(next: ColorTheme): void`, exported `ColorTheme` type.

- [ ] **Step 1: Write the failing test**

Create `hooks/useTheme.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useTheme.ts", import.meta.url), "utf8");

test("exports color theme type and helpers", () => {
  assert.match(source, /export type ColorTheme/);
  assert.match(source, /const COLOR_THEMES/);
  assert.match(source, /function getColorThemeSnapshot/);
  assert.match(source, /const setColorTheme = useCallback/);
  assert.match(source, /colorTheme, setColorTheme/);
});

test("setColorTheme sets DOM attribute and persists to localStorage", () => {
  const snippet = source.slice(
    source.indexOf("const setColorTheme = useCallback"),
    source.indexOf("listeners.forEach((cb) => cb())") + "listeners.forEach((cb) => cb())".length,
  );
  assert.match(snippet, /setAttribute\("data-theme", next\)/);
  assert.match(snippet, /localStorage\.setItem\("pi-color-theme", next\)/);
  assert.match(snippet, /listeners\.forEach\(\(cb\) => cb\(\)\)/);
});

test("getColorThemeSnapshot falls back to default for unknown values", () => {
  assert.match(source, /return "default";/);
  assert.match(source, /COLOR_THEMES\.includes\(attr\)/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test hooks/useTheme.test.mjs
```

Expected: FAIL (functions/types not yet defined).

- [ ] **Step 3: Implement the hook changes**

Modify `hooks/useTheme.ts`:

1. Add the color theme type and constants right after `type Theme = "light" | "dark";`:

```ts
export type ColorTheme = "default" | "sky" | "lavender" | "mint" | "coral";
const COLOR_THEMES: ColorTheme[] = ["default", "sky", "lavender", "mint", "coral"];
```

2. Add snapshot helpers after `getServerSnapshot`:

```ts
function getColorThemeSnapshot(): ColorTheme {
  if (typeof document === "undefined") return "default";
  const attr = document.documentElement.getAttribute("data-theme") as ColorTheme | null;
  if (attr && COLOR_THEMES.includes(attr)) return attr;
  return "default";
}

function getColorThemeServerSnapshot(): ColorTheme {
  return "default";
}
```

3. Update `useTheme()` body:

```ts
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const colorTheme = useSyncExternalStore(subscribe, getColorThemeSnapshot, getColorThemeServerSnapshot);

  const toggleTheme = useCallback((origin?: ToggleOrigin) => {
    // ... existing toggleTheme body unchanged ...
  }, []);

  const setColorTheme = useCallback((next: ColorTheme) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("pi-color-theme", next);
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
    listeners.forEach((cb) => cb());
  }, []);

  return { theme, toggleTheme, isDark: theme === "dark", colorTheme, setColorTheme };
}
```

Make sure the existing `toggleTheme` function body is not changed.

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test hooks/useTheme.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add hooks/useTheme.ts hooks/useTheme.test.mjs
git commit -m "feat(themes): add colorTheme and setColorTheme to useTheme hook"
```

---

### Task 4: Create ColorThemePalette component

**Files:**
- Create: `components/ColorThemePalette.tsx`

**Interfaces:**
- Consumes: `useTheme().colorTheme`, `useTheme().setColorTheme`, `useI18n().t`.
- Produces: `<ColorThemePalette />` React component.

- [ ] **Step 1: Implement the component**

Create `components/ColorThemePalette.tsx`:

```tsx
"use client";

import { useTheme, type ColorTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";

const THEMES: { id: ColorTheme; swatchClass: string }[] = [
  { id: "default", swatchClass: "swatch-default" },
  { id: "sky", swatchClass: "swatch-sky" },
  { id: "lavender", swatchClass: "swatch-lavender" },
  { id: "mint", swatchClass: "swatch-mint" },
  { id: "coral", swatchClass: "swatch-coral" },
];

export function ColorThemePalette() {
  const { colorTheme, setColorTheme } = useTheme();
  const { t: translate } = useI18n();

  return (
    <div className="color-theme-palette" role="group" aria-label={translate("theme.appearance")}>
      <span className="color-theme-palette-label">{translate("theme.appearance")}</span>
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          className={`color-theme-swatch ${theme.swatchClass}${colorTheme === theme.id ? " is-active" : ""}`}
          aria-label={translate(`theme.${theme.id}`)}
          title={translate(`theme.${theme.id}`)}
          aria-pressed={colorTheme === theme.id}
          onClick={() => setColorTheme(theme.id)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual test**

Temporarily render `<ColorThemePalette />` somewhere in `AppShell` (e.g., inside the header) to confirm the palette appears and swatches are clickable. This will be properly positioned in Task 5.

- [ ] **Step 4: Commit**

```bash
git add components/ColorThemePalette.tsx
git commit -m "feat(themes): add ColorThemePalette component"
```

---

### Task 5: Integrate palette into AppShell

**Files:**
- Modify: `components/AppShell.tsx`

**Interfaces:**
- Consumes: `<ColorThemePalette />`.
- Produces: Wrapped theme toggle with hover palette.

- [ ] **Step 1: Import the palette component**

Add the import near the top of `components/AppShell.tsx`:

```ts
import { ColorThemePalette } from "./ColorThemePalette";
```

- [ ] **Step 2: Wrap the existing light/dark toggle button**

Find the existing theme toggle `<button>` (around line 846) and wrap it in a `div.theme-toggle-wrap`. The button itself and its `onClick` must stay exactly the same.

Before:

```tsx
          <button
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
            }}
            title={isDark ? translate("theme.light") : translate("theme.dark")}
            aria-label={isDark ? translate("theme.light") : translate("theme.dark")}
            aria-pressed={isDark}
            style={{ ... }}
          >
            ...
          </button>
```

After:

```tsx
          <div className="theme-toggle-wrap">
            <button
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
              }}
              title={isDark ? translate("theme.light") : translate("theme.dark")}
              aria-label={isDark ? translate("theme.light") : translate("theme.dark")}
              aria-pressed={isDark}
              style={{ ... }}
            >
              ...
            </button>
            <ColorThemePalette />
          </div>
```

Do not change the button's `style`, `title`, `aria-label`, `aria-pressed`, or icon content.

- [ ] **Step 3: Manual test**

1. Run `npm run dev`.
2. Hover the light/dark toggle button in the top-right of the app.
3. Confirm the palette appears below the button.
4. Move the mouse slowly from the button down into the palette. Confirm the palette stays open long enough to click a swatch.
5. Click a color swatch; confirm the entire app re-themes.
6. Click the sun/moon icon; confirm light/dark mode still toggles with the circular wipe transition.

- [ ] **Step 4: Commit**

```bash
git add components/AppShell.tsx
git commit -m "feat(themes): render ColorThemePalette next to light/dark toggle"
```

---

### Task 6: Add theme name translations

**Files:**
- Modify: `lib/i18n/messages/en.ts`
- Modify: `lib/i18n/messages/zh-CN.ts`

**Interfaces:**
- Produces: New i18n keys for theme labels.

- [ ] **Step 1: Add English labels**

In `lib/i18n/messages/en.ts`, add to the `messages` object near the existing `"theme.light"` / `"theme.dark"` entries:

```ts
"theme.appearance": "Theme",
"theme.default": "Default",
"theme.sky": "Sky",
"theme.lavender": "Lavender",
"theme.mint": "Mint",
"theme.coral": "Coral",
```

- [ ] **Step 2: Add Chinese labels**

In `lib/i18n/messages/zh-CN.ts`, add the same keys:

```ts
"theme.appearance": "主题",
"theme.default": "默认",
"theme.sky": "天蓝",
"theme.lavender": "浅紫",
"theme.mint": "薄荷",
"theme.coral": "珊瑚",
```

- [ ] **Step 3: Typecheck**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manual test**

Hover the palette and confirm tooltips show localized names. Switch the app language (existing language menu) and confirm the labels update.

- [ ] **Step 5: Commit**

```bash
git add lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts
git commit -m "feat(themes): add i18n labels for color themes"
```

---

### Task 7: Lint and typecheck

**Files:**
- None (project-wide validation).

**Interfaces:**
- Consumes: All modified files.

- [ ] **Step 1: Run typecheck**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: no errors. Fix any reported issues (e.g., unused imports, formatting).

- [ ] **Step 3: Run unit tests**

```bash
node --test hooks/useTheme.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit fixes**

If any lint/type fixes were required:

```bash
git add -A
git commit -m "chore(themes): lint and type fixes"
```

---

### Task 8: Final manual QA and PR preparation

**Files:**
- None (verification and documentation).

- [ ] **Step 1: Verify matrix of all theme × mode combinations**

Open the app and cycle through every combination:

| Mode \ Theme | Default | Sky | Lavender | Mint | Coral |
|--------------|---------|-----|----------|------|-------|
| Light | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dark | ✅ | ✅ | ✅ | ✅ | ✅ |

For each cell confirm:

1. Main background, panel background, and borders are visible.
2. Primary button text is readable.
3. Secondary button text (`var(--text-muted)`) is readable.
4. Chat bubbles (`--user-bg`, `--assistant-bg`) contrast clearly with main background.
5. Links (`var(--accent)`) are visible.
6. Code blocks (`--tool-bg`, `--bg`, `--border`) are readable.

- [ ] **Step 2: Verify persistence and no flash**

1. Select Sky theme in light mode.
2. Hard-refresh (`Ctrl+F5` / `Cmd+Shift+R`). Confirm Sky light appears immediately without a color flash.
3. Switch to Coral dark.
4. Hard-refresh. Confirm Coral dark appears immediately.
5. Clear `localStorage` for the origin and refresh. Confirm Default light/dark behavior is unchanged.

- [ ] **Step 3: Verify backward compatibility**

1. Manually set `localStorage.setItem("pi-theme", "dark")` (no `pi-color-theme`).
2. Refresh. Confirm the app is in Default Dark and the palette shows Default as active.
3. Confirm existing theme toggle still works.

- [ ] **Step 4: Capture screenshots/GIF for PR**

Capture:

1. Default light and dark (baseline).
2. Sky light and dark.
3. Lavender light and dark.
4. Mint light and dark.
5. Coral light and dark.
6. Hover state showing the palette.

- [ ] **Step 5: Clean up brainstorming artifacts**

If they still exist in the working tree, remove and ignore:

```bash
rm -rf .superpowers/ theme-palette-mockup.html
echo -e "# brainstorming mockups\n.superpowers/\ntheme-palette-mockup.html" >> .gitignore
git add .gitignore
git commit -m "chore: ignore brainstorming mockups"
```

- [ ] **Step 6: Prepare final PR**

Push the branch to your fork and open a PR against `agegr/pi-web/main` with:

- Title: `feat: add color theme palette with Sky/Lavender/Mint/Coral presets`
- Description:
  - Motivation: users want personalization beyond light/dark.
  - What changed: extended CSS variables, `useTheme` hook, new `ColorThemePalette` component, i18n labels.
  - Backward compatibility: existing `pi-theme` unchanged; no theme selected = Default.
  - Testing: unit test for `useTheme`, manual QA matrix, screenshots attached.

---

## Self-Review

- **Spec coverage**: every section of `docs/superpowers/specs/2025-07-31-pi-web-color-theming-design.md` maps to a task.
- **Placeholder scan**: no TBD/TODO/fill-in-details; every code block is complete.
- **Type consistency**: `ColorTheme` type is exported from `hooks/useTheme.ts` and imported by `components/ColorThemePalette.tsx`; `setColorTheme` signature matches across hook and component.
- **File size**: `ColorThemePalette` is a focused single-responsibility component; CSS additions are grouped with existing theme code.

---

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2025-07-31-pi-web-color-theming.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach would you like?