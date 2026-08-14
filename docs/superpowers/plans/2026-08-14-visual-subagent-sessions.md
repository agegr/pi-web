# Visual Subagent Sessions Implementation Plan

> **For implementer:** Use `superpowers:executing-plans` task by task, `superpowers:test-driven-development` before each behavior change, and `superpowers:verification-before-completion` before every completion claim.

**Goal:** Add a complete root-scoped subagent session tree to Pi Web, open child transcripts in the existing chat workspace, and expose live steer, soft-interrupt, and resume controls through the owning root session's `pi-subagents` RPC bridge.

**Architecture:** Add an optional `runStatus v1` projection to upstream `pi-subagents`. Pi Web injects a hidden inline extension into every root `AgentSession` to capture that session's public `pi.events` bus, negotiates the projection, and exposes one root-scoped API. The API merges durable session ancestry with live state. Child JSONL is read through the existing session GET route in an explicit read-only mode that never calls the child state route, opens child SSE, or creates a child `AgentSession`.

**Tech Stack:** TypeScript, React 19, TanStack Start/Vite, Node test runner, jiti, Pi SDK inline extensions/event bus, lucide-react, Playwright.

**Approved spec:** `docs/superpowers/specs/2026-08-14-visual-subagent-sessions-design.md`

---

## Repository Setup

This feature spans two repositories. `/Users/kale/pi-subagents` is an installed package snapshot (`0.41.0`) without Git history or the upstream test layout. Do not edit it.

1. Create a real upstream source clone pinned to the inspected revision:

```bash
git clone https://github.com/nicobailon/pi-subagents.git /Users/kale/pi-subagents-src
git -C /Users/kale/pi-subagents-src checkout de92e5033d558901c0502286fa2ec5281831696b
npm --prefix /Users/kale/pi-subagents-src install
```

If the clone already exists, verify `git status --short` and the pinned HEAD before reusing it.

2. Create isolated worktrees:

```bash
git -C /Users/kale/pi-subagents-src worktree add /Users/kale/.local/share/pi-worktrees/pi-subagents/visual-run-status -b feat/visual-run-status
git -C /Users/kale/pi-web worktree add /Users/kale/.local/share/pi-worktrees/pi-web/visual-subagent-sessions -b feat/visual-subagent-sessions
```

3. Keep commits separate by repository. Do not vendor `pi-subagents` into Pi Web.

4. Never run `npm run build`, `npm run build:tanstack`, or `npm run pack:tanstack` in Pi Web. Use targeted tests, `npm test`, `npm run lint`, and `npx tsc --noEmit`.

---

## Task 1: Add `runStatus v1` to `pi-subagents`

**Repository:** `/Users/kale/.local/share/pi-worktrees/pi-subagents/visual-run-status`

**Files:**
- Modify: `src/extension/rpc.ts`
- Test: `test/unit/rpc.test.ts`

### Step 1: Write failing capability and projection tests

Extend the existing ping test:

```ts
assert.deepEqual((reply as any).data.capabilities?.runStatus, { version: 1 });
```

Add `projects current-session addressable run status without private handles`. Use real `SubagentState` shapes:

- `foregroundControls`: `runId` plus `activeChildren` keyed by child index;
- `foregroundRuns`: recent/resumable child records;
- `asyncJobs` and `fleetJobs`: `asyncId`, `status`, and indexed `steps`;
- nested records: `NestedRunSummary.id`, `parentRunId`, `parentStepIndex`, and indexed `steps`;
- one foreign `sessionId` record;
- private fields including `asyncDir`, `sessionFile`, `pid`, `description`, `capabilityToken`, and callbacks.

Assert the public shape:

```ts
assert.deepEqual((reply as any).data.runs, {
  version: 1,
  entries: [
    {
      runId: "317e1ca0",
      index: 2,
      agent: "worker",
      state: "running",
      activityState: "active_long_running",
      currentTool: "bash",
      currentPath: "/repo",
      startedAt: 100,
      lastActivityAt: 120,
      updatedAt: 125,
    },
    {
      runId: "76fa6d64-6031-4824-8a88-1282c22d9afa",
      index: 0,
      agent: "reviewer",
      label: "Review",
      state: "paused",
      startedAt: 200,
      endedAt: 260,
      updatedAt: 260,
    },
    {
      runId: "12ab34cd",
      index: 1,
      parentRunId: "76fa6d64-6031-4824-8a88-1282c22d9afa",
      parentIndex: 0,
      agent: "tester",
      state: "running",
      startedAt: 230,
      updatedAt: 250,
    },
  ],
  total: 3,
  omitted: 0,
});
```

