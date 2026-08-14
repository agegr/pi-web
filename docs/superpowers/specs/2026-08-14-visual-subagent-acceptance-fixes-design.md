# Visual Subagent Acceptance Fixes Design

**Date:** 2026-08-14
**Scope:** `76d70edb708834427ffc2127e029f0a12cbb47dd..7f3cf764979ba86af9779aff766d8eb1d631066a` plus the four tracked local changes.

## Goal

Make visual subagent sessions safe to expose, correct under root/session changes, accessible in the tree UI, and green under the repository acceptance gates.

## Approach

Use one implementation plan with four ordered phases. Phase 1 is the release-blocking security boundary. Phase 2 fixes server/client tree consistency and selection behavior. Phase 3 fixes the visible tree contract and responsive interaction. Phase 4 makes the test suite and workspace checks trustworthy. Each phase must have focused tests before the next phase starts.

The browser continues to submit only `action`, `childSessionId`, and an optional message. The server remains responsible for resolving the child run address from durable session metadata and the root-owned relationship.

## Security Contract

`POST /api/agent/[id]/subagents` returns only a public DTO:

```ts
{
  success: true,
  data: {
    action: "steer" | "interrupt" | "resume",
    childSessionId: string,
    tree?: SubagentTreeResponse
  }
}
```

The upstream control result is never serialized. Errors continue to expose only the existing public error code/message mapping; internal paths, async directories, session files, capability tokens, inboxes, and intercom targets are excluded.

The existing reserved `subagent-*` session-name format remains a compatibility input, but it is no longer freely forgeable through the web rename route. A normal primary/fork session cannot be renamed into the reserved format, and an identified subagent cannot be renamed out of it. The PATCH route must evaluate the current relation before applying a name change. Tests cover both directions and verify that a forged child cannot pass `findOwnedSubagent` and reach `client.control`.

## Tree Consistency Contract

`useSubagentTree` resets visible tree/error state when `rootId` changes, invalidates the previous generation, and prevents an old request from publishing into the new root. In-flight request coalescing remains for the same root.

A successful control response containing a tree is applied directly as the authoritative snapshot. A second GET is used only when the response has no tree. This removes duplicate status calls without changing the fallback behavior for a failed follow-up status request.

The breadcrumb root uses the actual root session ID. Selecting any tree node or breadcrumb closes the subagent panel on desktop and mobile, then restores focus to the session/tree trigger after the transcript selection settles.

## UI Contract

The tree uses semantic ARIA structure:

- `role="tree"` owns rows.
- Each row is a focusable `role="treeitem"` with `aria-level`, `aria-setsize`, `aria-posinset`, and `aria-expanded` only when it has children.
- Nested children are grouped by `role="group"`.
- Disclosure controls are real buttons with accessible labels and do not participate as fake tree rows.
- Arrow Left moves to the parent or collapses the current row; Arrow Right expands or moves to the first child; Arrow Up/Down move among visible rows.

Each durable/live row displays the safe agent label and bounded task summary. The activity marker is derived from `hasActiveDescendant`, not from RPC capability availability. Error content and composer controls remain inside a shrinkable layout with a minimum 44px interactive target on mobile.

## Test and Gate Contract

Add or update tests for the security DTO, reserved-name protection, root-switch stale response handling, control-response snapshot application, breadcrumb root selection, focus/panel closing, ARIA tree keyboard behavior, task/agent labels, and active-descendant marking.

Update the brittle composer source assertion to accept the intentional streaming class expression while retaining the actual class contract. Remove the committed EOF whitespace in the route. Full-suite commands must run with `PI_WEB_PASSWORD` unset and without a repository `.output`; build/pack commands remain prohibited by `AGENTS.md`.

Acceptance requires:

- focused subagent tests pass;
- full Node test suite passes with no environment-generated failures;
- `tsc --noEmit` passes;
- lint has zero errors;
- real-extension smoke covers GET and at least one control response privacy assertion;
- Playwright desktop/mobile subagent E2E passes;
- `git diff --check` passes for the complete implementation range.

## Out of Scope

No production build or pack command. No new UI framework, state-management library, or generic tree component. No redesign of unrelated sidebar/dialog/composer behavior beyond the failing acceptance contracts. No deletion of existing user-generated workspace artifacts during implementation.
