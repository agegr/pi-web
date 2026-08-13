# Codex-style Skills and Plugins Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Skills and Plugins Settings as Codex-style desktop master-detail and mobile list-to-detail surfaces without changing backend contracts, storage, or Pi runtime semantics.

**Architecture:** Keep `SkillsConfig` and `PluginsConfig` as data/action owners. Add one narrow shared controller type, then implement separate pure navigation helpers and controlled navigator components so resource-specific identity and actions stay explicit. Integrate the active controller into `SettingsPage` and existing AppShell back handling.

**Tech Stack:** React 19, TypeScript, existing CSS tokens, native controls/dialogs, Node `--experimental-strip-types --test`, existing i18n registry.

---

## Protected Baseline

- Work on the current feature branch; do not develop directly on `main`.
- Preserve existing user changes and runtime artifacts. Do not delete `.output/` or `pi-web.log`.
- Do not modify `package.json`, `package-lock.json`, `app/api/skills/**`, `app/api/plugins/**`, `src/routes/api/skills/**`, `src/routes/api/plugins.ts`, `lib/skills-service.ts`, or `lib/api-types.ts`.
- Before editing, record `git status --short --branch`, `git log -1 --oneline`, and run the current focused Skills/Plugins/Settings tests. Any failure must be recorded and diagnosed as baseline before UI work.

### Task 1: Lock Baseline and Contracts

**Files:** tests only for inspection; no product edits.

- [ ] Run:

```bash
git status --short --branch
git log -1 --oneline
node --experimental-strip-types --test components/SkillsConfig.test.mjs components/PluginsConfig.test.mjs components/SettingsPage.test.mjs
```

Expected: current branch is reported, pre-existing `components/ChatWindow.process-details.test.mjs`/runtime artifacts remain untouched, and the available focused tests pass (or failures are recorded as baseline).

- [ ] Verify the existing request contracts by reading the route and call sites: Skills GET/PATCH/search/install/check/update; Plugins GET/POST actions install/remove/update/disable/enable; plugin reload uses `sendAgentCommand(sessionId, { type: "reload" })`.

### Task 2: Shared Controller and Skills Navigation

**Files:**
- Create `components/resource-settings/resource-settings-types.ts`.
- Create `components/resource-settings/skills-navigation.ts`.
- Create `components/resource-settings/skills-navigation.test.mjs`.

- [ ] Write failing tests for case-insensitive search, active/dormant grouping, `filePath` identity, parent retention for child matches, empty-query disclosure restoration, and selection fallback after refresh/deletion.
- [ ] Implement only the exported pure helpers required by the tests; never derive identity from filtered array position.
- [ ] Add `SettingsSectionController` with `handleBack(): boolean` and `mobileDetailOpen`.
- [ ] Run:

```bash
node --experimental-strip-types --test components/resource-settings/skills-navigation.test.mjs
```

Expected: all helper tests pass.
- [ ] Commit the isolated helper work with `git commit -m "test(settings): define skills navigation contracts"`.

### Task 3: Plugins Navigation

**Files:**
- Create `components/resource-settings/plugins-navigation.ts`.
- Create `components/resource-settings/plugins-navigation.test.mjs`.

- [ ] Write tests for project/global grouping, search retention, stable identity `${scope}\\0${source}`, selection fallback, and removal/refresh behavior.
- [ ] Implement the minimum pure filter/selection/label helpers and run the focused test.
- [ ] Commit with `git commit -m "test(settings): define plugins navigation contracts"`.

### Task 4: Controlled Navigator Components

**Files:**
- Create `components/resource-settings/SkillsNavigator.tsx` and `SkillsNavigator.test.mjs`.
- Create `components/resource-settings/PluginsNavigator.tsx` and `PluginsNavigator.test.mjs`.

- [ ] Add failing source-contract tests requiring labelled search, native button rows, clear-search control, group headings, selected state, busy/disabled state, and 44px interactive targets.
- [ ] Implement controlled navigators. They must receive rows, selection, query, mobile view, and callbacks; they must not fetch or mutate server state.
- [ ] Run both navigator test files and TypeScript check for the new components.
- [ ] Commit with `git commit -m "feat(settings): add skills and plugins navigators"`.