Also assert serialized output excludes `asyncDir`, `sessionFile`, `transcriptPath`, `pid`, `description`, `capabilityToken`, prompt text, and callback fields.

Add focused tests for:

- records from another parent `sessionId` are excluded;
- malformed display text and unsafe timestamps are omitted or sanitized;
- output is capped at 256 entries and reports `total`/`omitted`;
- paused/terminal entries remain visible while retained in `fleetJobs` or `foregroundRuns`;
- nested `parentStepIndex` becomes public `parentIndex`;
- existing `text`, `details`, and `fleet` status fields remain unchanged.

### Step 2: Run and confirm failure

```bash
npm test -- --test-name-pattern='run status|ping|status'
```

Expected: capability assertion fails and `data.runs` is absent.

### Step 3: Add the public types

In `src/extension/rpc.ts`:

```ts
export type SubagentRpcRunState =
  | "queued"
  | "running"
  | "paused"
  | "complete"
  | "failed"
  | "stopped"
  | "rejected";

export interface SubagentRpcRunEntry {
  runId: string;
  index?: number;
  parentRunId?: string;
  parentIndex?: number;
  agent: string;
  label?: string;
  state: SubagentRpcRunState;
  activityState?: string;
  currentTool?: string;
  currentPath?: string;
  startedAt?: number;
  lastActivityAt?: number;
  endedAt?: number;
  updatedAt: number;
}

export interface SubagentRpcRunStatus {
  version: 1;
  entries: SubagentRpcRunEntry[];
  total: number;
  omitted: number;
}
```

Timing is optional because queued/recovered records may not have a valid start time.

### Step 4: Implement adapters for the real runtime shapes

Add `MAX_RUN_STATUS_ENTRIES = 256` and `buildRunStatus(state, sessionId)` beside `buildFleetStatus`.

Use four small adapters inside the helper:

1. `foregroundControls`: emit `control.runId + child.index`; if no `activeChildren`, use `currentIndex`.
2. `foregroundRuns`: emit `run.runId + child.index`, mapping `SubagentResultStatus` to public lifecycle.
3. `asyncJobs` plus `fleetJobs`: emit `job.asyncId + step index`; deduplicate the two maps by address and newest update.
4. Nested summaries: for every `NestedRunSummary`, emit each indexed `steps` entry with `runId = nested.id`, `parentRunId = nested.parentRunId`, and `parentIndex = nested.parentStepIndex`; recurse through both `nested.children` and `step.children`. If a nested summary has no steps, emit its run-level `agent` with no index.

Rules:

- require `state.currentSessionId === sessionId` and matching `sessionId` on top-level `foregroundControls`, `foregroundRuns`, `asyncJobs`, and `fleetJobs`;
- after a top-level container passes that ownership check, accept its nested summaries through the container relationship instead of comparing `NestedRunSummary.sessionId` to the root (that field identifies the nested owner session);
- normalize `completed`/successful foreground terminal statuses to `complete`;
- deduplicate by `runId:index`, preferring newest `updatedAt`/`lastUpdate`;
- sanitize every string through existing display helpers;
- accept only finite, non-negative safe-integer timestamps;
- sort by `startedAt`, then `runId`, then `index`;
- bound candidates and report omission instead of walking arbitrary state indefinitely.

Add capability and status payload:

```ts
capabilities: {
  status: true,
  fleetStatus: { version: 1 },
  runStatus: { version: 1 },
  // existing fields unchanged
}
```

```ts
return {
  ...status,
  fleet: buildFleetStatus(options.state, fleetKeys, sessionId),
  runs: buildRunStatus(options.state, sessionId),
};
```

Do not add a new RPC method.

### Step 5: Verify and commit

```bash
npm test -- --test-name-pattern='run status|ping|status'
npm test
npm run typecheck
git diff --check
git add src/extension/rpc.ts test/unit/rpc.test.ts
git commit -m "feat: expose structured subagent run status"
```

---

## Task 2: Capture the root session RPC bus through a hidden inline extension

**Repository:** `/Users/kale/.local/share/pi-worktrees/pi-web/visual-subagent-sessions`

**Files:**
- Modify: `lib/rpc-manager.ts`
- Create: `lib/subagent-rpc.ts`
- Create: `lib/subagent-rpc.test.mjs`
- Modify: `lib/rpc-manager.test.mjs`

### Step 1: Write failing bridge tests

Create `lib/subagent-rpc.test.mjs` with a fake event bus. Cover:

