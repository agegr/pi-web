# Visual Subagent Sessions Handoff

## Objective

Implement the approved Visual Subagent Sessions feature for Pi Web:

- complete recursive root-scoped subagent tree, including historical nodes;
- fixed top-bar popover with no transcript layout shift;
- same-page child transcript navigation with complete breadcrumbs;
- live lifecycle, activity, and elapsed time;
- steer, resumable soft interrupt, and resume only;
- no child `AgentSession`, hard stop, retry, batch control, trajectory, or full-screen topology.

## Read First

1. Approved specification:
   `docs/superpowers/specs/2026-08-14-visual-subagent-sessions-design.md`
2. Executable plan:
   `docs/superpowers/plans/2026-08-14-visual-subagent-sessions.md`
3. Pi Web repository guidance:
   `AGENTS.md`
4. Upstream protocol source:
   `/tmp/pi-subagents-upstream/src/extension/rpc.ts`
5. Upstream RPC tests:
   `/tmp/pi-subagents-upstream/test/unit/rpc.test.ts`
6. Upstream runtime state types:
   `/tmp/pi-subagents-upstream/src/shared/types.ts`

Do not start implementation from this handoff alone. The plan contains the TDD order, exact files, API contract, commands, and commit boundaries.

## Fixed Baselines

- Pi Web repository: `/Users/kale/pi-web`
- Pi Web planning baseline observed: `e55230acddc06bdcdf9a7f6e02085bb214c495ba`
- Approved spec commits already in history: `7a41bc3`, `1b2c792`
- Upstream `pi-subagents` inspection revision: `de92e5033d558901c0502286fa2ec5281831696b`
- Installed `/Users/kale/pi-subagents` version: `0.41.0`
- Installed directory is not the source repository and must not be edited.

If Pi Web HEAD advances before execution, create the implementation worktree from the then-current branch and preserve all newer user commits.

## Required Repository Layout

Create a real source clone and two isolated worktrees:

```bash
git clone https://github.com/nicobailon/pi-subagents.git /Users/kale/pi-subagents-src
git -C /Users/kale/pi-subagents-src checkout de92e5033d558901c0502286fa2ec5281831696b
npm --prefix /Users/kale/pi-subagents-src install
git -C /Users/kale/pi-subagents-src worktree add /Users/kale/.local/share/pi-worktrees/pi-subagents/visual-run-status -b feat/visual-run-status
git -C /Users/kale/pi-web worktree add /Users/kale/.local/share/pi-worktrees/pi-web/visual-subagent-sessions -b feat/visual-subagent-sessions
```

Do not create either worktree on top of the current dirty Pi Web directory.

## Start Here

Execute Task 1 in the plan first. The first production change is the additive `pi-subagents` capability:

```ts
ping.capabilities.runStatus = { version: 1 }
```

Successful `status` replies then include:

```ts
runs: {
  version: 1,
  entries: SubagentRpcRunEntry[],
  total: number,
  omitted: number,
}
```

Write the failing upstream RPC tests before changing `src/extension/rpc.ts`.

Do not begin Pi Web UI work until the projection tests, upstream unit suite, and upstream typecheck pass.

## Critical Source Facts

### Upstream state shapes

Use the actual upstream field names:

- foreground address: `ForegroundRunControl.runId + ForegroundChildControl.index`;
- async address: `AsyncJobState.asyncId + step index`;
- nested run ID: `NestedRunSummary.id`;
- nested parent index: `NestedRunSummary.parentStepIndex`;
- nested child sessions: indexed `NestedRunSummary.steps`;
- top-level activity state currently includes `active_long_running` and `needs_attention`;
- `fleetJobs` retains current/recent async runs and is needed for a final terminal snapshot.

Apply root `sessionId` ownership checks to top-level controls/jobs. Do not reject nested summaries because their own `sessionId` identifies the nested owner session; nested ownership is inherited from the validated top-level container.

### Existing Pi Web child-state hazard

`hooks/useAgentSession.ts` currently mounts a persisted session with:

```ts
loadSession(session.id, true, true)
```

The third argument fetches `/api/sessions/[id]/state`. That state route calls `startRpcSession()` when no wrapper exists. Therefore `sessionRunning={false}` does not make child viewing safe.

The child mode must explicitly use:

```ts
loadSession(childId, true, false)
```

Every child refresh must also use `includeState = false`. A selected child must generate no child state request, child agent POST, or child SSE connection.

### Root wrapper behavior

The root wrapper must be reused or started without prompting when tree status/control is requested. This is required because `pi-subagents` scopes ownership to the parent runtime.

