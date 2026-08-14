# Visual Subagent Sessions Design

## Summary

Add a DeepSeek Harness-inspired subagent experience to Pi Web. A parent session header shows the total descendant count and live activity, opens a recursive subagent tree, and lets the user navigate into a child transcript in the main conversation area. Active children support acknowledged steering, soft interruption, and continuation after a pause.

The feature combines two authoritative sources:

- Pi session metadata provides durable parent/child history and transcript navigation.
- The installed `pi-subagents` extension's in-process RPC v1 provides live status and control.

Pi Web must not infer runtime state from terminal text or read private `.pi-subagents` artifact files directly.

## Goals

- Keep all direct and nested subagent sessions reachable from their root parent session.
- Show agent name, task summary, lifecycle state, current activity, and authoritative elapsed time when available.
- Navigate into a child transcript without opening a side-by-side panel or adding cards to the parent transcript.
- Support `steer`, soft `interrupt`, and `resume` after a pause through the official `pi-subagents` RPC.
- Preserve historical browsing when `pi-subagents` is absent, incompatible, or temporarily unavailable.
- Match Pi Web's quiet Codex-style visual language and WCAG 2.1 AA target.

## Non-goals

- No Trajectory event ledger in the first version.
- No full-screen agent topology canvas.
- No inline subagent cards in the parent transcript.
- No persistent model, thinking, token, or tool-count columns in the tree.
- No retry, restart, batch controls, hard stop, scheduling, mission management, or subagent creation UI.
- No direct parsing of terminal output, tool-result prose, `status.json`, or `events.jsonl`.
- No new dependency or parallel state store.

## DeepSeek Harness Reference

The design was compared against DeepSeek Harness commit `47f943859bef60e4160492346772ded9b24f765a`:

- `packages/client/ui-subagent/src/client/SubagentCatalogAction.tsx` and its CSS: header count trigger, recursive lazy tree, descendant activity, row metrics, keyboard behavior, and child navigation.
- `packages/client/ui-subagent/src/client/SubagentReadOnlyComposer.tsx`: reason-specific read-only child composer.
- `packages/client/ui-subagent/README.md`: direct-catalog authority, recursive descendants, inactive history, continuation, interrupt semantics, and known limitations.
- `apps/web/tests/subagent-conversation.e2e.ts` and `apps/web/tests/snapshots/subagent-conversation/*.expected.md`: hierarchy breadcrumb, nested sessions, catalog snapshots, and same-pane child transcript.
- `apps/web/tests/subagent-interrupt-ui.e2e.ts`: an independent current-turn stop action.
- `packages/sdk/protocol/src/types.ts`: explicit parent/child and lifecycle protocol concepts.

Pi Web will reuse the interaction model, not the Cordis plugin architecture or DSH's native subagent catalog. Pi already has durable JSONL session relationships, while live execution belongs to the separate `pi-subagents` extension.

## User Experience

### Parent Header

A parent session with known descendants shows a compact `N sub agents` button in the existing conversation header. If any descendant is active, the button includes the existing ongoing state marker. The button does not appear when no durable or live descendants are known.

Activating the button opens a popover anchored below it:

- Desktop: 336-360px wide, overlays the transcript, and does not shift layout.
- Mobile: nearly full viewport width below the header, still overlays content.
- Clicking outside or pressing `Escape` closes it and restores focus to the trigger.
- The existing sidebar running-descendant count remains a compact indicator; the recursive tree does not move into the sidebar.

### Recursive Tree

The popover uses semantic `tree`, `treeitem`, and `group` roles. Each row contains:

- disclosure control when the node has children;
- lifecycle state marker;
- resolved agent name;
- one-line task summary;
- current activity or lifecycle label;
- authoritative elapsed time when the status snapshot provides enough timing data.

The tree preserves completed and inactive history. Nested descendants are recursively expandable. `ArrowRight` and `ArrowLeft` expand or collapse, `ArrowUp` and `ArrowDown` move through visible rows, `Home` and `End` jump, `Enter` opens, and `Escape` closes.

A live run that exists before its child session file is discoverable appears as a disabled `Starting` placeholder. It becomes an ordinary row in place after the session appears.

### Same-pane Child Navigation

Selecting a row closes the popover and opens the existing child session transcript in the main chat area. The normal URL/session selection path remains authoritative so browser history and refresh work.

The conversation header becomes a breadcrumb containing the full parent chain. Each ancestor is a button; the current child is not. The main transcript is not wrapped in a card and no parent/child split view is introduced.

### Child Composer

A subagent transcript never sends a normal prompt directly to the child session wrapper.

- `running` or `queued`: the composer remains available and submit calls RPC `steer` for the selected `runId + index`; queued delivery may return a scheduled acknowledgement.
- stop icon while running: calls RPC `interrupt`, which cancels the current turn and leaves the run paused.
- `paused`: the composer changes its submit label to continuation and calls RPC `resume` with the message.
- completed, stopped, failed, rejected, inactive-only history, or unavailable RPC: transcript is read-only.

The stop control is a square icon button with a tooltip and accessible label. Soft interrupt needs no confirmation because it is explicitly resumable. Hard stop is not exposed in this version.