- the inline extension is `{ name, hidden: true, factory }` and captures `pi.events` only;
- reply subscription happens before request emit;
- matching version/request ID/method is required;
- RPC errors preserve public error code/message and identify timeout stage (`ping` versus `status`/control);
- timeout unsubscribes;
- `runStatus v1` is required before `status` or controls;
- compatible negotiation is cached for the wrapper lifetime;
- unavailable/incompatible negotiation uses a bounded five-second negative-cache TTL so polling can recover after extension availability changes;
- wrapper resource reload invalidates capability state, rejects pending requests, and removes every reply subscription before extensions reload;
- disposing the client rejects/cleans pending requests permanently;
- exported control method type excludes `spawn` and `stop`.

Extend `lib/rpc-manager.test.mjs` to assert:

- `createAgentSessionServices` receives `resourceLoaderOptions.extensionFactories`;
- the inline extension is hidden;
- the same mutable capture handle is passed to `AgentSessionWrapper`;
- wrapper shutdown disposes the subagent RPC client.

### Step 2: Run and confirm failure

```bash
node --experimental-strip-types --test lib/subagent-rpc.test.mjs lib/rpc-manager.test.mjs
```

Expected: module and inline bridge wiring are absent.

### Step 3: Implement the transport and capture factory

In `lib/subagent-rpc.ts`, define local protocol constants rather than importing extension internals:

```ts
const VERSION = 1;
const REQUEST_EVENT = "subagents:rpc:v1:request";
const REPLY_PREFIX = "subagents:rpc:v1:reply:";
const TIMEOUT_MS = 3_000;

type AllowedMethod = "ping" | "status" | "steer" | "interrupt" | "resume";
```

Export:

```ts
export interface EventBusLike {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}

export interface SubagentRpcCapture {
  events: EventBusLike | null;
}

export function createSubagentRpcCapture(): {
  capture: SubagentRpcCapture;
  extension: InlineExtension;
};

export class SubagentRpcClient {
  constructor(private capture: SubagentRpcCapture);
  getRunStatus(): Promise<SubagentRpcRunStatus>;
  control(method: "steer" | "interrupt" | "resume", params: Record<string, unknown>): Promise<unknown>;
  dispose(): void;
}
```

The inline factory does only this:

```ts
{
  name: "pi-web-subagent-rpc",
  hidden: true,
  factory(pi) {
    capture.events = pi.events;
  },
}
```

It registers no tool, command, prompt, widget, or UI. Validate every reply and run entry as untrusted data; ignore unknown fields.

### Step 4: Inject the extension through the public SDK option

Before `createAgentSessionServices`:

```ts
const subagentRpc = createSubagentRpcCapture();
const services = await createAgentSessionServices({
  cwd: sessionCwd,
  agentDir,
  resourceLoaderOptions: {
    extensionFactories: [subagentRpc.extension],
  },
  ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
});
```

Pass the capture to the wrapper:

```ts
const wrapper = new AgentSessionWrapper(inner, subagentRpc.capture);
```

The client caches a compatible capability for the wrapper lifetime but retries negative results after five seconds. Add `resetForReload()` to clear capability state, reject pending requests, and unsubscribe without permanently disposing the client. `AgentSessionWrapper` calls it immediately before `inner.reload()`; the inline factory refreshes the mutable capture when resources register again. Wrapper destruction calls permanent `dispose()`. Do not access private `extensionRunner.runtime` fields.

### Step 5: Verify and commit

```bash
node --experimental-strip-types --test lib/subagent-rpc.test.mjs lib/rpc-manager.test.mjs
npx tsc --noEmit
git diff --check
git add lib/rpc-manager.ts lib/rpc-manager.test.mjs lib/subagent-rpc.ts lib/subagent-rpc.test.mjs
git commit -m "feat: add hidden subagent rpc bridge"
```

---

## Task 3: Implement the approved durable/live tree contract

**Files:**
- Modify: `lib/api-types.ts`
- Create: `lib/subagent-tree.ts`
- Create: `lib/subagent-tree.test.mjs`

### Step 1: Add the exact API types

```ts
export type SubagentLifecycleState =
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

export interface SubagentTreeNode {
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

export interface SubagentTreeResponse {
  rootSessionId: string;
  rpcAvailable: boolean;
  unavailableReason?: "not-installed" | "incompatible" | "offline";
  nodes: SubagentTreeNode[];
  polledAt: number;
}
```

Do not add a conflicting flat node model or infer terminal success from durable history.

### Step 2: Write failing pure merge tests

Cover:

