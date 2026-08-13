# Codex-style Skills and Plugins Settings Design

## Status

Approved for Phase 3 implementation. This document defines the UI and state boundaries; it does not authorize implementation in this document-only handoff.

## Objective

Make the Skills and Plugins sections of pi-web Settings behave and look like Codex resource settings: a desktop master-detail layout and a mobile list-to-detail flow, while preserving every existing API, storage format, action, trust rule, and session reload behavior.

## Context

`SkillsConfig` and `PluginsConfig` currently use compatibility shells designed for embedded/stacked rendering. Their data loading and mutation paths already work, but navigation, search results, action feedback, and detail editing are difficult to scan and inconsistent with the Codex Models settings delivered in Phase 2. The change is therefore an information-architecture and interaction update, not a backend rewrite.

## Goals

- Provide a single resource navigator and a single detail pane on desktop.
- Provide an explicit list view or detail view on mobile, never both at once.
- Preserve search, install, update/check, enable/disable, remove, scope, diagnostics, trust restrictions, and plugin session reload.
- Keep selections stable across filtering, refreshes, async actions, deletion, and trust changes.
- Use Codex-style settings controls, native buttons/dialogs, synchronized English and Chinese copy, and 44px minimum mobile targets.
- Make loading, empty, error, busy, and success states visible without relying on color alone.

## Non-goals

- No changes to `/api/skills` or `/api/plugins` routes, payloads, storage, or Pi runtime semantics.
- No package or lockfile changes.
- No shared mega-component that hides Skills/Plugins-specific behavior.
- No new UI framework, form library, fuzzy-search dependency, or React DOM test dependency.
- No changes to chat behavior beyond the existing plugin reload command.

## Recommended Architecture

Add a narrow controller contract in `components/resource-settings/resource-settings-types.ts`:

```ts
export type ResourceMobileView = "list" | "detail";

export interface SettingsSectionController {
  handleBack(): boolean;
  mobileDetailOpen: boolean;
}
```

Skills and Plugins each get a small pure navigation module and a controlled navigator component. The existing config components remain the data/action owners; they pass filtered rows, selection, busy state, and callbacks into their navigator. `SettingsPage` owns the active nested controller and gives it priority for Escape, visible back, and Android/browser back before closing Settings.

## Skills Experience

The navigator groups rows into Active and Dormant. Search matches skill name, description, and `filePath`; a match keeps the original `filePath` identity and never uses a filtered array index. The detail pane shows path, scope/trust state, description, disable-model-invocation toggle, and action feedback. Search/install uses the existing skills.sh endpoints and scope selector. Single-skill and all-skill check/update actions remain available, with the current detail restored or safely falling back to list after refresh.

## Plugins Experience

The navigator groups project and global packages and displays package status, resource counts, and diagnostics. Stable identity is `${pkg.scope}\0${pkg.source}`. Detail actions keep the existing install/remove/update/disable/enable payloads and send `{ type: "reload" }` through `sendAgentCommand(sessionId, ...)` after a successful runtime-affecting change. Trust restrictions remain explicit and block unavailable actions with readable status text.

## Selection, Search, and Async Invariants

- Empty search restores all rows and explicit disclosure state.
- Provider/package or skill matches show the full parent row; child matches show only matching children while retaining the parent.
- Every refresh/action completion repairs selection against the refreshed data.
- Deleted, disconnected, or trust-hidden selection returns to mobile list; it never leaves a blank detail pane.
- Async operations preserve search text, draft input, current detail, and disclosure state until the operation resolves.
- Busy controls are disabled and announce progress; errors preserve the current selection and inputs.

## Back Priority and Responsive Rules

Back priority is: open picker/dialog, then resource detail, then Settings. Desktop keeps the navigator visible beside the detail pane. At `max-width: 640px`, only one pane is visible and the detail header contains a back button and selected item title. Search and all interactive controls have visible focus styles; mobile interactive targets are at least 44px. Layout must have no horizontal overflow at 390x844 or 320x568.

## States and Accessibility

Use native `<button>`, `<input>`, `<select>`, and `<dialog>` controls. Give search and groups accessible labels, preserve keyboard navigation, and expose status through text and `aria-live` where appropriate. Loading and empty states provide actionable copy; diagnostics are readable in the detail pane and do not depend on color alone.

## Files and Ownership

Create pure navigation/types/tests and two navigator components under `components/resource-settings/`. Modify `SkillsConfig.tsx`, `PluginsConfig.tsx`, `SettingsPage.tsx`, shared CSS, synchronized i18n, and focused/source-contract tests. Protected API, service, runtime, package, lockfile, `.output/`, and `pi-web.log` paths remain untouched.

## Testing Strategy

Use Node's existing test runner for pure navigation, reducer/controller, and source-contract tests. Run TypeScript, lint, diff checks, focused suites, and the full suite. Browser QA must cover desktop 1440x900, mobile 390x844, and narrow mobile 320x568, including search, list/detail transitions, back priority, install/update/remove/enable/disable, diagnostics, reload, trust restrictions, and recovery from failed refresh.

## Acceptance Criteria

1. Desktop shows one Skills/Plugins navigator and one detail pane.
2. Mobile shows list or detail only, with working back/Escape/browser back.
3. Search preserves stable identities and parent/child semantics.
4. All existing action/API contracts and trust/reload behavior remain intact.
5. Refresh and async actions never leave stale or blank detail state.
6. Loading, empty, busy, success, error, and diagnostics states are accessible.
7. Touch targets are at least 44px and there is no overflow at required viewports.
8. i18n keys in `en.ts` and `zh-CN.ts` remain synchronized.
9. Focused tests, TypeScript, lint, and diff checks pass; any baseline full-suite failures are documented.