## Architecture

### 1. Hidden Inline RPC Bridge

Pi Web injects a hidden inline extension through the supported SDK option `resourceLoaderOptions.extensionFactories` whenever it creates session services. The factory captures that session's `pi.events` bus and exposes a process-local bridge handle to its `AgentSessionWrapper`.

The bridge:

- performs `ping` capability negotiation;
- sends v1 request envelopes on `subagents:rpc:v1:request`;
- subscribes to the per-request reply channel;
- correlates replies by generated request ID;
- applies a bounded timeout;
- removes every subscription after reply, timeout, wrapper shutdown, or resource reload;
- registers no model-facing tool, command, prompt content, widget, or UI.

The bridge is an application adapter, not another subagent implementation. If no extension answers `ping`, the wrapper reports RPC unavailable without failing session startup.

### 2. Parent Wrapper Ownership

All status and control requests execute through the root parent session's wrapper, not the selected child wrapper. The API reuses a live root wrapper or resolves its session file and starts it without prompting the model.

This is necessary because `pi-subagents` scopes RPC status and control to the owning parent session. It also keeps the browser from controlling runs owned by another session.

### 3. Durable History

The existing session list remains the durable source for:

- `parentSessionId`;
- `rootSessionId`;
- `subagentAgent`;
- `subagentRunId`;
- `subagentIndex`;
- title, timestamps, and transcript identity.

`attachSessionRelations()` continues to classify subagent session names. The new projection preserves direct `parentSessionId` links so nested nodes are rendered under their immediate parent, not flattened under the root.

### 4. Live Status Projection

One RPC `status` snapshot is requested per root refresh. The server normalizes the tool result `details` into a bounded web response and merges it with durable sessions by `(runId, index)`. It must ignore unknown future fields.

The browser never receives `asyncDir`, status-file paths, process control paths, permission artifacts, or opaque internal handles.

### 5. Active Child Transcript Reading

An active child process writes its own JSONL session. Pi Web must not start another `AgentSession` for that child while it is running or paused.

While an active child is selected, the client periodically reloads its durable session context through the existing read-only session endpoint. This updates assistant text and tool calls without acquiring child-process ownership. Input, interrupt, and resume always route through the root parent's subagent API.

When the child becomes terminal, polling stops after one final transcript refresh.

## API Contract

Use one resource route to minimize surface area:

- `GET /api/agent/[rootId]/subagents`
- `POST /api/agent/[rootId]/subagents`

The TanStack route delegates to the shared handler following the repository's existing adapter pattern.

### GET Response

```ts
type SubagentLifecycleState =
  | "starting"
  | "queued"
  | "running"
  | "needs_attention"
  | "paused"
  | "complete"
  | "stopped"
  | "failed"
  | "rejected"
  | "inactive";

interface SubagentTreeNode {
  sessionId: string | null;
  parentSessionId: string;
  runId: string;
  index?: number;
  agent: string;
  task: string;
  state: SubagentLifecycleState;
  activity?: string;
  startedAt?: number;
  elapsedMs?: number;
  canSteer: boolean;
  canInterrupt: boolean;
  canResume: boolean;
  children: SubagentTreeNode[];
}

interface SubagentTreeResponse {
  rootSessionId: string;
  rpcAvailable: boolean;
  unavailableReason?: "not-installed" | "incompatible" | "offline";
  nodes: SubagentTreeNode[];
  polledAt: number;
}
```

`inactive` means only that durable history exists without an authoritative live outcome. The server must not translate it to success. Timing fields are omitted rather than estimated from unrelated session modification times.

### POST Request

```ts
interface SubagentControlRequest {
  childSessionId: string;
  action: "steer" | "interrupt" | "resume";
  message?: string;
}
```

The server resolves `childSessionId` from the current session inventory, verifies that it belongs to `[rootId]`, derives `runId` and `index`, and sends only those server-derived identifiers to RPC. `steer` and `resume` require a non-empty trimmed message; `interrupt` rejects a message.

The response returns the normalized RPC acknowledgement and a fresh affected-node state when available. The client does not optimistically mark a control successful.

## Client Components

### `SubagentHeaderAction`

Owns trigger focus, popover visibility, responsive placement, outside-click close, and tree keyboard entry. It receives a normalized tree; it does not fetch or interpret RPC data.

### `SubagentTree`

Renders recursive nodes, disclosure state, accessible labels, and row selection. Expansion is local UI state. The tree shows task, state/activity, and elapsed time only; model, thinking, tokens, and tool counts remain out of the persistent row.

### `SessionBreadcrumb`

Builds the selected subagent's ancestor chain from the session inventory and calls the existing session selection action. It is also used when the selected node is nested more than one level deep.

### `useSubagentTree`

Owns fetch, last-good snapshot, polling eligibility, and control calls for the selected root. Polling runs only while:

- the tree is open;
- a subagent session under the root is selected; or
- the last snapshot contains an active descendant.

The initial interval is 1.5 seconds. Concurrent refreshes are coalesced and stale responses are ignored with a monotonic request generation.

