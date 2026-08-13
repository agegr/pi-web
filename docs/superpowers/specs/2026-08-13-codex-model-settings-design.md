# Codex-style Model Settings Design

## Status

Proposed for review. No product code has been changed for this phase.

## Goal

Restructure the Models section of Settings into a Codex-style master-detail experience that is fast to scan on desktop and behaves as a true list-to-detail flow on mobile, while preserving every existing provider, authentication, discovery, testing, pricing, compatibility, and save behavior.

## Why This Phase Exists

The current model settings surface combines four different jobs in one view:

1. Connect built-in providers through OAuth or API keys.
2. Add and configure custom providers.
3. Add, discover, test, and edit models.
4. Edit low-frequency protocol and compatibility overrides.

On desktop these jobs are visually compressed into a narrow tree and a long editor. On mobile the tree and editor are stacked in one scroll surface, so the user sees navigation and editing at the same time. The result is dense, difficult to scan, and inconsistent with the rest of the Codex-style Settings shell.

The problem is information architecture, not the color palette.

## Scope

### Included

- Replace the current tree/editor body with a stable desktop master-detail layout.
- Replace the mobile stacked layout with separate list and detail views.
- Add provider/model filtering within Models settings.
- Visually separate connected accounts from custom providers without moving them into different Settings categories.
- Keep common provider/model fields visible and low-frequency fields behind disclosure.
- Make custom `models.json` edits explicitly dirty and saveable.
- Prevent silent loss of unsaved custom configuration when leaving Models or closing Settings.
- Normalize touch targets, focus states, headings, status messages, and destructive actions.
- Split the current 2,256-line component only at boundaries required by the new layout and tests.

### Excluded

- No backend route, schema, credential storage, or `models.json` format changes.
- No automatic save for custom provider/model edits.
- No changes to the chat model selector or model scoping behavior.
- No provider ordering, model drag-and-drop, bulk deletion, or model favorites.
- No redesign of Skills or Plugins in this phase.
- No new UI framework, command palette dependency, form library, or state-management library.

## Design Decisions

### 1. One Models Domain, Two Explicit Groups

OAuth/API-key providers and custom providers remain in the same Models section because users understand both as ways to make models available. The navigator presents two groups:

- **Accounts**: OAuth and managed API-key providers. Each row shows provider icon, name, and connection state.
- **Custom providers**: entries from `~/.pi/agent/models.json`. Provider rows disclose their model rows.

The groups share navigation but retain different persistence semantics:

- Account login/logout/key operations remain immediate and use existing auth routes.
- Custom provider/model edits remain local drafts until the user presses Save.

### 2. Desktop Uses a Stable Master-Detail Layout

Inside the existing Settings content area:

- Navigator width: `240px`, allowed to shrink to `220px` on compact desktop.
- A search field stays at the top of the navigator.
- Accounts appear first, then custom providers.
- The selected row uses the existing `--bg-selected` token.
- The detail pane is the only independently scrolling editor.
- The navigator footer contains one `Add provider` command.
- Save status and Save action live in the Models page header, not a fixed footer.

The outer Settings category navigation remains unchanged.

### 3. Mobile Uses List Then Detail

At `max-width: 640px`:

- Entering Models shows only the provider/model list.
- Selecting any account, provider, or model replaces the list with a full-width detail view.
- The detail header contains a back arrow, the selected item name, optional provider context, and the Save action when custom configuration is dirty.
- The global Settings category strip is hidden while model detail is open, restoring vertical space and preventing accidental category changes.
- Returning to the list preserves search text, expanded providers, selection, draft edits, and scroll position.

Back behavior priority:

1. Close the add-provider picker if open.
2. Close any destructive confirmation if open.
3. Return from model detail to the Models list.
4. Close Settings.

`Escape`, the visible back button, and Android browser back must follow this order. The implementation must extend the existing Settings overlay back handling rather than create a competing browser-history system.

### 4. Search Behavior

