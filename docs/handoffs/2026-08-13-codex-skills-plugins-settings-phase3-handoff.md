# Codex-style Skills and Plugins Settings Phase 3 Handoff

## Handoff Type

Implementation evidence report. Skills/Plugins master-detail is implemented; Settings back wiring, CSS, and i18n for this phase are in the working tree (not yet committed, pending user authorization).

## Repository Snapshot

- Repository: `/Users/kale/pi-web`
- Branch: `feat/codex-quick-switcher`
- HEAD: `34f0b81 refactor: extract skills/plugins navigators`
- Prior work still in history: `115f3b7`, `208490c`, `f92baa8`
- Uncommitted Phase 3 integration (this session):
  - `components/SettingsPage.tsx` + `SettingsPage.test.mjs` — active Skills/Plugins/Models controller, category strip hides on any nested mobile detail
  - `app/globals.css` — `.resource-settings-*` layout
  - `lib/i18n/messages/en.ts` + `zh-CN.ts` — 8 synchronized `resources.*` keys (585/585 parity)
  - `components/SkillsConfig.test.mjs`, `components/PluginsConfig.test.mjs` — API/back/selection contracts
- Preserved artifacts: `.output/`, `pi-web.log`
- Not committed, not pushed.

`34f0b81` already contains the isolated helpers, navigators, and Settings-only `SkillsConfig` / `PluginsConfig` (data owners, `handleBack`, `filePath` / `scope\0source` identity, session reload after plugin runtime actions). This session wired those controllers into Settings and added chrome/copy/tests.

## Protected-path check

No edits to `package.json`, `package-lock.json`, `app/api/skills/**`, `app/api/plugins/**`, `src/routes/api/skills/**`, `src/routes/api/plugins.ts`, `lib/skills-service.ts`, or `lib/api-types.ts`.

## What shipped

- Desktop: one Skills/Plugins navigator (240px, 220px compact) + one scrolling detail pane.
- Mobile: `data-mobile-view` list **or** detail; back closes add-panel, then detail, then Settings.
- Skills: Active/Dormant groups; search on name/description/`filePath`; identity is `filePath`; search/install/check/update/toggle payloads unchanged.
- Plugins: project/global groups; identity `${scope}\0${source}`; POST `{ action, source, scope, cwd }` unchanged; `sendAgentCommand(sessionId, { type: "reload" })` after successful install/remove/update/enable/disable.
- Null selection after refresh/removal → `setMobileView("list")`.
- Settings Escape / Android back uses `activeController.handleBack()` (Models, Skills, or Plugins). Models dirty-exit is unchanged.

## Verification

```
node --experimental-strip-types --test \
  components/resource-settings/*.test.mjs \
  components/SkillsConfig.test.mjs \
  components/PluginsConfig.test.mjs \
  components/SettingsPage.test.mjs \
  components/AppShell.mobile-toolbar.test.mjs \
  lib/i18n/registry.test.mjs
```

**46/46 pass.**

```
node_modules/.bin/tsc --noEmit   # pass
git diff --check                 # pass
npm test                         # 699/701
```

Full-suite failures (environmental, not this phase):

1. `staging never writes .output into the repository` — untracked `.output/`
2. `enables password authentication only for a non-empty configured password` — `PI_WEB_PASSWORD` exported in the shell (`env -u` makes that file pass)

## Browser QA

Not re-run in this session (no dedicated screenshot pass). Dev server was not started for Phase 3. Reviewer should still check 1440×900 / 390×844 / 320×568: list/detail exclusivity, add-skill/add-plugin back priority, trust banners, plugin reload.

## Deviations

- Navigators/helpers landed in `34f0b81` (same file map as the plan) before Settings integration.
- Resource chrome uses `.resource-settings-*` rather than sharing `.models-settings-*` class names.
- Plugin resource-name search keeps the parent package row (packages have no child rows in the navigator).
- Per-task commits from the plan were not made for the integration slice; waiting for explicit commit authorization.

## Acceptance checklist

- [x] Desktop one navigator + one detail pane
- [x] Mobile never shows list and detail together
- [x] Search uses stable identities
- [x] API payloads and session reload preserved
- [x] Async completion repairs selection/mobile view
- [x] Status/error/retry copy is text, not color-only
- [x] 44px mobile targets in CSS
- [x] en/zh key parity
- [x] Focused tests + tsc + lint-relevant diff check + documented full suite
- [ ] User-authorized commit / merge / push
- [ ] Desktop/mobile browser QA screenshots
