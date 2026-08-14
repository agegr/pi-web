# Subagent Right Context Card Design

**Date:** 2026-08-14  
**Status:** Approved direction; implementation pending  
**Scope:** Pi Web TanStack Start workspace only

## Goal

Move the existing subagent session tree from a top-bar-only popover into the desktop workspace's right context gutter, while preserving the current top-bar shortcut, live RPC behavior, read-only child transcripts, and steer / pause / resume controls.

## User Experience

On wide desktop sessions with at least one durable or live subagent:

1. The existing conversation-context card remains at the top of the right gutter.
2. A new compact Subagents card appears directly below it.
3. The card header shows the network icon, localized `Subagents` label, total descendant count, and an active count/status marker when any descendant is active.
4. Each recursive tree row shows:
   - a restrained lifecycle status dot;
   - the agent name and bounded task text;
   - current activity or elapsed time when available;
   - indentation and disclosure affordance for nested children.
5. Clicking a durable child row opens that child transcript in the center workspace. The center transcript remains read-only and keeps its existing breadcrumb and external composer.
6. Starting, steering, pausing, or resuming a child remains owned by the existing root-scoped RPC path. The right card is for visibility and navigation, not for embedding a second control form.
7. The existing top-bar subagent button/popover remains available as a shortcut, especially on narrow desktop and mobile where the right gutter is hidden.

When there are no subagents, the new card is omitted. A durable historical tree remains visible when live RPC is unavailable; a stale live snapshot is indicated inline without replacing the last good tree.

## Visual Direction

Use the existing Pi Web product register: quiet, precise, dense, and familiar.

- Reuse `var(--bg-panel)`, `var(--bg-selected)`, `var(--border)`, `var(--text)`, `var(--text-muted)`, `var(--text-dim)`, and `var(--accent)`.
- Use the same border radius and border treatment as `DesktopConversationContext`; do not add gradients, decorative illustrations, large shadows, or nested card shells.
- Keep the card width controlled by the existing `.desktop-workspace-context` gutter.
- Keep tree rows compact enough for repeated scanning; task text is clamped and activity text ellipsizes.
- Use semantic status colors sparingly: accent for active, muted for inactive/complete, amber for attention/paused, and red only for failed state.
- Add visible `:focus-visible` treatment for row buttons and disclosure controls.
- Respect `prefers-reduced-motion`; disclosure and progress transitions must stop or become instant.

## Architecture

`AppShell` remains the state owner. The implementation composes existing pieces rather than introducing a second data path:

- `useSubagentTree` continues to own root-scoped polling, stale state, transcript refresh generation, and control requests.
- `SubagentTree` remains the recursive tree renderer and selection surface.
- Add a presentational `DesktopSubagentCard` beside the existing subagent primitives in `components/SubagentSessions.tsx` (or a focused adjacent component if the file's existing responsibility boundary requires it).
- `AppShell` composes `DesktopConversationContext` and `DesktopSubagentCard` inside the existing `desktopAside` slot using an unstyled vertical stack wrapper.
- `ChatWindow` and `DesktopConversationContext` keep their current contracts.
- No new API route, RPC method, session runtime, persistence format, or dependency is introduced.

Because the card is visible on wide desktop even while the top popover is closed, the polling eligibility passed to `useSubagentTree` must include the desktop-card-visible state. This ensures a newly started first child is discovered without requiring the user to open the top popover. Existing mobile/popover polling behavior remains intact.

## Responsive Behavior

- Wide desktop: render the stacked context and subagent cards when the existing right-gutter container query makes the aside visible.
- Narrow desktop and mobile: do not render the right-gutter card; retain the top-bar/mobile popover and current session transcript behavior.
- Do not alter sidebar or right file-panel widths, overlay history behavior, or mobile back-button handling.
- The card must not change the center workspace width outside the existing right-gutter allocation.

## Accessibility

- The card is an `aside` with a localized accessible label.
- Reuse the existing `role="tree"`, `role="treeitem"`, `aria-level`, `aria-expanded`, `aria-selected`, and roving keyboard behavior.
- Row buttons have accessible names containing the task text and state/activity summary.
- Disclosure and selection remain keyboard reachable; focus returns to the triggering top-bar control when the popover closes.
- Disabled live placeholders remain visibly disabled and are not selectable.

## Error and Compatibility Behavior

- `rpcAvailable === false`: render the durable tree as read-only and keep the compatibility reason/stale text available to the user.
- HTTP 504 or transient RPC failure: keep the last good snapshot, mark stale, and do not clear visible rows.
- No snapshot or no nodes: omit the card rather than showing an empty decorative panel.
- A control error remains in the existing child composer; the card must not optimistically change lifecycle state.
- Root ownership, child-session authorization, and no-child-runtime rules remain unchanged.

## Testing and Acceptance

The change is accepted only when:

1. Existing subagent RPC, tree merge, route, hook, read-only transcript, and UI tests remain green.
2. A component/source test proves the desktop aside composes context first and the subagent card second when nodes exist, and omits the subagent card when there are none.
3. A component test proves recursive rows, active count, stale state, selection, and localized accessible labels are rendered.
4. A hook/AppShell test proves wide-desktop card visibility keeps polling eligible even when the top popover is closed.
5. TypeScript and ESLint pass.
6. Playwright verifies the card at a wide desktop viewport, verifies a child row navigates to the read-only transcript, and verifies the right card is absent while the existing top/mobile entry remains usable at a narrow viewport.
7. No unrelated working-tree changes are staged or modified.

## Non-goals

- No full-screen topology or trajectory view.
- No chat-style inline subagent cards.
- No second `AgentSession` for a child session.
- No parsing terminal text or private `.pi-subagents` artifacts.
- No migration away from TanStack Start.
- No redesign of the existing conversation-context card.