Search is local and case-insensitive.

- Account rows match provider display name and provider id.
- Custom provider rows match provider name, Base URL, and API type.
- Model rows match model id and model display name.
- A model match keeps its parent provider visible and expanded.
- A provider match shows all of that provider's models.
- An empty query restores explicit disclosure state.
- No-result copy is specific to Models and offers `Add provider` as the recovery action.

No fuzzy-search package is needed.

### 5. Detail Hierarchy

#### Account Detail

Show:

- Provider identity and connection state.
- Login/re-login/disconnect or API-key configure/replace/remove actions.
- Existing OAuth progress, device-code, prompt, selection, and error states.

Account actions are not affected by the custom-config Save button.

#### Custom Provider Detail

Common section, always visible:

- Provider name.
- Base URL.
- API protocol.
- API key/source.
- Import models command and its existing result picker.
- Model count summary.

Advanced section, collapsed by default:

- Provider request headers.
- Provider compatibility fields currently supported by the component.

Destructive action:

- Delete provider sits in a danger section at the bottom.
- Deletion requires confirmation and remains a local draft until Save.

#### Custom Model Detail

Common section, always visible:

- Model id and display name.
- Test connection command and status.
- Fill details from models.dev command and undo status.
- Reasoning and image-input capabilities.
- Context window and max output tokens.
- Readable pricing summary with explicit Edit action.

Advanced section, collapsed by default:

- Per-model API override.
- Header overrides.
- Compatibility overrides.
- Thinking-level map.

Destructive action:

- Delete model sits in a danger section at the bottom.
- Deletion requires confirmation and remains a local draft until Save.

### 6. Save and Dirty-State Semantics

The loaded `ModelsJson` is stored as the baseline. Custom edits compare against that baseline through a deterministic serialization helper; no deep-equality dependency is added.

Save button states:

- Clean: disabled, label `Saved` or `Save` according to existing product copy.
- Dirty: enabled, label `Save`.
- Saving: disabled with progress state.
- Success: reload the server-normalized config, update both baseline and draft, repair selection, and briefly show success.
- Error: keep the draft and dirty state; show the server error near the page header.

After a successful PUT, the client must GET `/api/models-config` again and use that response as the new baseline and draft. Persistence normalizes Base URLs and costs and removes blank model rows, so treating the pre-save client draft as canonical would leave a false-clean UI that differs from disk.

Leaving Models, closing Settings, or reloading the page while dirty must request confirmation. Settings uses a styled native `<dialog>` for in-app confirmation; `beforeunload` uses the browser-provided prompt because browsers do not permit custom unload dialogs. Choosing Discard restores the last saved baseline before navigation. Choosing Cancel keeps the user in Models.

OAuth/API-key changes never mark `models.json` dirty.

### 7. Add Provider Flow

The existing provider picker capabilities remain intact:

- Search available OAuth and API-key providers.
- Select a managed provider and open its detail.
- Add a custom provider draft.

Presentation changes:

- Desktop: centered modal above Settings, using existing settings tokens.
- Mobile: full-height sheet/page with a back button and 44px minimum rows.
- The picker closes after selection and navigates directly to the selected detail.

### 8. Error and Loading States

- Loading the Models page uses a quiet list/detail skeleton or text status without shifting the outer Settings layout.
- If custom config loading fails, show a retry action and do not pretend the config is empty.
- Auth-provider list failures are shown per Accounts group while custom providers remain usable.
- Save, discovery, catalog, model test, OAuth, and API-key errors retain their existing payloads and recovery actions.
- A stale selection caused by deletion or refreshed auth data resolves to the nearest valid parent or the list view; it must not render a blank pane.

## Accessibility