### Child Transcript Mode

`ChatWindow` receives a subagent mode descriptor when the selected session is a subagent. In that mode:

- read-only context loading remains active;
- active transcript polling is enabled;
- ordinary direct-agent send is disabled;
- composer actions delegate to `useSubagentTree` control methods;
- normal parent and fork sessions retain existing behavior.

## State Merge Rules

1. Durable session ancestry defines the tree whenever a session exists.
2. Exact RPC `(runId, index)` state overrides only lifecycle, activity, timing, and capabilities.
3. A live RPC child without a durable session becomes a disabled starting placeholder.
4. A durable node without matching RPC state is `inactive`.
5. An RPC snapshot must never delete durable nodes.
6. A failed refresh retains the last good live snapshot and marks it stale until recovery.
7. A newly discovered terminal state triggers one final session-list and child-transcript refresh.

## Error and Degraded States

- **Extension absent:** show the durable tree; hide live marker and disable composer controls.
- **RPC version incompatible:** same durable fallback, with a localized unavailable tooltip.
- **Root session cannot be loaded:** keep history available and mark controls offline.
- **Status timeout:** retain last data, show a quiet stale indicator, and retry on the normal interval while polling remains eligible.
- **Control rejected:** show the server message in the existing notice area, preserve input for `steer`/`resume`, and do not change local lifecycle state.
- **Child session not yet persisted:** show a disabled starting row.
- **Selected session disappears:** return to the nearest surviving ancestor through the existing session deletion behavior.

Errors do not add permanent transcript messages.

## Security and Integrity

- Browser requests identify a child session, never a run directory or process.
- Server derives root ownership, run ID, and child index from trusted session metadata.
- RPC already enforces current-session ownership; Pi Web keeps that check and adds its own ancestry validation.
- No endpoint returns filesystem artifact paths or arbitrary extension RPC access.
- The bridge allowlists `ping`, `status`, `steer`, `interrupt`, and `resume`; it does not expose `spawn`, `stop`, or future methods automatically.
- Messages are trimmed and bounded using the same request-size conventions as existing agent commands.
- Active child JSONL remains single-writer; Pi Web reads it but never starts a competing child wrapper.

## Accessibility and Responsive Behavior

- The trigger, tree, rows, disclosure buttons, breadcrumb, stop, and send controls all have explicit accessible names.
- Tree keyboard behavior follows the DSH reference and WAI-ARIA tree expectations.
- Focus returns to the trigger on close and moves to the selected conversation after navigation without trapping the user.
- State is conveyed by text as well as color.
- Desktop popover overlays without layout shift; mobile width is constrained to the viewport.
- Long agent names, tasks, and activity text truncate without resizing rows; accessible labels retain the complete bounded text.
- Reduced-motion mode disables spinning status animation while preserving state.

## Testing

### Pure Logic

- recursive durable ancestry and nested ordering;
- `(runId, index)` matching and precedence;
- live placeholder promotion to durable session;
- inactive history without fabricated outcomes;
- last-good snapshot retention and stale-response rejection;
- polling eligibility transitions.

### RPC Bridge

- `ping` negotiation and method allowlist;
- request/reply correlation;
- timeout and late-reply handling;
- subscription cleanup on success, timeout, reload, and shutdown;
- absent and incompatible extension behavior;
- control error propagation.

### API

- root wrapper reuse and read-only startup;
- nested child ownership resolution;
- server-derived run ID and index;
- rejection of forged, cross-root, missing, and non-subagent child IDs;
- normalized response excludes artifact paths;
- `steer`, `interrupt`, and `resume` parameter validation.

### Components

- descendant count and running marker;
- recursive disclosure and loading placeholders;
- complete keyboard navigation and focus restoration;
- full breadcrumb navigation;
- running, paused, inactive, stale, and unavailable composer states;
- exact routing to `steer`, `interrupt`, or `resume`;
- preservation of typed text on control failure.

### End-to-end and Visual

A deterministic fixture covers a root parent, parallel children, and one nested child. Browser tests verify:

- opening the catalog and navigating to each depth;
- active child transcript refresh without starting a child wrapper;
- soft interrupt to paused;
- resume with a message;
- terminal history remaining navigable;
- durable fallback when RPC is unavailable;
- desktop popover and mobile overlay geometry;
- no content shift, overflow, overlap, inaccessible control, or console error.

Run focused tests first, then `npm test`, `npm run lint`, and `node_modules/.bin/tsc --noEmit`. Per repository guidance, do not run `npm run build` or `npm run pack:tanstack` during development.

## Acceptance Criteria

- A parent header exposes every durable direct and nested subagent descendant.
- Any running descendant is visible from both the parent header and its tree row.
- Clicking a row opens that child transcript in the main conversation area with a correct ancestor breadcrumb.
- Active transcript updates appear without creating a competing child AgentSession.
- Steering receives an RPC acknowledgement; soft interruption reaches `paused`; a continuation message resumes the child.
- Refresh, extension absence, and RPC failure preserve historical navigation.
- No client can control a run outside the selected root session.
- Desktop and mobile layouts pass focused accessibility and visual checks.
