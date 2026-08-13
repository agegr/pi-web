# Compact Sidebar Header

## Goal

Simplify the CodexSidebar header to match the supplied reference: one prominent new-session action followed by a compact workspace toolbar, with no persistent product branding.

## Design

- Remove the `Pi Web` brand label and refresh action from the persistent header.
- Keep the existing new-session behavior, shortcut, and translated label as a full-width primary button at the top.
- Replace the always-visible project search field with a search icon in the workspace toolbar. Clicking it reveals the existing search input inline; closing or clearing it returns the compact toolbar.
- Add a `工作区`/`Projects` section label on the left of the toolbar.
- Keep project creation and sidebar collapse as icon buttons on the right. Preserve their current handlers and accessible labels.
- Keep the existing project/session list and recent sessions unchanged.

## Responsive Behavior

- Desktop and mobile use the same hierarchy.
- Toolbar icons keep existing touch targets; the expanded search field uses the current input treatment and remains within the sidebar width.
- The header must not introduce horizontal overflow or move the project list below an unnecessary permanent search row.

## Verification

- Update source-contract tests for the removed brand/refresh and compact toolbar.
- Run the focused CodexSidebar/AppShell tests.
- Run a production TypeScript/build check if the focused tests pass.
