# Codex-style Model Settings Phase 2 Handoff (Implementation → Review)

## Objective

Phase 2 has been implemented per the approved design and plan: the Models section of Settings is now a Codex-style desktop master-detail surface and a mobile list-to-detail flow. No backend contract, credential storage, or `models.json` schema changed. Phase 1 (quick switcher) was confirmed present via `git status` and was **not** redeveloped.

## Required Reading

Read in this order:

1. `PRODUCT.md`
2. `AGENTS.md`
3. `docs/superpowers/specs/2026-08-13-codex-model-settings-design.md`
4. `docs/superpowers/plans/2026-08-13-codex-model-settings.md`
5. `docs/handoffs/2026-08-13-codex-model-settings-handoff.md` (phase 1 → 2)
6. This document

## Repository State (refreshed at handoff creation)

- Repository: `/Users/kale/pi-web`
- Branch: `feat/codex-quick-switcher`
- Current commit: `8c3c795 feat: Codex-style chat tail` (`main`/`origin/main` point here too)
- Phase-1 quick-switcher changes remain as uncommitted working-tree changes (verified, not redeveloped).
- Phase-2 changes are **uncommitted** working-tree changes on top of phase 1 (see "Commit Strategy" below).
- Untracked runtime artifacts `.output/` and `pi-web.log` are untouched.
- Dev server for review: `http://127.0.0.1:30143` (Basic auth `pi` / the configured `PI_WEB_PASSWORD`), started for browser QA and left running.
- Browser QA screenshots: `/tmp/qa-models/` (10 captures listed in the QA section).

## What Was Delivered

### File map (exactly as planned; nothing outside it)

**Created**

| File | Purpose |
|---|---|
| `components/models-config/models-config-types.ts` | Shared config/account/selection types + `ModelsDraftController` contract |
| `components/models-config/models-config-navigation.ts` | Pure `filterModelsNavigation`, `resolveModelsSelection`, `modelsSelectionLabel`, `isModelsConfigDirty` |
| `components/models-config/models-config-navigation.test.mjs` | 10 behavior tests for the pure helpers |
| `components/models-config/ModelsConfigNavigator.tsx` | Search, Accounts/Custom-provider groups, disclosure, Add Provider; owns the moved provider icon registry |
| `components/models-config/ModelsConfigNavigator.test.mjs` | 8 structural/accessibility tests |

**Modified**

| File | Change |
|---|---|
| `components/ModelsConfig.tsx` | Settings-only contract `{ onControllerChange }`; baseline/dirty state; Save reloads the server-normalized document; header Save; mobile `mobileView`; delete-confirmation `<dialog>`; provider/model details recomposed (advanced disclosure, danger zone, model-count summary); picker restyled (desktop modal / mobile sheet) |
| `components/SettingsPage.tsx` | `requestCloseOrNavigate` single exit path; discard `<dialog>`; Escape consumes Models layers first; category strip hidden on mobile detail; combined back handler registered with AppShell |
| `components/AppShell.tsx` | `settingsBackHandlerRef` invoked before closing Settings on Android back; re-arms the history trap when consumed |
| `components/ModelsConfig.test.mjs` | Existing detail tests kept; +10 phase-2 regression tests |
| `components/SettingsPage.test.mjs` | Contract update; +5 exit-guard/back/mobile tests |
| `components/AppShell.mobile-toolbar.test.mjs` | +1 Android-back priority test |
| `app/globals.css` | `.models-settings-*`, `.models-picker-*`, dialog styles; responsive rules; compact-desktop 220px column |
| `lib/i18n/messages/en.ts`, `zh-CN.ts` | 21 synchronized keys (parity kept: 72 `models.*` keys each) |