Pi Web captures the event bus through a hidden inline extension passed by the public SDK option:

```ts
resourceLoaderOptions.extensionFactories
```

Do not access `extensionRunner.runtime` or another private SDK field.

### Timeout behavior

- unanswered ping: durable tree with `not-installed`;
- missing `runStatus v1`: durable tree with `incompatible`;
- root startup failure: durable tree with `offline`;
- status timeout after successful negotiation: HTTP `504` with a durable `fallback` tree.

The hook retains an existing last-good live snapshot and marks it stale. It adopts the fallback only when no prior snapshot exists. A later successful poll clears stale state.

## Exact Success Contract

The GET success response remains the approved nested contract:

```ts
interface SubagentTreeResponse {
  rootSessionId: string;
  rpcAvailable: boolean;
  unavailableReason?: "not-installed" | "incompatible" | "offline";
  nodes: SubagentTreeNode[];
  polledAt: number;
}
```

Durable-only nodes are `inactive`. Do not call them complete and do not infer timing from session creation/modification timestamps.

Browser control requests contain only:

```ts
{
  childSessionId: string;
  action: "steer" | "interrupt" | "resume";
  message?: string;
}
```

The server derives `runId` and `index`. Never accept a browser run directory, process ID, run ID, child index, capability token, or arbitrary RPC parameters.

## UI Requirements That Must Not Regress

- The tree is complete for the root even when a grandchild is selected.
- Completed/inactive history remains visible.
- The root stays highlighted in the sidebar while a hidden child is displayed.
- The popover is fixed/overlayed and does not alter transcript geometry.
- Desktop and mobile viewport bounds are enforced.
- Tree keyboard behavior implements `ArrowUp`, `ArrowDown`, `ArrowRight`, `ArrowLeft`, `Home`, `End`, and `Enter` with roving focus.
- Focus returns to the trigger on close.
- Running/queued/needs-attention submits steer; running exposes soft interrupt; paused submits resume.
- Terminal/inactive/unavailable children are read-only.
- Rejected control preserves composer input and does not optimistically change lifecycle.

## Test Strategy

Use existing dependency-free Node/jiti tests for pure logic, static markup, and source invariants. Do not claim interactive behavior from `renderToStaticMarkup`.

Add `@playwright/test` as a dev dependency for actual interaction and responsive coverage. The E2E fixture uses:

- temporary `PI_CODING_AGENT_DIR`;
- SDK `SessionManager` to create root/child/grandchild JSONL;
- a temporary fake extension implementing only the event-bus RPC protocol;
- a temp state file for lifecycle transitions.

The isolated agent directory prevents the installed real extension from racing fake replies.

## Forbidden Actions

- Do not run `npm run build`, `npm run build:tanstack`, or `npm run pack:tanstack` in Pi Web.
- Do not edit `/Users/kale/pi-subagents`.
- Do not parse terminal output.
- Do not read `.pi-subagents/status.json` or `events.jsonl` from Pi Web.
- Do not start a child `AgentSession`.
- Do not expose RPC `spawn` or hard `stop`.
- Do not add trajectory, topology, retry, or batch management.
- Do not overwrite, stage, or revert unrelated user changes.

## Current Dirty Workspace

At handoff creation, unrelated Pi Web changes include:

```text
M components/ChatWindow.plan.test.mjs
M components/ChatWindow.tsx
M hooks/useAgentSession.test.mjs
M hooks/useAgentSession.ts
?? .impeccable/
?? .output/
?? .pi-subagents/
?? .tanstack/
?? docs/superpowers/plans/2026-08-13-dscode-desktop-redesign.md
?? pi-web.log
```

These are not part of the planning commit. The implementation worktree avoids them. If later implementation must touch `ChatWindow.tsx` or `useAgentSession.ts`, start from committed branch state and reconcile any newer committed user changes; never copy or revert this dirty working copy wholesale.

## Completion Gate

Before presenting merge/PR choices, produce evidence for:

- upstream projection unit tests and typecheck;
- Pi Web full Node tests, lint, and typecheck;
- Playwright desktop/mobile flows and screenshots;
- root ownership and server-derived target tests;
- no child `/state`, agent POST, SSE, or second writer;
- durable fallback for absent/incompatible/offline extension;
- stale retention on status timeout;
- exact allowlist excluding spawn/hard stop;
- `git diff --check` and clean intended diffs in both worktrees.

Then request independent review separately for the upstream protocol commit and Pi Web implementation branch.