### Task 5: Convert SkillsConfig to Settings Master-Detail

**Files:** `components/SkillsConfig.tsx`, `components/SkillsConfig.test.mjs`.

- [ ] Add failing reducer/source tests for list/detail transitions, selection repair after refresh, null-selection list fallback, async action preservation, and trust restriction copy.
- [ ] Replace the embedded stacked shell with a Settings-only controlled layout using `SkillsNavigator` and a single detail pane. Preserve all existing fetch payloads and response handling.
- [ ] Keep install/search/check/update/toggle actions and active/dormant grouping. On action completion, refresh data and repair selection by `filePath`.
- [ ] Add `handleBack()` that consumes detail view on mobile before Settings closes.
- [ ] Run focused Skills tests and commit `git commit -m "feat(settings): make skills codex style"`.

### Task 6: Convert PluginsConfig to Settings Master-Detail

**Files:** `components/PluginsConfig.tsx`, `components/PluginsConfig.test.mjs`.

- [ ] Add failing tests for project/global rows, stable package selection, diagnostics, trust restriction, action busy/error states, and reload command dispatch.
- [ ] Replace the embedded stacked shell with `PluginsNavigator` plus one detail pane. Preserve exact POST action payloads and session reload after successful runtime changes.
- [ ] Repair selection after refresh/removal and return to mobile list when selected package disappears.
- [ ] Run focused Plugins tests and commit `git commit -m "feat(settings): make plugins codex style"`.

### Task 7: Settings Back and Exit Integration

**Files:** `components/SettingsPage.tsx`, `components/SettingsPage.test.mjs`, `components/AppShell.mobile-toolbar.test.mjs`.

- [ ] Add tests proving active Skills/Plugins controllers consume detail back before Settings closes, while picker/dialog layers keep priority.
- [ ] Register only the active section controller. Preserve Models controller behavior and existing close/category navigation.
- [ ] Ensure Escape, visible back, and Android/browser back use the priority: picker/dialog, resource detail, Settings.
- [ ] Run focused Settings/AppShell tests and commit `git commit -m "fix(settings): prioritize nested resource back navigation"`.

### Task 8: Shared CSS and i18n

**Files:** `app/globals.css`, `lib/i18n/messages/en.ts`, `lib/i18n/messages/zh-CN.ts`.

- [ ] Add Codex-style resource layout rules: 240px desktop navigator, compact 220px variant, independent detail scroll, mobile list/detail toggles, focus states, native dialog styling, and 44px controls.
- [ ] Add synchronized keys for navigator labels, search, empty/error/busy/success, scope, diagnostics, trust, and actions. Verify key parity with the repository’s i18n registry test.
- [ ] Run `git diff --check` and the i18n tests; commit `git commit -m "style(settings): align resource settings and copy"`.

### Task 9: Full Verification and Browser QA

**Files:** no new product files; screenshots/logs remain outside the repository or in the handoff.

- [ ] Run:

```bash
node --experimental-strip-types --test components/SkillsConfig.test.mjs components/PluginsConfig.test.mjs components/resource-settings/*.test.mjs components/SettingsPage.test.mjs components/AppShell.mobile-toolbar.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
npm test
```

- [ ] Start the dev server on an unused port and QA at `1440x900`, `390x844`, `320x568`.
- [ ] Verify search, install, update/check, toggle, remove, scope, diagnostics, trust restriction, plugin session reload, async error recovery, picker/dialog/back priority, and no mobile overflow.
- [ ] Record exact pass counts and any pre-existing environmental failures. Do not claim success without command output.

### Task 10: Write Evidence Handoff

**Files:** `docs/handoffs/2026-08-13-codex-skills-plugins-settings-phase3-handoff.md`.

- [ ] Rewrite the handoff with actual branch/commit, changed files, protected-path diff, focused/full test evidence, TypeScript/lint/diff results, browser URL and screenshots, known failures, deviations, and reviewer checklist.
- [ ] Confirm `git status --short` shows only intended product changes plus preserved user artifacts before requesting review.
- [ ] Commit the completed implementation and handoff only after user explicitly authorizes submission; this plan itself does not authorize merge or push.

