# Codex-style Model Settings Phase 2 Handoff

## Objective

Implement the approved second Codex-ization phase: restructure the Models section of Settings as a desktop master-detail surface and a mobile list-to-detail flow, without changing backend contracts or model/auth persistence.

No phase-two product code has been written. This handoff and the linked design/plan are review artifacts only.

## Required Reading

Read in this order:

1. `PRODUCT.md`
2. `AGENTS.md`
3. `docs/superpowers/specs/2026-08-13-codex-model-settings-design.md`
4. `docs/superpowers/plans/2026-08-13-codex-model-settings.md`
5. `components/ModelsConfig.tsx`
6. `components/ModelsConfig.test.mjs`
7. `components/SettingsPage.tsx`
8. Model/auth invariants in `AGENTS.md`

## Current Repository State

At handoff creation:

- Repository: `/Users/kale/pi-web`
- Branch: `feat/codex-quick-switcher`
- Current commit: `8c3c795 feat: Codex-style chat tail`
- `main` and `origin/main` also pointed to `8c3c795` at inspection time.
- Phase-one project/session quick-switcher changes exist as uncommitted working-tree changes.
- Existing untracked runtime artifacts include `.output/` and `pi-web.log`.
- Do not discard, reset, clean, or overwrite those changes/artifacts.

Always refresh this snapshot before implementation:

```bash
git branch --show-current
git status --short --branch
git log -1 --oneline --decorate
```

## Running Services

- Existing production service may be listening on `0.0.0.0:30141` from `.output/server/index.mjs`.
- A current-branch Vite dev server was started on `127.0.0.1:30142` for phase-one review.
- Verify rather than assume:

```bash
lsof -nP -iTCP:30141 -sTCP:LISTEN
lsof -nP -iTCP:30142 -sTCP:LISTEN
```

Do not replace the production service when implementing phase two. Use an available development port.

## Current Models Implementation

`components/ModelsConfig.tsx` is approximately 2,256 lines and currently owns:

- Provider icon registry.
- Shared field controls.
- Custom provider detail and upstream model discovery.
- Custom model detail, model test, models.dev fill/undo, pricing, capabilities, headers, compatibility, and thinking map.
- OAuth login/device-code/manual-code flows.
- API-key configuration flows.
- Add-provider picker.
- Config/auth loading.
- Draft mutation, selection, and full-document Save.
- Desktop and mobile layout through inline styles.

The current mobile layout uses a column with a navigator capped at `40vh`, followed by the detail editor. This is the behavior being replaced.

## Approved Direction Pending User Review

- Accounts and custom providers remain together in Models, separated by labelled groups.
- Desktop: `240px` searchable navigator plus one scrolling detail pane.
- Mobile: list or detail, never both simultaneously.
- Common settings visible; protocol headers/compatibility/thinking overrides default collapsed.
- Custom provider/model changes remain explicit-save drafts.
- Successful Save reloads the server-normalized config before clearing dirty state.
- OAuth/API-key actions remain immediate.
- Dirty custom drafts are protected when changing Settings category, closing Settings, or reloading.
- In-app discard/delete confirmation uses a styled native `<dialog>`; only `beforeunload` uses the browser prompt.
- Android back closes nested Models layers before closing Settings.
- No dependency, route, schema, or package change.

Do not start implementation until the user approves these choices.

## Protected Invariants

These are regression boundaries, not refactoring opportunities:

1. `app/api/models-config/route.ts` writes config before refreshing live session configs.
2. `lib/models-config-store.ts` performs atomic private writes, base-URL/cost normalization, blank-model cleanup, and model-cache invalidation.
3. `refreshRpcSessionModelConfigs()` refreshes existing wrappers only and must not create a registry/session.
4. Every auth change refreshes both OAuth and API-key lists because dual-auth providers can move between them.
5. Credential removal remains type-checked under the same auth-store lock.
6. Provider discovery, model test, OAuth, and API-key endpoint contracts remain unchanged.
7. Historical session readability does not depend on a model still existing in current config.
8. The TanStack adapters remain thin delegates to the shared handlers.

## Intended File Boundaries

Create only:

- `components/models-config/models-config-types.ts`
- `components/models-config/models-config-navigation.ts`
- `components/models-config/models-config-navigation.test.mjs`
- `components/models-config/ModelsConfigNavigator.tsx`
- `components/models-config/ModelsConfigNavigator.test.mjs`

Keep data loading/mutation and existing detail editors in `components/ModelsConfig.tsx` for this phase. Do not fan the component into a large folder of one-off files.

`rg` found no product caller of `ModelsConfig` outside `SettingsPage`, and that caller always uses `embedded`. The plan therefore removes the obsolete standalone modal branch and makes Settings the only outer shell. Re-run the caller search before deleting it.

Models/Settings integration uses one reported controller:

```ts
interface ModelsDraftController {
  dirty: boolean;
  discard(): void;
  handleBack(): boolean;
  mobileDetailOpen: boolean;
}
```

Models consumes picker/destructive-confirmation/detail back layers. Settings owns dirty-exit confirmation. AppShell invokes the combined Settings handler before closing the Settings overlay.

## Test Baseline

Before changes, run:

```bash
node --experimental-strip-types --test \
  components/ModelsConfig.test.mjs \
  components/SettingsPage.test.mjs \
  lib/models-config-store.test.mjs \
  lib/provider-listing.test.mjs \
  lib/provider-credential-store.test.mjs \
  lib/provider-api-key-route.test.mjs \
  lib/tanstack-models-config-route.test.mjs \
  lib/rpc-manager.test.mjs
```

Repository-wide `npm test` currently can fail only because untracked `.output/` violates `lib/tanstack-package.test.mjs` (`repository must not contain .output`). Treat that as an environment/worktree hygiene failure, not permission to remove the directory.

`AGENTS.md` explicitly says not to run `npm run build` during development.

## Review Checklist for the User

Please confirm:

- [ ] Explicit Save remains for custom provider/model edits.
- [ ] Accounts and custom providers stay in one Models category with separate groups.
- [ ] Desktop navigator/detail proportions are acceptable.
- [ ] Mobile category tabs hide while a model/account detail is open.
- [ ] Unsaved changes require Discard confirmation on exit.
- [ ] Provider/model deletion is drafted first and persisted only by Save.
- [ ] Phase two excludes Skills, Plugins, chat model selector, and backend schema changes.

## Definition of Done

- Desktop and mobile acceptance criteria in the design document are satisfied.
- Focused tests, TypeScript, and diff checks pass.
- No new lint warnings in touched files.
- Full test output is reported honestly, including the existing `.output/` failure if still present.
- Desktop and mobile browser QA is captured at the specified viewports.
- No product code outside the approved file map changes without a failing test and documented reason.
- The phase is reviewed before merge or push.