- Navigator is a labelled navigation/list surface, not an ARIA tree unless full tree keyboard semantics are implemented.
- Rows are native buttons with visible focus.
- Desktop arrow-key roving focus is optional; Tab and Enter must work in the first implementation.
- All mobile interactive targets are at least 44px high.
- Search has a visible label for screen readers and a clear button when non-empty.
- Disclosure buttons expose `aria-expanded` and `aria-controls`.
- Status and errors use `aria-live` or `role="alert"` without stealing focus.
- Destructive confirmations identify the provider/model by name.
- Motion respects `prefers-reduced-motion`; the list/detail transition can be instant.

## Component Boundaries

The implementation should create only these boundaries:

- `components/models-config/ModelsConfigNavigator.tsx`
  - Renders search, Accounts group, custom provider/model group, selection, disclosure, and Add Provider.
- `components/models-config/models-config-types.ts`
  - Shared config, account, selection, and nested-controller types moved from `ModelsConfig.tsx` without behavioral changes.
- `components/models-config/models-config-navigation.ts`
  - Pure filtering, selection validity, selection labels, and dirty comparison helpers.
- `components/ModelsConfig.tsx`
  - Remains the data-flow owner for config/auth loading, draft mutations, selection, save, picker, and detail rendering.
- `components/SettingsPage.tsx`
  - Owns section changes, Settings close requests, and registration of the nested mobile back handler.
- `components/AppShell.tsx`
  - Invokes the registered nested Settings back handler before closing Settings on Android back.

Do not split every detail editor during this phase. Moving stable provider/model form code without changing behavior would inflate the diff and make regression review harder.

`ModelsConfig` currently has no product caller outside `SettingsPage`, which always passes `embedded`. The obsolete standalone modal/backdrop branch should be removed during integration. Settings owns the single outer dialog; Models owns only its internal navigator, details, picker, and confirmations.

The Settings integration contract is:

```ts
interface ModelsDraftController {
  dirty: boolean;
  discard(): void;
  handleBack(): boolean;
  mobileDetailOpen: boolean;
}
```

`ModelsConfig` reports this controller to `SettingsPage`. `handleBack()` consumes only Models-owned layers in priority order (picker, destructive confirmation, detail). `SettingsPage` then handles dirty-exit confirmation and reports one combined back handler to `AppShell`. `AppShell` calls that handler before closing Settings on Android/browser back.

## Protected Runtime Invariants

The following behavior must remain unchanged:

1. `PUT /api/models-config` writes before `refreshRpcSessionModelConfigs()`.
2. `writeModelsConfig()` remains atomic, private (`0600` where supported), normalized, and cache-invalidating.
3. Saving custom config refreshes existing live sessions without creating new RPC sessions.
4. Dual-auth providers refresh both OAuth and API-key lists after every auth change.
5. `auth.json` retains one credential per provider and credential deletion remains type-safe.
6. Provider/model discovery, catalog fill, test connection, OAuth device-code/manual-code, and API-key routes retain their current request/response contracts.
7. Blank draft model ids continue to be removed only during persistence normalization.
8. Historical sessions remain readable after models/providers are removed.

## Acceptance Criteria

1. Desktop Models settings show one navigator and one detail pane with no nested vertical page stack.
2. Mobile shows either the list or the detail, never both simultaneously.
3. Search finds accounts, custom providers, and models with the parent/child behavior defined above.
4. Common fields stay visible; advanced request/compatibility fields default collapsed.
5. OAuth/API-key actions remain immediate and do not affect custom-config dirty state.
6. Custom edits enable Save; successful save clears dirty state; failed save preserves drafts.
7. Leaving with unsaved custom edits requires explicit discard confirmation.
8. Visible, Escape, and Android back behavior follow the defined nested priority.
9. Mobile controls meet 44px touch targets with no horizontal overflow at `390x844` and `320x568`.
10. Existing model-config, auth, storage, route, RPC refresh, Settings, TypeScript, and i18n tests pass.

## Review Decisions

Approval of this design confirms two product choices:

1. Custom provider/model edits keep an explicit Save button rather than auto-save.
2. Connected accounts and custom providers remain together under Models, separated by labelled groups rather than separate Settings categories.
