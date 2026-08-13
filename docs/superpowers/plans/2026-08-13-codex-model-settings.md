# Codex-style Model Settings Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with test-driven development. Do not begin implementation until `docs/superpowers/specs/2026-08-13-codex-model-settings-design.md` is approved. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Models settings UI as a Codex-style desktop master-detail surface and mobile list-to-detail flow while preserving all existing model/auth/runtime contracts.

**Architecture:** `ModelsConfig` remains the data owner. Extract one pure navigation module and one navigator component, then adapt the existing detail components without changing their API calls. `SettingsPage` and `AppShell` receive the minimum nested-back and dirty-exit hooks needed for mobile and unsaved changes.

**Tech Stack:** React 19, TypeScript, native controls/dialog patterns, existing CSS tokens, Node test runner, current TanStack Start APIs.

---

## Baseline and Constraints

- Work from the approved feature branch; do not implement directly on `main`.
- Preserve unrelated working-tree changes and runtime artifacts.
- Do not run `npm run build` during development; `AGENTS.md` prohibits it because production output can interfere with the dev server.
- The repository may already contain an untracked `.output/`; full `npm test` then has a known hygiene failure: `staging never writes .output into the repository`.
- Do not delete `.output/` or `pi-web.log` unless the user explicitly authorizes cleanup.
- No package changes are expected.

## File Map

**Create**

- `components/models-config/models-config-types.ts`
  - Shared config, account, selection, and controller types.
- `components/models-config/models-config-navigation.ts`
  - Pure selection/filter/dirty helpers.
- `components/models-config/models-config-navigation.test.mjs`
  - Behavior tests for those helpers.
- `components/models-config/ModelsConfigNavigator.tsx`
  - Desktop/mobile list UI only.
- `components/models-config/ModelsConfigNavigator.test.mjs`
  - Structural and accessibility regression tests.

**Modify**

- `components/ModelsConfig.tsx`
  - Data owner, draft/baseline state, detail hierarchy, picker integration, responsive view state.
- `components/ModelsConfig.test.mjs`
  - Existing detail behavior plus dirty/save/disclosure regression coverage.
- `components/SettingsPage.tsx`
  - Guard section changes/close, hide category nav during mobile detail, register nested back handler.
- `components/SettingsPage.test.mjs`
  - Unsaved exit and mobile detail integration tests.
- `components/AppShell.tsx`
  - Run nested Settings back handler before closing Settings.
- `components/AppShell.mobile-toolbar.test.mjs`
  - Android back priority regression coverage.
- `app/globals.css`
  - Models layout, responsive states, focus, touch targets, disclosure and picker styling.
- `lib/i18n/messages/en.ts`
- `lib/i18n/messages/zh-CN.ts`
  - Synchronized Models navigation, dirty, empty, confirmation, and error copy.

**Do not modify unless a failing test proves it is necessary**

- `app/api/models-config/**`
- `src/routes/api/models-config/**`
- `lib/models-config-store.ts`
- `lib/rpc-manager.ts`
- `package.json`
- `package-lock.json`

---

### Task 1: Lock the Existing Runtime Baseline

**Files:**

- Test: `components/ModelsConfig.test.mjs`
- Test: `lib/models-config-store.test.mjs`
- Test: `lib/provider-listing.test.mjs`
- Test: `lib/provider-credential-store.test.mjs`
- Test: `lib/provider-api-key-route.test.mjs`
- Test: `lib/tanstack-models-config-route.test.mjs`
- Test: `lib/rpc-manager.test.mjs`

- [ ] **Step 1: Record the starting revision and worktree without changing it**

Run:

```bash
git branch --show-current
git status --short --branch
git log -1 --oneline
```

Expected: a feature branch, with any pre-existing phase-one navigation changes clearly identified.

- [ ] **Step 2: Run focused baseline tests**

Run:

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

Expected: PASS. Stop and diagnose any failure before UI changes.

- [ ] **Step 3: Capture desktop/mobile screenshots of the current Models section**

Use the current dev server at desktop `1440x900`, mobile `390x844`, and narrow mobile `320x568`. Capture the list, provider detail, model detail with Advanced closed/open, and add-provider picker.

- [ ] **Step 4: Commit only if the branch workflow requires a baseline marker**

