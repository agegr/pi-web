---
name: architecture
description: Load before ANY code change. Defines project structure (components/[Name]/* subdirectory template, 400-line file limit, lib/api separation, naming conventions, config-driven design). Auto-load when user asks to add/modify components, change business logic, refactor, or asks "where does this go?".
---

# Architecture

## Directory Layout

```
components/
  [Name]/                   # PascalCase, one directory per component
    index.ts                # ONLY public entry — re-exports
    [Name].tsx              # Main component (≤ 200 lines)
    [SubComponent].tsx      # Sub-component when [Name].tsx grows
    use[Name].ts            # State hook (optional)
    types.ts                # Local types (optional)
    README.md               # One-line purpose

app/api/[route]/route.ts    # API routes — ≤ 100 lines, parse → call lib → return JSON

lib/                        # Business logic only — no JSX
  rpc-manager.ts            # State machine core — human review required
  session-reader.ts         # Read-only .jsonl parsing
  types.ts                  # Global types
  normalize.ts              # Field name normalization
  store.ts                  # Global UI state

config/                     # ← Config-driven (changes live here, not in code)
  app.config.ts             # App-level config (theme, features, flags)
  ai.config.ts              # AI config (default model, tools, thinking level)

openspec/                   # Spec-driven dev (managed by openspec CLI)
.opencode/skills/           # This skill lives here
```

## Hard Rules

1. **Single file ≤ 400 lines.** Exceed → split into `components/[Name]/*` subdirectory.
2. **Main component file `[Name].tsx` ≤ 200 lines.** Bigger → extract sub-components.
3. **Files other than `index.ts` must NOT be imported from outside their directory.** External code only imports `from '@/components/[Name]'`.
4. **`lib/` has no JSX.** Logic only.
5. **`app/api/` routes ≤ 100 lines.** Business logic goes to `lib/`.
6. **No `any`.** Use `unknown` + type guard, or define a proper type.
7. **No `// @ts-ignore`.** Use `// @ts-expect-error <reason>` if unavoidable.
8. **No `React.FC`.** Write props as a plain type.

## Config-Driven Principle

**Things that change go in `config/`, not in code.**

```ts
// ❌ Hardcoded
const DEFAULT_MODEL = 'claude-sonnet'

// ✅ Config-driven
import appConfig from '@/config/app.config'
const defaultModel = appConfig.ai.defaultModel
```

Why: change config once → all components follow. No grep-replace across 10 files.

## Naming

| Type | Convention | Example |
|------|------------|---------|
| Component dir | PascalCase | `ModelsConfig/`, `SessionSidebar/` |
| Component file | PascalCase | `ModelsConfigModal.tsx` |
| Hook file | camelCase, `use` prefix | `useModelsConfig.ts` |
| Util / pure function | camelCase | `normalize.ts` |
| Constant | UPPER_SNAKE | `MAX_TOKENS` |
| CSS class | kebab-case | `.sidebar-container` |

## Large Files Needing Refactor (current)

When user asks about these, load `architecture` and propose a split:

- `components/ModelsConfig.tsx` (1639 lines) → `components/ModelsConfig/`
- `components/SessionSidebar.tsx` (1445 lines) → `components/SessionSidebar/`
- `components/FileViewer.tsx` (992 lines) → `components/FileViewer/`
- `components/ChatInput.tsx` (914 lines) → `components/ChatInput/`
- `components/SkillsConfig.tsx` (912 lines) → `components/SkillsConfig/`

## Cross-File Rule

- Single change ≤ 3 files. More → split into PRs.
- After every file change → run `npm run lint`.

## Don't

- Don't delete `.jsonl` files under `~/.pi/agent/sessions/`.
- Don't modify `lib/rpc-manager.ts` without explicit human ack.
- Don't change dependency versions in `package.json` without human ack.
- Don't `git push` — human does it.
- Don't write two themes of CSS — globals.css tokens auto-switch.