1. direct child/grandchild become nested `children` using durable `parentSessionId`;
2. durable-only nodes are `inactive`, all controls false, and timing omitted;
3. exact `(runId,index)` live state overrides lifecycle/activity/timing only;
4. unmatched live entries become disabled `starting` nodes with `sessionId: null`;
5. nested live entries attach via `parentRunId/parentIndex`;
6. unrelated forks, another root, and orphan subagents are excluded;
7. cycles/missing parents attach safely to the nearest durable root without recursion loops;
8. status capabilities are derived: running/queued can steer, running can interrupt, paused can resume;
9. `needs_attention` maps from the package activity state;
10. `elapsedMs` uses `polledAt - startedAt` for live non-terminal entries only;
11. stable sibling order uses durable creation time, then live start, then address;
12. failed refresh can rebuild durable nodes without deleting them.

### Step 3: Run and confirm failure

```bash
node --experimental-strip-types --test lib/subagent-tree.test.mjs
```

Expected: missing module.

### Step 4: Implement the pure merge

Export:

```ts
export function buildSubagentTree(input: {
  rootId: string;
  sessions: SessionInfo[];
  runs: SubagentRpcRunStatus | null;
  rpcAvailable: boolean;
  unavailableReason?: SubagentTreeResponse["unavailableReason"];
  polledAt: number;
}): SubagentTreeResponse;

export function findOwnedSubagent(
  rootId: string,
  childSessionId: string,
  sessions: SessionInfo[],
): SessionInfo | null;
```

Use `attachSessionRelations`; do not write another official-name parser. Durable nodes use `session.name || session.firstMessage` as task. Runtime placeholders use bounded agent/label text and never become selectable/control-capable until a durable session exists.

### Step 5: Verify and commit

```bash
node --experimental-strip-types --test lib/subagent-tree.test.mjs lib/session-relations.test.mjs
npx tsc --noEmit
git diff --check
git add lib/api-types.ts lib/subagent-tree.ts lib/subagent-tree.test.mjs
git commit -m "feat: merge durable and live subagent tree"
```

---

## Task 4: Add the root-scoped API and root wrapper startup

**Files:**
- Create: `app/api/agent/[id]/subagents/route.ts`
- Create: `app/api/agent/[id]/subagents/route.test.mjs`
- Create: `src/routes/api/agent/$id/subagents.ts`
- Modify: `lib/rpc-manager.ts`

### Step 1: Write failing route tests

Expose `createSubagentHandlers(deps)` for dependency-injected Node tests while retaining production `GET`/`POST` exports.

GET cases:

- unknown root returns `404`;
- a child ID used as root returns `400`;
- existing live root wrapper is reused;
- absent root wrapper resolves the root file and calls `startRpcSession` without a prompt;
- root startup failure still returns durable nodes with `unavailableReason: "offline"`;
- no RPC reply during `ping` returns durable nodes with `not-installed`;
- missing `runStatus v1` returns durable nodes with `incompatible`;
- timeout after successful capability negotiation returns HTTP `504` with `{ error, fallback: <durable tree> }` instead of a successful inactive replacement;
- compatible status returns the exact nested contract;
- session list uses `{ force: true }` so new child JSONL appears during polling.

POST cases:

- accepts only `steer`, `interrupt`, and `resume`;
- steer/resume require non-empty message;
- interrupt rejects a message;
- rejects missing, foreign-root, orphan, and placeholder child IDs;
- derives `runId/index` from server `SessionInfo`, ignoring browser target fields;
- starts/reuses only the root wrapper;
- capability-checks before control;
- never exposes `spawn`, hard `stop`, retry, or bulk actions;
- returns normalized acknowledgement plus a fresh affected-node state when available;
- maps RPC `not_found`/`invalid_state` to `409`.

### Step 2: Run and confirm failure

```bash
node --experimental-strip-types --test 'app/api/agent/[id]/subagents/route.test.mjs'
```

### Step 3: Add one root wrapper helper

In `lib/rpc-manager.ts`, expose only the ready RPC client:

```ts
async getSubagentRpcClient(): Promise<SubagentRpcClient> {
  await this.waitUntilReady();
  return this.subagentRpcClient;
}
```

Keep root startup in the route dependency layer:

```ts
const existing = getRpcSession(rootId);
if (existing?.isAlive()) return existing;
const file = await resolveSessionPath(rootId);
if (!file) return null;
return (await startRpcSession(rootId, file, undefined)).session;
```

This creates no prompt and no child wrapper.

### Step 4: Implement GET