No product files should change in this task.

---

### Task 2: Add Pure Navigation and Dirty-State Helpers

**Files:**

- Create: `components/models-config/models-config-types.ts`
- Create: `components/models-config/models-config-navigation.ts`
- Create: `components/models-config/models-config-navigation.test.mjs`

- [ ] **Step 1: Write failing tests for selection/filter semantics**

Cover these exact cases:

```ts
filterModelsNavigation(data, "anthropic")
// provider/account match keeps the matching provider visible.

filterModelsNavigation(data, "claude-sonnet")
// model-only match keeps its parent custom provider and only matching model rows.

filterModelsNavigation(data, "")
// restores all groups and preserves explicit disclosure state.

resolveModelsSelection(deletedModelSelection, refreshedData)
// falls back to the parent provider.

resolveModelsSelection(disconnectedAccountSelection, refreshedData)
// returns null/list view instead of a blank detail.
```

Also test:

```ts
isModelsConfigDirty(baseline, draft) === false
isModelsConfigDirty(baseline, changedDraft) === true
isModelsConfigDirty(draftWithReorderedObjectKeys, equivalentBaseline) === false
```

- [ ] **Step 2: Run the helper test and verify RED**

Run:

```bash
node --experimental-strip-types --test components/models-config/models-config-navigation.test.mjs
```

Expected: FAIL because the module/functions do not exist.

- [ ] **Step 3: Move shared types without changing their shapes**

Move `OAuthProvider`, `ApiKeyProvider`, `ModelEntry`, `ProviderEntry`, `ModelsJson`, `Selection`, and the new `ModelsDraftController` to `models-config-types.ts`. Import them into `ModelsConfig.tsx`, the pure helper, and the navigator. Do not broaden the types or change serialized fields.

The controller contract is:

```ts
export interface ModelsDraftController {
  dirty: boolean;
  discard(): void;
  handleBack(): boolean;
  mobileDetailOpen: boolean;
}
```

- [ ] **Step 4: Implement the minimum pure API**

Export only:

```ts
export function filterModelsNavigation(...): FilteredModelsNavigation;
export function resolveModelsSelection(...): Selection | null;
export function modelsSelectionLabel(...): { title: string; subtitle?: string };
export function isModelsConfigDirty(baseline: ModelsJson, draft: ModelsJson): boolean;
```

Use stable recursive object-key ordering for dirty comparison. Preserve array order because model order is meaningful in the saved document.

- [ ] **Step 5: Run the helper test and verify GREEN**

- [ ] **Step 6: Commit**

```bash
git add components/models-config/models-config-types.ts components/models-config/models-config-navigation.ts components/models-config/models-config-navigation.test.mjs components/ModelsConfig.tsx
git commit -m "test(models): define navigation and dirty state"
```

---

### Task 3: Build the Models Navigator

**Files:**

- Create: `components/models-config/ModelsConfigNavigator.tsx`
- Create: `components/models-config/ModelsConfigNavigator.test.mjs`
- Modify: `lib/i18n/messages/en.ts`
- Modify: `lib/i18n/messages/zh-CN.ts`

- [ ] **Step 1: Write failing navigator structure tests**

Assert that the navigator:

