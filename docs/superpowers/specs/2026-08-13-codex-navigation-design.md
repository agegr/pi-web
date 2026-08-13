# Codex Navigation Design

## Goal

Make project and session navigation behave more like Codex without replacing the existing project tree or introducing a new dependency.

## Scope

- The sidebar search matches visible project names/paths and session titles/first messages.
- A native `dialog` quick switcher opens with `Meta+K` or `Ctrl+K`.
- Quick-switch results are grouped as projects and sessions; choosing a project selects it, and choosing a session opens it through the existing callbacks.
- Arrow keys move the active result, `Enter` chooses it, and `Escape` closes the dialog and restores focus to its trigger.
- The dialog is responsive and uses the existing design tokens and translations.

## Non-goals

- No command execution palette, fuzzy-search dependency, or server-side search endpoint.
- No changes to project/session persistence or the existing context menus.
- No changes to the unrelated working-tree, file explorer, or settings flows.

## Architecture

`CodexSidebar` remains the single source of truth for loaded projects and sessions. A small pure search projection derives project and session results from the existing `projects` and `visibleSessions` arrays. The sidebar filter uses that projection to keep matching projects expanded and to suppress non-matching rows. The quick switcher reuses the same projection and calls `setSelectedCwd`, `selectSession`, or the existing project/session callbacks.

The quick switcher uses the platform `<dialog>` element through a ref. It is opened from the sidebar search affordance and the global keyboard handler in `CodexSidebar`; focus is trapped by the browser's modal dialog behavior, with an explicit input focus and trigger restoration on close.

## Acceptance Criteria

1. A query matching only a session title displays that session and its project in sidebar results.
2. `Meta+K` and `Ctrl+K` open the switcher unless focus is already in a text input, textarea, or contenteditable element.
3. The switcher supports keyboard navigation and selecting a result closes it.
4. Empty queries show pinned projects first, then recent projects and recent sessions without duplicate rows.
5. English and Simplified Chinese labels are present and synchronized.
6. Existing sidebar project actions and session selection continue to work.