1. `listAllSessions({ force: true })`, then `attachSessionRelations`.
2. Validate that `[id]` is the durable primary root.
3. Build the durable tree immediately.
4. Reuse/start the root wrapper.
5. Negotiate and read one run-status snapshot.
6. Rebuild the tree with live state.
7. If root startup fails, ping is unanswered, or capability is incompatible, return the approved durable fallback reason.
8. If `status` times out after successful negotiation, return HTTP `504` with `{ error: "subagent status timeout", fallback: durableTree }`. This is an error envelope, not a changed success contract, and lets the client preserve an older live snapshot.

### Step 5: Implement POST

Accept only:

```ts
type SubagentControlRequest = {
  childSessionId: string;
  action: "steer" | "interrupt" | "resume";
  message?: string;
};
```

After ownership validation, send only server-derived fields:

```ts
await client.control(body.action, {
  runId: child.subagentRunId,
  ...(child.subagentIndex !== undefined ? { index: child.subagentIndex } : {}),
  ...(body.action !== "interrupt" ? { message: body.message!.trim() } : {}),
});
```

Never forward arbitrary browser fields.

### Step 6: Add TanStack adapter, verify, and commit

```bash
node --experimental-strip-types --test 'app/api/agent/[id]/subagents/route.test.mjs'
npx tsc --noEmit
git diff --check
git add app/api/agent/'[id]'/subagents/route.ts app/api/agent/'[id]'/subagents/route.test.mjs src/routes/api/agent/'$id'/subagents.ts lib/rpc-manager.ts
git commit -m "feat: add root subagent tree api"
```

---

## Task 5: Add `useSubagentTree` polling and controls

**Files:**
- Create: `hooks/useSubagentTree.ts`
- Create: `hooks/useSubagentTree.test.mjs`

### Step 1: Write tests that fit the existing dependency-free test stack

Test exported pure policy helpers:

```ts
export const SUBAGENT_POLL_INTERVAL_MS = 1_500;

export function shouldPollSubagents(input: {
  treeOpen: boolean;
  childSelected: boolean;
  hasActiveDescendant: boolean;
}): boolean;
```

Active descendants are `starting`, `queued`, `running`, or `needs_attention` only.

Use source assertions for hook wiring, matching existing Pi Web test style:

- immediate refresh on root change;
- monotonic request generation ignores stale responses;
- concurrent refreshes coalesce;
- one 1.5-second timer exists only when policy is true;
- last-good snapshot survives `504`/refresh errors and is marked stale;
- a first `504` with no last-good snapshot adopts only the response's durable `fallback` tree, marked stale;
- control payload contains only action/childSessionId/message;
- control does not optimistically mutate lifecycle;
- success triggers immediate tree refresh;
- terminal discovery increments one final transcript refresh generation.

Interactive behavior is covered in Task 9, not claimed from static Node tests.

### Step 2: Run and confirm failure

```bash
node --experimental-strip-types --test hooks/useSubagentTree.test.mjs
```

### Step 3: Implement the hook

```ts
export function useSubagentTree(input: {
  rootId: string | null;
  treeOpen: boolean;
  childSelected: boolean;
}): {
  data: SubagentTreeResponse | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
  transcriptRefreshGeneration: number;
  refresh(): Promise<void>;
  control(action: "steer" | "interrupt" | "resume", childSessionId: string, message?: string): Promise<void>;
};
```

Preserve the last-good tree on timeout. On a `504`, use `fallback` only when no prior snapshot exists; otherwise retain the prior live snapshot and mark it stale. A later successful response clears stale state. Only increment transcript refresh after successful snapshots and once more when a selected child becomes terminal.

### Step 4: Verify and commit

```bash
node --experimental-strip-types --test hooks/useSubagentTree.test.mjs
npx tsc --noEmit
git add hooks/useSubagentTree.ts hooks/useSubagentTree.test.mjs
git commit -m "feat: poll and control subagent tree"
```

---

## Task 6: Build the tree, breadcrumb, and child composer

**Files:**
- Create: `components/SubagentSessions.tsx`
- Create: `components/SubagentSessions.test.mjs`
- Modify: `components/TaskHeader.tsx`
- Modify: `components/TaskHeader.test.mjs`
- Modify: `lib/i18n/messages/en.ts`
- Modify: `lib/i18n/messages/zh-CN.ts`

### Step 1: Write static and pure component tests

With `renderToStaticMarkup`, test:

- header action accessible name/count/live/pressed state;
- recursive complete tree and `aria-current` selected row;
- ARIA tree/treeitem roles, levels, expansion state, and deterministic roving `tabIndex`;
- disabled starting placeholder;
- each row includes task, lifecycle text, activity, and elapsed time when present;
- breadcrumb renders root and every ancestor as buttons;
- running composer shows textarea/send/soft-interrupt;
- paused composer shows textarea/resume and no interrupt;
- terminal/inactive/unavailable mode is read-only;
- long task text stays in a bounded row container.

