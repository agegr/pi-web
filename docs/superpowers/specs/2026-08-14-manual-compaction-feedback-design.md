# Manual Compaction Feedback Design

## Problem

Manual context compaction currently closes the composer menu immediately. The only running-state label remains inside that closed menu, while the completion banner is visually light and disappears after six seconds. A user can therefore miss both the start and completion of the operation.

## Goals

- Make manual compaction visibly start as soon as it is requested.
- Keep the stop action available while compaction is running.
- Report the token reduction after success.
- Keep failures visible and dismissible.
- Use the existing quiet Codex-style composer feedback area.

## Non-goals

- No modal, toast, progress percentage, or permanent transcript message.
- No changes to compaction execution, server APIs, or automatic compaction behavior.
- No new shared notification system or component abstraction.

## Interaction

The feedback appears directly above the composer, in the same slot as the existing compaction result and error messages.

### Running

- Show a restrained inline status row immediately after the command starts.
- Use a spinning activity icon and the text `Compacting context...`.
- Keep a `Stop` action aligned at the trailing edge.
- If the overflow menu is reopened, its existing item continues to read `Stop compaction`.
- Announce the state through `role="status"` and `aria-live="polite"`.

### Success

- Replace the running row in place with a check icon and `Context compacted`.
- Show the measured result as `191k -> 42k · 149k freed`, using the values already returned by the compact command.
- Keep the result visible for ten seconds, then remove it without shifting focus.
- Let the conversation context card refresh normally; do not animate or call extra attention to it.

### Failure

- Replace the running row with the existing error treatment and `role="alert"`.
- Keep the error visible until the next compaction attempt, session change, or an explicit dismiss action.
- The dismiss action is an icon button with an accessible label.

### Responsive Behavior

- The status text may wrap on narrow screens while the action remains reachable.
- Stop and dismiss controls use the project's coarse-pointer target sizing.
- Reduced-motion mode replaces the spinning icon with a static activity icon.

## Implementation Boundary

Reuse `isCompacting`, `compactResult`, and `compactError` from `useAgentSession`. `ChatInput` renders the four states: absent, running, success, and failure. Add only a small clear-feedback callback if needed for explicit dismissal. No server or session-file changes are required.

The existing compaction result formatter remains responsible for token counts. The success timeout changes from six to ten seconds. Starting a new compaction clears the previous result or error before showing the running state.

## Verification

- Starting compaction shows the running row in the same render cycle that closes the menu.
- Stop remains available and invokes the existing abort handler.
- Success shows before, after, and freed token counts for ten seconds.
- Failure remains visible until retried, dismissed, or the session changes.
- Screen readers receive one running announcement and one terminal announcement.
- Desktop, narrow mobile, keyboard focus, coarse-pointer targets, and reduced-motion behavior are covered by focused component tests.