**Untouched (per plan's protected list):** `app/api/models-config/**`, `src/routes/api/models-config/**`, `lib/models-config-store.ts`, `lib/rpc-manager.ts`, `package.json`, `package-lock.json`.

### Protected invariants — verified unchanged

1. PUT-writes-before-refresh and atomic private writes: backend untouched; `lib/tanstack-models-config-route.test.mjs` + `lib/models-config-store.test.mjs` pass.
2. `refreshRpcSessionModelConfigs()` refreshes existing wrappers only: `lib/rpc-manager.test.mjs` passes; no backend code changed.
3. Dual-auth refresh after every auth change: `refreshAuthProviders()` still reloads both lists; navigator additionally dedupes account rows by id (belt-and-braces for #309).
4. All discovery/catalog/test/OAuth/API-key fetch contracts byte-identical (handlers moved, not rewritten).
5. Blank model ids still removed only by server normalization — the UI reloads the normalized document after Save instead of trusting the client draft.

## Verification Evidence

### Automated

| Check | Command | Result |
|---|---|---|
| Focused suite (12 files) | `node --experimental-strip-types --test ...` | **93/93 pass** |
| Full suite | `npm test` | **661/663 pass** — 2 environmental failures, see below |
| Typecheck | `node_modules/.bin/tsc --noEmit` | pass |
| Lint | `npm run lint` | 0 errors; 11 warnings all in pre-existing files (`CodexSidebar.tsx`, `lib/tanstack-route-inventory.test.mjs`) |
| Diff hygiene | `git diff --check` | pass |
| Impeccable detector | `detect.mjs --json` on the 4 touched UI files | 4 findings, all pre-existing CSS (sidebar/markdown); none in new `.models-settings-*` rules |

### The two full-suite failures (both environmental, reproducible pre-change)

1. `staging never writes .output into the repository` — known hygiene failure from the untracked `.output/` directory (documented in the phase-1→2 handoff). Not caused by this phase.
2. `enables password authentication only for a non-empty configured password` (`lib/web-auth.test.mjs`) — the shell exports `PI_WEB_PASSWORD=yansy102` (needed by the running services). The test's default-parameter path then sees a configured password. With `env -u PI_WEB_PASSWORD`, the file passes 5/5. Unrelated to this phase.

### Browser QA (Playwright headless, dev server `127.0.0.1:30143`)

Viewports `1440×900`, `390×844`, `320×568`; screenshots in `/tmp/qa-models/`:

| Capture | Verifies |
|---|---|
| `desktop-master-detail.png` | One navigator (240px, search, Accounts/自定义供应商 groups, selected row) + one detail pane; header Save disabled while clean; danger zone at detail bottom |
| `desktop-provider-detail.png` | DeepSeek account detail renders in the pane |
| `desktop-provider-advanced-open.png` | Provider advanced disclosure opens with the header-overrides editor |
| `desktop-dirty-save.png` | Dirty state keeps Save enabled |
| `desktop-picker.png` | Add-provider picker as centered modal; OAuth + API Key groups; model counts |
| `mobile-list.png` | 390px: list only, no detail; 44px rows; category strip visible |
| `mobile-detail.png` | Detail only, back arrow + item name + Save in header; category strip hidden |
| `mobile-list-returned.png` | Back returns to list |
| `narrow-list.png` | 320px: no horizontal overflow |

Interaction QA (scripted, all passed):

- **Save round-trip with the real backend**: added `qa-disposable-*` provider → renamed → filled Base URL → Save (button disabled after success = clean) → left/re-entered Models → entry and normalized Base URL persisted → deleted via danger zone + confirmation → Save → `GET /api/models-config` confirms no leftover (original `sub2api`, `codex2api` only).
- **Exit guard**: dirty → category switch opens discard dialog with correct copy; Keep editing closes it and preserves the draft; Discard restores baseline and completes navigation; close-X while dirty → dialog → discard → Settings closes.
- **Escape priority**: picker closes before detail; Settings stays open.
- **Android back (real `history.back()` on mobile)**: detail → back → list (Settings open) → back → Settings closed. Picker open → back → picker closed, still in detail.
- **beforeunload**: registered only while dirty (source-level test).

## Deviations from the Plan (documented)

1. **No per-task commits.** The working tree interleaves phase-1 and phase-2 hunks in `app/globals.css` and both i18n files; staging only phase-2 hunks via `git add -p` risks misattributing phase-1 code, and committing everything under one message mislabels it. Followed the phase-1→2 handoff's own pattern: leave the tree uncommitted for review. See "Commit Strategy".
2. **`ModelsConfigNavigatorProps` gained `onAddModel(providerName)`** (plan's required-prop list omitted it). Needed to preserve the existing "add model" capability the old tree provided; Task 9's browser-QA checklist explicitly includes "add model". The component remains fully controlled (no fetch/state).
3. **No pre-change screenshots.** Plan Task 1 step 3 asked to capture the pre-change UI; no dev server was running at implementation start and the old layout is preserved in `git show HEAD:components/ModelsConfig.tsx` if needed for comparison.
4. **Account rows dedupe by id** in addition to the existing both-lists refresh, so a dual-auth provider can never render twice even with a stale auth snapshot.
5. Both confirmation dialogs (delete, discard) share the `.models-settings-dialog` class; distinct `[open]` state, no behavioral conflict.

## Review Checklist (acceptance mapping)

Design-doc acceptance criteria → evidence:

- [ ] **1. Desktop: one navigator + one detail pane, no nested vertical stack** — `desktop-master-detail.png`; `.models-settings-layout { grid-template-columns: 240px minmax(0, 1fr) }`.
- [ ] **2. Mobile: list or detail, never both** — `mobile-list.png` / `mobile-detail.png`; `data-mobile-view` CSS toggling, both panes stay mounted so scroll state survives.
- [ ] **3. Search parent/child semantics** — 5 unit tests in `models-config-navigation.test.mjs` (provider match shows all models; model-only match keeps parent + matching rows; empty query restores explicit disclosure).
- [ ] **4. Common fields visible; advanced collapsed** — provider/model advanced disclosures closed by default with summary lines; catalog fill, test, capabilities, specs, pricing stay common (existing `ModelsConfig.test.mjs` order assertions kept green).
- [ ] **5. OAuth/API-key actions immediate, never dirty** — auth flows touch no `config` state; dirty derives only from `isModelsConfigDirty(baseline, config)`.
- [ ] **6. Save semantics** — disabled clean / enabled dirty / dirty preserved on error / normalized reload after success (source tests + live round-trip).
- [ ] **7. Dirty-exit protection** — discard `<dialog>` for section change, backdrop, close button, Escape; `beforeunload` only while dirty.
- [ ] **8. Back priority: picker → confirmation → detail → Settings** — verified for visible back, Escape, and Android popstate.
- [ ] **9. Mobile touch targets 44px, no overflow at 390×844 / 320×568** — CSS + screenshots.
- [ ] **10. Existing suites pass** — 661/663 with the two environmental failures above.

## Commit Strategy

See `docs/handoffs/2026-08-13-codex-model-settings-review-fixes-handoff.md` for the P1/P2/P3 review-round report and the Models commit scope. Phase-1 sidebar files stay out of that commit.

## Definition of Done

- [x] Design acceptance criteria 1–10 verified (above).
- [x] Focused tests, TypeScript, diff checks pass; no new lint warnings in touched files.
- [x] Full test output reported honestly, including the two environmental failures.
- [x] Desktop and mobile browser QA captured at the specified viewports.
- [x] No product code outside the approved file map changed.
- [x] Independent-review P1/P2/P3 items fixed (see the review-fixes handoff).
- [ ] Reviewer sign-off on merge/push.