- Uses native buttons for account/provider/model rows.
- Has a labelled search input and clear button.
- Renders labelled Accounts and Custom Providers groups.
- Exposes provider disclosure with `aria-expanded`.
- Shows connection status without color as the only signal.
- Provides a single Add Provider command.
- Uses no inline hover mutation handlers.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --experimental-strip-types --test components/models-config/ModelsConfigNavigator.test.mjs
```

- [ ] **Step 3: Implement `ModelsConfigNavigator` as a controlled component**

Required props:

```ts
interface ModelsConfigNavigatorProps {
  selection: Selection | null;
  query: string;
  expandedProviders: ReadonlySet<string>;
  accounts: ModelsAccountItem[];
  providers: ModelsCustomProviderItem[];
  loading: boolean;
  errors: { accounts?: string; config?: string };
  onQueryChange(query: string): void;
  onToggleProvider(name: string): void;
  onSelect(selection: Selection): void;
  onAddProvider(): void;
  onRetry(): void;
}
```

Do not fetch or mutate config inside this component.

- [ ] **Step 4: Synchronize i18n keys**

Add English and Chinese copy for:

- Accounts / 账户
- Custom providers / 自定义供应商
- Search models and providers / 搜索模型和供应商
- No matching models or providers / 没有匹配的模型或供应商
- Connected / Configured status descriptions where missing
- Add provider recovery action

Run the i18n registry test after both files change.

- [ ] **Step 5: Verify GREEN and commit**

```bash
git add components/models-config/ModelsConfigNavigator.tsx components/models-config/ModelsConfigNavigator.test.mjs lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts
git commit -m "feat(models): add grouped settings navigator"
```

---

### Task 4: Integrate Desktop Master-Detail and Draft Baseline

**Files:**

- Modify: `components/ModelsConfig.tsx`
- Modify: `components/ModelsConfig.test.mjs`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing tests for desktop layout and save semantics**

Assert:

- Embedded Models renders `ModelsConfigNavigator` plus one detail pane.
- The obsolete `embedded`/standalone modal branch and `onClose` prop are removed because `SettingsPage` is the only caller.
- The old mobile `column`/`40vh` stacked tree layout is removed.
- Initial config load stores both `baselineConfig` and editable `config`.
- Save is disabled while clean, enabled while dirty, and remains dirty on error.
- Save success reloads the normalized document and updates both baseline and draft.
- OAuth/API-key refresh does not alter baseline or dirty state.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --experimental-strip-types --test components/ModelsConfig.test.mjs
```

- [ ] **Step 3: Replace the inline tree with `ModelsConfigNavigator`**

Keep existing loading calls, auth refresh behavior, draft mutation callbacks, selection shape, detail resolution, and picker behavior.

Replace the component signature with the Settings-only contract:

```ts
interface ModelsConfigProps {
  onControllerChange(controller: ModelsDraftController): void;
}
```

- [ ] **Step 4: Add baseline/dirty state**

On successful GET:

```ts
setBaselineConfig(normalized);
setConfig(normalized);
```

On successful PUT, immediately GET `/api/models-config` and then:

```ts
const normalized = await loadModelsConfig();
setBaselineConfig(normalized);
setConfig(normalized);
setSelection((current) => resolveModelsSelection(current, normalized, oauthProviders, apiKeyProviders));
setSavedOk(true);
```

The Save control must use `isModelsConfigDirty(baselineConfig, config)`.

- [ ] **Step 5: Move Save and status to a Models page header**

Remove the persistent bottom footer and all standalone modal/backdrop code. `rg` currently shows `SettingsPage` as the sole product caller; re-check before deletion.

- [ ] **Step 6: Add desktop CSS classes**

Use classes under `.models-settings-*`, not additional large inline style objects. Required layout:

```css
.models-settings-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  min-height: 0;
  height: 100%;
}
```

The detail pane owns vertical scrolling; the overall Settings layout must not scroll horizontally.

- [ ] **Step 7: Verify and commit**

```bash
git add components/ModelsConfig.tsx components/ModelsConfig.test.mjs app/globals.css
git commit -m "feat(models): adopt desktop master detail settings"
```

---

### Task 5: Add Mobile List-to-Detail and Nested Back Handling

**Files:**

- Modify: `components/ModelsConfig.tsx`
- Modify: `components/SettingsPage.tsx`
- Modify: `components/SettingsPage.test.mjs`
- Modify: `components/AppShell.tsx`
- Modify: `components/AppShell.mobile-toolbar.test.mjs`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing mobile navigation tests**

Assert:

- Mobile Models starts in list view.
- Selecting a row opens detail view without rendering the navigator beside/above it.
- Visible back returns to list and preserves selection/query/expanded state.
- Settings category nav is hidden only while mobile Models detail is open.
- Escape and Android popstate call the registered nested handler before closing Settings.
- Add-provider picker has higher back priority than detail.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --experimental-strip-types --test components/SettingsPage.test.mjs components/AppShell.mobile-toolbar.test.mjs components/ModelsConfig.test.mjs
```

- [ ] **Step 3: Add controlled mobile detail state**

`ModelsConfig` owns `mobileView: "list" | "detail"`. Selecting a row sets selection then detail. Returning sets list only; it does not clear selection or drafts.

- [ ] **Step 4: Register nested back behavior**

`ModelsConfig` publishes `ModelsDraftController` through `onControllerChange`. `SettingsPage` combines `controller.handleBack()` with its dirty-exit dialog, then registers one `() => boolean` handler with `AppShell`. `AppShell` invokes it before `setSettingsOpen(false)`; when it returns `true`, re-arm the existing overlay history trap. Do not call `history.pushState` from `ModelsConfig`.

- [ ] **Step 5: Guard Settings category visibility**

`SettingsPage` reads `controller.mobileDetailOpen` and applies a class/attribute that hides only the category strip. Desktop behavior remains unchanged.

- [ ] **Step 6: Add responsive CSS**

At `max-width: 640px`:

- list or detail fills `.settings-page-content`;
- header and row targets are at least 44px;
- no fixed `40vh` navigator height;
- no horizontal overflow at 320px;
- respect safe-area insets.

- [ ] **Step 7: Verify and commit**

```bash
git add components/ModelsConfig.tsx components/SettingsPage.tsx components/SettingsPage.test.mjs components/AppShell.tsx components/AppShell.mobile-toolbar.test.mjs app/globals.css
git commit -m "feat(models): add mobile list detail navigation"
```

---

### Task 6: Protect Unsaved Custom Configuration

**Files:**

- Modify: `components/ModelsConfig.tsx`
- Modify: `components/SettingsPage.tsx`
- Modify: `components/ModelsConfig.test.mjs`
- Modify: `components/SettingsPage.test.mjs`
- Modify: `lib/i18n/messages/en.ts`
- Modify: `lib/i18n/messages/zh-CN.ts`

- [ ] **Step 1: Write failing exit-guard tests**

Cover:

- Switching from Models to another Settings category while dirty asks for confirmation.
- Closing Settings while dirty asks for confirmation.
- Browser `beforeunload` is registered only while dirty.
- Cancel keeps the Models draft and current view.
- Discard restores baseline, clears dirty state, and completes the requested navigation.
- Account login/logout/API-key actions do not trigger the guard.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement one exit-request path**

All Settings section changes, backdrop close, close button, and Escape should call the same `requestCloseOrNavigate` function. Read dirty/discard from the latest `ModelsDraftController`. Render one styled native `<dialog>` for in-app discard confirmation and keep the pending close/category action in state. Avoid duplicating confirm logic in click handlers. Use `beforeunload` only for page reload/navigation because browsers require their own prompt there.

- [ ] **Step 4: Add synchronized copy**

Required copy:

- Unsaved model changes
- Discard changes?
- Your custom provider and model edits have not been saved.
- Keep editing
- Discard

- [ ] **Step 5: Verify and commit**

```bash
git add components/ModelsConfig.tsx components/SettingsPage.tsx components/ModelsConfig.test.mjs components/SettingsPage.test.mjs lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts
git commit -m "fix(models): protect unsaved settings drafts"
```

---

### Task 7: Recompose Provider and Model Details

**Files:**

- Modify: `components/ModelsConfig.tsx`
- Modify: `components/ModelsConfig.test.mjs`
- Modify: `app/globals.css`
- Modify: `lib/i18n/messages/en.ts`
- Modify: `lib/i18n/messages/zh-CN.ts`

- [ ] **Step 1: Write failing detail hierarchy tests**

Assert:

- Provider and model detail each have a title/header and common section.
- Provider headers/compat and model API/headers/compat/thinking map are inside disclosures closed by default.
- Import, test, catalog fill, capabilities, specs, and pricing remain outside Advanced.
- Delete provider/model is in a labelled danger section and requires confirmation.
- No visible role/help prose is added beyond field descriptions and status/error copy.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Convert reusable inline controls to existing CSS classes**

Keep `Field`, `TextInput`, `SecretTextInput`, `NumInput`, `Select`, `Check`, `HeaderListEditor`, and `ThinkingLevelMapEditor` behavior. Change layout and class names only where required.

- [ ] **Step 4: Preserve every existing API action**

Manually compare before/after handlers for:

- `/api/models-config/discover`
- `/api/models-config/catalog`
- `/api/models-config/test`
- `/api/auth/providers`
- `/api/auth/all-providers`
- `/api/auth/login/:provider`
- `/api/auth/api-key/:provider`

- [ ] **Step 5: Add delete confirmations**

Use the same styled native confirmation-dialog pattern. Confirmation identifies the provider/model and explains that deletion remains a draft until Save. Cancel performs no mutation.

- [ ] **Step 6: Verify and commit**

```bash
git add components/ModelsConfig.tsx components/ModelsConfig.test.mjs app/globals.css lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts
git commit -m "refactor(models): clarify provider and model details"
```

---

### Task 8: Adapt the Add Provider Picker

**Files:**

- Modify: `components/ModelsConfig.tsx`
- Modify: `components/ModelsConfig.test.mjs`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing picker tests**

Assert:

- Search remains available.
- OAuth and API-key groups remain distinct.
- Dual-auth providers do not appear twice in the active navigator after selection.
- Desktop uses a modal; mobile uses a full-height view with visible back.
- Rows meet minimum touch target and expose provider name/model count.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Restyle without changing provider-listing logic**

Do not change `activeOAuth`, `activeApiKey`, `availableOAuth`, or `availableApiKey` membership rules without a failing provider-listing test.

- [ ] **Step 4: Verify and commit**

```bash
git add components/ModelsConfig.tsx components/ModelsConfig.test.mjs app/globals.css
git commit -m "refactor(models): adapt provider picker to settings"
```

---

### Task 9: Full Verification and Browser QA

**Files:**

- Modify only files required by verified defects found in this task.

- [ ] **Step 1: Run focused tests**

```bash
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