Test exported pure helpers for submit action (`steer`, `resume`, or none), elapsed formatting, and ancestor flattening. Do not claim Enter/focus/draft behavior from static SSR; Task 9 covers it in Chromium.

### Step 2: Run and confirm failure

```bash
node --experimental-strip-types --test components/SubagentSessions.test.mjs components/TaskHeader.test.mjs
```

### Step 3: Implement one focused component module

Export:

```ts
export function SubagentHeaderAction(...): ReactNode;
export function SubagentTree(...): ReactNode;
export function SessionBreadcrumb(...): ReactNode;
export function SubagentComposer(...): ReactNode;
```

Use lucide `Network`, `CircleStop`, `Send`, and `ChevronRight`. No new icon package or hand-written SVG.

Popover behavior:

- fixed overlay, never reserves transcript height;
- desktop width `min(440px, calc(100vw - 24px))`;
- mobile width `calc(100vw - 16px)`;
- 8px viewport gutter and internal vertical scroll;
- row hit target at least 36px;
- radius no larger than 8px;
- status uses text/icon plus color;
- full bounded text remains in accessible labels;
- implement a flattened visible-node list with roving focus: `ArrowUp`/`ArrowDown` move one visible row, `Home`/`End` move to the first/last row, `ArrowRight` expands or enters the first child, `ArrowLeft` collapses or moves to the parent, and `Enter` selects a durable row;
- collapsed descendants leave the keyboard list but remain in normalized tree data, so reopening restores the complete tree.

Composer behavior:

- `running`/`queued`/`needs_attention`: submit steer; stop icon interrupt;
- `paused`: submit resume;
- terminal/inactive/unavailable: no textarea;
- preserve draft until control succeeds;
- omit attachments, slash commands, model selection, retry, and hard stop.

### Step 4: Integrate TaskHeader and translations

Add optional TaskHeader props:

```ts
subagentCount?: number;
subagentsOpen?: boolean;
subagentsLive?: boolean;
onOpenSubagents?: (anchor: HTMLButtonElement) => void;
```

Add only used `subagents.*` English/Chinese strings: title/open/live/stale/unavailable, lifecycle labels, activity fallback, steer/resume placeholders, interrupt, sending, and empty state.

### Step 5: Verify and commit

```bash
node --experimental-strip-types --test components/SubagentSessions.test.mjs components/TaskHeader.test.mjs
npx tsc --noEmit
git add components/SubagentSessions.tsx components/SubagentSessions.test.mjs components/TaskHeader.tsx components/TaskHeader.test.mjs lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts
git commit -m "feat: add subagent tree and controls ui"
```

---

## Task 7: Add explicit read-only child transcript mode

**Files:**
- Modify: `components/ChatWindow.tsx`
- Modify: `hooks/useAgentSession.ts`
- Create: `components/ChatWindow.subagents.test.mjs`

### Step 1: Write the single-writer regression tests first

Use source assertions and exported load-policy helpers to prove child mode:

- initial load calls `loadSession(childId, true, false)`;
- no child request hits `/api/sessions/[child]/state`;
- no child request hits `/api/agent/[child]` or `/api/agent/[child]/events`;
- no `startRpcSession` path is reachable from read-only mount/refresh;
- persisted context refresh calls `loadSession(childId, false, false)`;
- external composer replaces, rather than nests with, normal `ChatInput`;
- user-message edit callbacks are absent.

The crucial assertion is `includeState === false`; `sessionRunning={false}` alone is not sufficient because the current state route starts a wrapper.

### Step 2: Run and confirm failure

```bash
node --experimental-strip-types --test components/ChatWindow.subagents.test.mjs
```

### Step 3: Add explicit mode props

Extend `ChatWindow`:

```ts
subagentMode?: {
  transcriptRefreshGeneration: number;
  composer: ReactNode;
};
```

Pass `readOnlyHistory: Boolean(subagentMode)` and the refresh generation to `useAgentSession`.

Extend the hook options:

```ts
readOnlyHistory?: boolean;
historyRefreshGeneration?: number;
```

Change mount loading only:

```ts
loadSession(session.id, true, !readOnlyHistory)
```

Add persisted refresh:

```ts
useEffect(() => {
  if (!readOnlyHistory || !session?.id || historyRefreshGeneration === undefined) return;
  void loadSession(session.id, false, false);
}, [historyRefreshGeneration, loadSession, readOnlyHistory, session?.id]);
```

