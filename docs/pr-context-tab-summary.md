# Settings › Context tab — durable summary

## Deliverable

- **Branch**: `feat/settings-context-tab` (based on `origin/chore/sync-upstream-4`)
- **PR**: https://github.com/dreadster3/pi-web/pull/21 — base `chore/sync-upstream-4`, **stacked on #20**; retarget to `main` once #20 merges. Nothing merged.
- **Commits**: 2 (`feat(settings):` + `chore(demo):`)

## How each of the 7 entries is exposed

Every entry is one card: resolved absolute path (display-shortened + full), what Pi does with it,
its precedence state, size, and a monospace editor with Save/Create, Revert and (where applicable)
Delete. Helper text under each card states the discovery rule. The sidebar groups them as
"Global (agent directory)" and "Project", each with an `n/m` created count. The tab needs **no
project**: entries 1/3/5 stay editable, entries 2/4/6/7 are listed disabled with
"Open a project to edit this file."

| # | Entry | Resolved path | Precedence surfaced |
|---|-------|---------------|---------------------|
| 1 | AGENTS.md global | `<agent-dir>/<discovered>` | — (agent dir loads first) |
| 2 | AGENTS.md local | `<cwd>/<discovered>` | Replaced by entry 7 in the same directory |
| 3 | SYSTEM.md global | `<agent-dir>/SYSTEM.md` | Replaced by entry 4: "Pi loads … instead: files of the same name are not combined." |
| 4 | SYSTEM.md local | `<cwd>/.pi/SYSTEM.md` | Takes precedence |
| 5 | APPEND_SYSTEM.md global | `<agent-dir>/APPEND_SYSTEM.md` | Replaced by entry 6 (same wording) |
| 6 | APPEND_SYSTEM.md local | `<cwd>/.pi/APPEND_SYSTEM.md` | Takes precedence |
| 7 | AGENTS.override.md local | `<cwd>/AGENTS.override.md` | Replaces entry 2/CLAUDE.md in the same directory only; the only **deletable** entry |

`<discovered>` is whichever of `AGENTS.override.md` → `AGENTS.md` → `AGENTS.MD` → `CLAUDE.md` →
`CLAUDE.MD` is a regular file in that directory (SDK order). The card is titled with the file Pi
actually finds, which is how "look for CLAUDE.md as well" is surfaced.

## Design decisions

- **Entry id, never a path.** `GET`/`PUT /api/context` take `{ id, ... }`; the route resolves the
  file from `getAgentDir()` (honours `PI_CODING_AGENT_DIR`) and the validated `cwd`, so no request
  can name a file Pi does not read. Traversal is structurally impossible, not filtered.
- **Path safety beyond the cwd check.** A project entry whose resolved path (or its nearest existing
  ancestor, for a file that does not exist yet) leaves the allowed roots is refused 403
  `link-outside`; a directory / link-to-nothing is 409 `not-a-file` and listed with its problem.
  The agent directory's own files are the user's, followed wherever they lead — as the global
  `mcp.json` is.
- **No trust lookup.** Context files are discovered without project trust (per the docs), so
  `lib/context-files.ts` never reads `trust.json`. SYSTEM.md / APPEND_SYSTEM.md precedence *is*
  reported, but as a fact about files on disk, not a permission.
- **Precedence computed server-side** (`effective` / `shadowedBy`) and rendered; the panel never
  re-derives Pi's rules. `shadowedBy` is only set when both files exist — a missing file is not
  "replaced".
- **Only the override is deletable** (409 `invalid-request` otherwise). It exists solely to replace
  its siblings, so deleting is equivalent to emptying it; for AGENTS.md/PI's other files, deleting
  would silently discard user content that Delete is not there to manage.
- **Reads/writes capped at 256 KiB**, read via a single bounded `readSync` from an `openSync` handle
  with an `fstat`-free `statSync` check, so no oversized or special file is slurped.
- **No lock / no atomic rename** (unlike `lib/mcp-config-file.ts`): these are markdown instruction
  files the user's own editor also writes, and pi itself rewrites; a lock would put Pi Web at odds
  with that. Marked in the module doc.