- [ ] **Step 2: Run static verification**

```bash
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
```

Expected: typecheck and diff check exit 0. Lint has no new warnings in touched files.

- [ ] **Step 3: Run the complete test suite**

```bash
npm test
```

If the sole failure is the known repository `.output/` hygiene assertion, report it exactly and do not delete the directory without authorization.

- [ ] **Step 4: Run the Impeccable detector on touched UI files**

```bash
node /Users/kale/.agents/skills/impeccable/scripts/detect.mjs --json \
  components/ModelsConfig.tsx \
  components/models-config/ModelsConfigNavigator.tsx \
  components/SettingsPage.tsx \
  app/globals.css
```

Investigate new findings. Do not refactor unrelated pre-existing CSS warnings.

- [ ] **Step 5: Desktop browser QA**

At `1440x900` and `1024x768`, verify:

- Accounts/custom groups and search.
- Provider selection, disclosure, add model, import models.
- Model common/advanced detail.
- Test connection and models.dev fill/undo.
- Dirty/save/success/error states.
- Section switch/close discard guard.
- Add-provider picker.
- Keyboard Tab/Enter/Escape and visible focus.
- No nested body scrolling or horizontal overflow.

- [ ] **Step 6: Mobile browser QA**

At `390x844` and `320x568`, verify:

- List and detail never render together.
- Back priority: picker -> confirmation -> detail -> Settings.
- Android/browser back consumes the same layers.
- Query, disclosure, drafts, and scroll position survive list/detail navigation.
- Touch targets are at least 44px.
- Keyboard opening does not hide the active input/action.
- No text overlap, clipped controls, or horizontal overflow.

- [ ] **Step 7: Verify saved runtime behavior**

Use a disposable custom provider/model entry. Save, reload Models settings, and confirm the normalized values reload. Confirm an already-running session sees refreshed model configuration without creating a new session.

- [ ] **Step 8: Final diff review**

```bash
git diff --stat <base>...HEAD
git diff --check <base>...HEAD
git status --short --branch
```

Confirm no package files, API contracts, generated route tree, `.output/`, or logs were unintentionally changed.

- [ ] **Step 9: Commit verification fixes and request review**

Use a scoped commit message describing only verified final corrections.

---

## Implementation Stop Conditions

Stop and request direction if any of the following becomes necessary:

- Changing `models.json` schema or credential persistence.
- Converting custom model configuration to auto-save.
- Adding a dependency.
- Moving Accounts into a separate top-level Settings category.
- Changing auth-provider membership/deduplication rules.
- Deleting existing runtime artifacts to make tests pass.