Skip the initial generation to avoid duplicate mount fetch. Child mode renders `subagentMode.composer`, hides edit actions, and never calls direct agent handlers. Existing parent/fork behavior remains unchanged.

### Step 4: Verify and commit

```bash
node --experimental-strip-types --test components/ChatWindow.subagents.test.mjs
npx tsc --noEmit
git add components/ChatWindow.tsx hooks/useAgentSession.ts components/ChatWindow.subagents.test.mjs
git commit -m "feat: load child transcripts without a runtime"
```

---

## Task 8: Integrate root-scoped navigation in AppShell

**Files:**
- Modify: `components/AppShell.tsx`
- Modify: `components/CodexSidebar.tsx` only if necessary for explicit root highlighting
- Create: `components/AppShell.subagents.test.mjs`

### Step 1: Write failing integration assertions

Cover:

- root identity is `selectedSession.rootSessionId ?? selectedSession.id`;
- sidebar selected ID remains root while child transcript is shown;
- hook always receives root ID;
- popover position derives from trigger rectangle and clamps to viewport;
- outside click/Escape returns focus to trigger;
- opening another top panel closes subagents and vice versa;
- selecting a durable node resolves its current `SessionInfo` from `/api/sessions`, then uses existing `handleSelectSession` and URL behavior;
- breadcrumb buttons resolve/select root and each ancestor;
- missing selected child returns to nearest surviving durable ancestor;
- child `ChatWindow` gets `sessionRunning={false}` and explicit `subagentMode`;
- controls call only root subagent API with selected `childSessionId`.

### Step 2: Run and confirm failure

```bash
node --experimental-strip-types --test components/AppShell.subagents.test.mjs
```

### Step 3: Wire root identity, tree hook, and sidebar

```ts
const selectedRootId = selectedSession
  ? selectedSession.rootSessionId ?? selectedSession.id
  : null;
const childSelected = selectedSession?.sessionRole === "subagent";
```

Call `useSubagentTree` once. Pass `selectedRootId` to the sidebar selection prop so hidden child sessions do not clear root highlighting.

### Step 4: Add anchored overlay

Extend existing top-panel state with `"subagents"`. Store the trigger element/rectangle, reuse existing outside-click/Escape/mobile-back behavior, and render the fixed popover in the existing overlay layer. Opening must not change transcript bounding-box position.

### Step 5: Add durable-node and breadcrumb selection

Because the approved tree response contains only session IDs, add one helper that fetches `/api/sessions`, finds the requested current `SessionInfo`, and calls `handleSelectSession`. Reuse it for tree rows and breadcrumbs. Increment the existing sidebar `refreshKey` when a new durable child first appears so hidden inventory stays current.

### Step 6: Render read-only child mode

Find the selected node recursively in the root response and pass:

```tsx
<ChatWindow
  session={selectedSession}
  sessionRunning={false}
  subagentMode={{
    transcriptRefreshGeneration: subagents.transcriptRefreshGeneration,
    composer: (
      <SubagentComposer
        node={selectedNode}
        rpcAvailable={subagents.data?.rpcAvailable === true}
        onControl={subagents.control}
      />
    ),
  }}
  // existing display callbacks
/>
```

The root route is the only control path. AppShell never starts or posts to the child runtime.

### Step 7: Verify and commit

```bash
node --experimental-strip-types --test components/AppShell.subagents.test.mjs components/SubagentSessions.test.mjs components/TaskHeader.test.mjs
npx tsc --noEmit
git add components/AppShell.tsx components/AppShell.subagents.test.mjs
git add components/CodexSidebar.tsx  # only when actually changed
git commit -m "feat: navigate visual subagent sessions"
```

---