- **Reuses the sync's Settings patterns**: `ConfigPanelShell`/`ConfigSplitView`/`ConfigSidebar`/
  `ConfigDetail*` from `SettingsUi.tsx`, `settingsSectionRequiresProject()` as the single place
  deciding project need, the mobile section picker + tab list from the same `sections` array,
  `getLastSettingsSelection`/`setLastSettingsSelection` for the row, and the MCP routes'
  `{ error, reason, path }` refusal shape.
- **Request deadline** aborts the fetch *and* settles the promise: a `fetch` that ignores its signal
  cannot leave the panel on "Loading…" for good. The caller's signal is forwarded by hand
  (`AbortSignal.any` needs Safari 17.4; this is browser code).
- **Per-entry drafts**: switching cards never discards typing; a successful save clears only its own.
- i18n: 45 new keys, identical key/placeholder sets in `en`, `zh-CN`, `zh-TW`
  (`lib/i18n/registry.test.mjs` enforces this).

## Files added / changed

**Root (commit `aed7463`)**
- Added: `lib/context-files.ts`, `app/api/context/route.ts`, `app/api/context/route.test.mjs`,
  `components/ContextConfig.tsx`, `components/context-config-helpers.ts`,
  `components/ContextConfig.test.mjs`
- Changed: `components/SettingsPanel.tsx` (section + icon + mount), `lib/settings-navigation.ts`
  (`"context"` in `SETTINGS_SECTION_VALUES`), `lib/api-types.ts` (`ContextScope`, `ContextFileId`,
  `ContextFileProblem`/`ContextPathProblem`, `ContextFileInfo`, `ContextResponse`,
  `ContextWriteTarget`), `app/settings.css` (`.context-*`), `lib/i18n/messages/{en,zh-CN,zh-TW}.ts`

**Demo mirror (commit `d6b7d9f`)**
- Added: `demo/components/ContextConfig.tsx`, `demo/components/context-config-helpers.ts`,
  `demo/mock/data/context.ts`
- Changed: `demo/components/SettingsPanel.tsx`, `demo/components/SettingsUi.tsx` (gains
  `ConfigNotice`, `ConfigDetailGrid`, `ConfigDetailGridRow`, `ConfigScopeTag`),
  `demo/lib/settings-navigation.ts`, `demo/lib/api-types.ts`, `demo/app/settings.css`,
  `demo/lib/i18n/messages/{en,zh-CN,zh-TW}.ts`, `demo/mock/settings-routes.ts`, `demo/README.md`

## Validation

Gate (as briefed): `npx tsc --noEmit`, `npm run lint`, `env -u PI_WEB_IDLE_TIMEOUT_MS npm test`,
each wrapped in `timeout`.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, 0 errors |
| `npm run lint` | clean, "No issues found" |
| `npm test` (branch) | 2269 tests / 2173 pass / **96 fail** |
| `npm test` (pristine `origin/chore/sync-upstream-4`) | 2244 tests / 2148 pass / **96 fail** — identical failure set |
| `npm test` with `PI_PACKAGE_DIR` + subagent package-root overrides also unset | base 46 fail, branch 46 fail — identical |
| `components/SettingsPanel.test.mjs`, `lib/settings-navigation.test.mjs` | 25/25 pass |
| `app/api/context/route.test.mjs` | 12/12 pass |
| `components/ContextConfig.test.mjs` | 13/13 pass |
| demo `tsc --noEmit` | clean |
| demo eslint | clean |
| demo `next build` | **fails identically on the pristine base** (Turbopack `leaves the filesystem root`; worktree layout with a linked dependency folder). Gate not exercisable in this worktree. |

Delta from base: **+25 tests, +25 passes, +0 failures.** My change broke nothing.

**Pre-existing failures, not fixed and not skipped (identical upstream):** the stack-depth cases in
`lib/mcp-config-read.test.mjs`, `lib/mcp-config-key.test.mjs`, `lib/mcp-host.test.mjs` (pass with
`--stack-size=8000`), `lib/skill-lock.test.mjs`'s XDG/HOME case, and the MCP suite's
`PI_PACKAGE_DIR`-dependent tests.

## Open items / risks

- The demo build gate could not run here (pre-existing host/worktree layout issue). CI's
  `demo-pages.yml` builds it on `main` push.
- `demo/next build` also writes `demo/public/demo-files/` (gitignored) and a `tsconfig.tsbuildinfo`
  (gitignored); both were left untracked.
- PR #21 must be retargeted from `chore/sync-upstream-4` to `main` after #20 merges.
