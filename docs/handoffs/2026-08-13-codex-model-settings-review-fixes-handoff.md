# Codex-style Model Settings Review Fixes Handoff

## Objective

Independent review of Phase 2 recommended **not signing off or merging** until P1/P2 defects were fixed. Those defects are now fixed in the working tree and covered by tests. This document is the review-round report for the plan author.

Phase 2 design/plan still apply. This handoff supersedes the “uncommitted / do not merge” conclusion in `docs/handoffs/2026-08-13-codex-model-settings-phase2-handoff.md` for the listed P1/P2/P3 items only.

## Required Reading

1. `docs/superpowers/specs/2026-08-13-codex-model-settings-design.md`
2. `docs/superpowers/plans/2026-08-13-codex-model-settings.md`
3. `docs/handoffs/2026-08-13-codex-model-settings-phase2-handoff.md`
4. This document

## Repository State (refreshed)

- Repository: `/Users/kale/pi-web`
- Branch: `feat/codex-quick-switcher`
- Base commit at inspection: `8c3c795 feat: Codex-style chat tail`
- Phase-1 quick-switcher files remain in the working tree and are **not** part of the Models commit:
  - `components/CodexSidebar.tsx`
  - `components/CodexSidebar.test.mjs`
  - `lib/codex-sidebar-search.ts`
  - `docs/superpowers/specs/2026-08-13-codex-navigation-design.md`
  - `docs/superpowers/plans/2026-08-13-codex-navigation.md`
- Runtime artifacts still untracked and untouched: `.output/`, `pi-web.log`

## Review Findings → Disposition

| ID | Finding | Verdict | Fix |
|---|---|---|---|
| P1 | Search uses filtered model array index, so clicking `beta` can edit `alpha` | Confirmed | Filter rows keep original `index`; navigator selects `model.index` |
| P1 | First edit steals focus to Settings close | Confirmed | `closeButtonRef.focus()` runs only on Settings mount |
| P1 | GET after PUT overwrites edits made during save | Confirmed | `applySavedModelsConfig(saved, current, normalized)` keeps concurrent draft |
| P1 | Accounts retry calls `loadConfig()` and wipes dirty drafts | Confirmed | Accounts retry only refreshes auth; config retry skips when dirty |
| P2 | Discard does not repair selection / mobile view | Confirmed | Discard runs `resolveModelsSelection`; null → list view |
| P2 | Disconnecting the selected account leaves a stale detail | Confirmed | Auth list changes re-resolve selection |
| P2 | OAuth and API-key loaders share one error flag | Confirmed | `oauthError` / `apiKeyError` are independent |
| P2/a11y | Add Provider is a `div`, no focus trap or restore | Confirmed | Native `<dialog showModal()>`; restore previous focus on close |
| P3 | Two mobile targets are 40px | Confirmed | Search, +model, picker back are 44px |

Failed-load drafts: if `baseline` is null and the user already added a custom provider, that draft is now dirty, so config retry will not overwrite it.

## Tests Added

- `filterModelsNavigation(..., "reasoner")` keeps `{ index: 1 }`, not filtered index `0`
- `applySavedModelsConfig` keeps concurrent edits, otherwise takes the normalized document
- `isModelsConfigDirty(null, draft)` is true once any custom provider exists
- Navigator asserts `model.index` for selection and separate `onRetryAccounts` / `onRetryConfig`
- ModelsConfig source tests: discard repair, auth re-resolve, split errors, retry split, picker dialog
- SettingsPage: close-button focus is a mount-only effect

## Verification (run for this handoff)

```
node --experimental-strip-types --test \
  components/models-config/models-config-navigation.test.mjs \
  components/models-config/ModelsConfigNavigator.test.mjs \
  components/ModelsConfig.test.mjs \
  components/SettingsPage.test.mjs \
  components/AppShell.mobile-toolbar.test.mjs \
  lib/models-config-store.test.mjs \
  lib/provider-listing.test.mjs \
  lib/provider-credential-store.test.mjs \
  lib/provider-api-key-route.test.mjs \
  lib/tanstack-models-config-route.test.mjs \
  lib/rpc-manager.test.mjs \
  lib/i18n/registry.test.mjs
```

Expected: **104/104 pass**. `tsc --noEmit` and `git diff --check` pass.

Full `npm test` was last run before this review-fix round (661/663, two environmental failures). Re-run after commit if the reviewer wants a fresh full-suite number.

## Commit Scope

One commit for Models Phase 2 + review fixes + these docs. Intentionally **excluded**:

- Phase-1 sidebar/quick-switcher product files listed above
- `.output/`, `pi-web.log`

Shared files `app/globals.css` and `lib/i18n/messages/{en,zh-CN}.ts` still contain a few Phase-1 sidebar search keys/styles in the same hunks. They are included because Models styles and copy live in those files. Unused sidebar keys are harmless until Phase 1 is committed.

## Remaining Reviewer Decisions

- [ ] Re-check the nine findings against the commit
- [ ] Decide whether Phase 1 sidebar should be a separate commit (`git add -p` on the two shared files if you want a cleaner split)
- [ ] Merge/push only after that split decision