## Task 9: Add executable Playwright coverage

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/subagent-sessions.e2e.spec.mjs`
- Create: `tests/fixtures/subagent-sessions.mjs`

### Step 1: Add the existing ecosystem's standard browser test package

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

The browser binary is local tooling and is not committed. Do not add another browser automation dependency.

### Step 2: Build a deterministic isolated fixture

`tests/fixtures/subagent-sessions.mjs` must:

1. create a temporary agent directory and project directory;
2. set `PI_CODING_AGENT_DIR` for the spawned dev server;
3. use SDK `SessionManager.create(cwd, sessionDir, { id, parentSession })`, `appendSessionInfo`, and `appendMessage` to create root/child/grandchild sessions with official subagent names;
4. write one temporary global fake extension into that isolated agent directory;
5. keep fake live state in a temp JSON file and control acknowledgements in a temp log.

The fake extension registers only `pi.events.on("subagents:rpc:v1:request", ...)`. It implements exact versioned replies for `ping`, `status`, `steer`, `interrupt`, and `resume`; control calls update the temp state file. Because the dev server uses an isolated agent directory, the installed real `pi-subagents` extension cannot race replies.

The fixture must never write `.pi-subagents/status.json` or `events.jsonl`, and never parse terminal output.

### Step 3: Write the browser flow

The Playwright test starts `npm run dev -- --port <unused-port>` with fixture env, then asserts:

1. root is visible in sidebar; child sessions remain hidden;
2. root wrapper starts through tree GET without a model prompt;
3. subagent trigger opens a fixed overlay and transcript bounding box does not move;
4. child and grandchild show task/state/activity/elapsed time;
5. grandchild selection shows full breadcrumb and `aria-current` tree row;
6. tree keyboard navigation covers `ArrowUp`, `ArrowDown`, `ArrowRight`, `ArrowLeft`, `Home`, `End`, and `Enter`, including expansion/collapse and durable-row selection;
7. selected child generates no `/state`, child `/api/agent`, or child SSE request;
8. appending to child JSONL appears on next read-only refresh;
9. active composer Enter sends steer through root endpoint and preserves draft on rejected control;
10. stop sends interrupt and state becomes paused;
11. paused submit sends resume and state becomes running;
12. incompatible capability preserves historical tree and disables composer;
13. desktop `1440x900` and mobile `390x844` have no overlap, horizontal overflow, clipped controls, or off-viewport popover.

Capture screenshots for both viewports and assert focus returns to trigger after Escape.

### Step 4: Run and commit

```bash
npx playwright test tests/subagent-sessions.e2e.spec.mjs --reporter=line
git add package.json package-lock.json tests/subagent-sessions.e2e.spec.mjs tests/fixtures/subagent-sessions.mjs
git commit -m "test: cover visual subagent sessions"
```

---

## Task 10: Integration with the development `pi-subagents` source

The two repositories stay independent. For a real protocol smoke test, point an isolated temporary Pi agent directory at the source worktree rather than overwriting `/Users/kale/pi-subagents`.

Create a temporary settings/package entry or extension symlink that resolves `/Users/kale/.local/share/pi-worktrees/pi-subagents/visual-run-status/index.ts`, then start Pi Web with that temporary `PI_CODING_AGENT_DIR`. Do not modify the user's normal Pi settings.

Verify:

- `GET /api/agent/<root>/subagents` reports `rpcAvailable: true`;
- payload excludes runtime paths, PIDs, prompts, tokens, and capability secrets;
- nested durable sessions join exact live `(runId,index)` entries;
- steer, interrupt-to-paused, and resume work through the root;
- the child JSONL has one writer process;
- closing the tree at the root stops polling after active descendants settle.

Document the exact temporary extension path and command in the verification notes, not in persistent user configuration.

---

## Task 11: Full verification and independent review

### Step 1: Verify `pi-subagents`

```bash
npm test
npm run typecheck
git status --short
git diff --check
```

### Step 2: Verify Pi Web

```bash
npm test
npm run lint
npx tsc --noEmit
npx playwright test tests/subagent-sessions.e2e.spec.mjs --reporter=line
git status --short
git diff --check
```

Do not substitute a build or pack command.

### Step 3: Request two independent reviews

Use `superpowers:requesting-code-review` for:

1. `pi-subagents` projection privacy, real-state adapters, bounds, and compatibility;
2. Pi Web root ownership, child single-writer safety, API contract, controls, accessibility, and responsive behavior.

Fix blockers with a failing test first and keep each repository's fixes in its own commit.

### Step 4: Completion audit

Map every approved requirement to evidence:

- complete recursive tree and historical nodes: pure merge + E2E;
- durable-only `inactive` without fabricated success/timing: pure merge tests;
- same-page detail and complete breadcrumb: AppShell + E2E;
- fixed overlay/no layout shift: Playwright bounding-box assertion;
- live state/activity/duration: protocol/UI tests;
- steer/soft-interrupt/resume only: allowlist route tests + E2E;
- root wrapper ownership and startup: route tests;
- no child `AgentSession`, `/state`, SSE, or second writer: Task 7 tests + E2E + smoke;
- old/missing extension fallback: route + E2E;
- responsive/accessibility: SSR ARIA tests + desktop/mobile Playwright;
- no forbidden build commands: verification command log.

Only then use `superpowers:finishing-a-development-branch` to present merge/PR choices for both repositories.
