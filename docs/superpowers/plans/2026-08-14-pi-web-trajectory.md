# Pi Web Trajectory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Pi Web 的新会话增加基于原生 AgentSession/JSONL/SSE 的 Trajectory 采集、持久化、投影 API 和 Chat/Trajectory 视图。

**Architecture:** 在 `AgentSessionWrapper` 上挂载一个 append-only JSONL `TrajectoryRecorder`，并包装公开的 `inner.agent.streamFunction` 采集 provider 请求开始、TTFT 和结束事件。服务端读取 sidecar 后按当前 Pi branch 投影 summary/full 数据；浏览器复用现有 Agent SSE，通过 trajectory version 事件刷新 TanStack/React 视图。原 Pi session JSONL 永不写入轨迹数据。

**Tech Stack:** React 19, TanStack Start/Nitro, TypeScript, Node `fs/promises`, Pi SDK `AgentSession`/`StreamFn`, existing dependency-free `node:test` tests, existing `lucide-react` icons.

---

## Handoff Rules

- Start from a new git worktree based on the current Pi Web branch. Do not implement in the dirty working directory.
- Read these files first:
  - `docs/superpowers/specs/2026-08-14-pi-web-trajectory-design.md`
  - `AGENTS.md`
  - `lib/rpc-manager.ts`
  - `lib/session-reader.ts`
  - `lib/agent-event-stream.ts`
  - `hooks/useAgentSession.ts`
  - `components/AppShell.tsx`
- Existing user changes in `components/ChatWindow.tsx`, `hooks/useAgentSession.ts`, `.impeccable/`, `.output/`, `.pi-subagents/`, `.tanstack/`, and local logs are unrelated unless the selected worktree already contains committed versions of them. Never reset or overwrite them.
- Do not run `npm run build`, `npm run build:tanstack`, or `npm run pack:tanstack` during development. The completion commands are the repository test, typecheck and lint commands listed in Task 10.
- Keep each task’s commit focused. Never stage unrelated files.
- Do not add a new dependency. `lucide-react`, React, Node APIs and the existing test runner already cover this feature.

## File Map

Create these focused modules:

- `lib/trajectory-types.ts`: discriminated unions and API response types; no filesystem or React code.
- `lib/trajectory-store.ts`: sidecar path, append queue, JSONL reader and malformed-tail handling.
- `lib/trajectory-privacy.ts`: payload redaction, bounded strings/objects and summary/full projection helpers.
- `lib/trajectory-projection.ts`: branch filtering, event pairing, stats, records and cursor projection.
- `lib/trajectory-stream.ts`: `StreamFn` wrapper around `AssistantMessageEventStream` for request timing.
- `lib/trajectory-recorder.ts`: lifecycle-to-record mapping and recorder state.
- `lib/trajectory-runtime.ts`: small integration adapter used by `rpc-manager.ts`; owns wrapper setup/teardown and live version callback.
- `app/api/sessions/[id]/trajectory/route.ts`: GET trajectory projection endpoint.
- `hooks/useTrajectory.ts`: fetch, SSE version invalidation, selection, filters and full-detail confirmation state.
- `components/TrajectoryView.tsx`: trajectory workspace layout and responsive mode.
- `components/TrajectoryTimeline.tsx`: timing overview and range selection.
- `components/TrajectoryLedger.tsx`: event table, search and filters.
- `components/TrajectoryInspector.tsx`: desktop inspector/mobile bottom sheet.

Modify these existing modules:

- `lib/api-types.ts`: export the browser-facing trajectory response types.
- `lib/rpc-manager.ts`: construct/attach recorder for new Pi Web sessions and close it with the wrapper.
- `lib/agent-event-wire.ts`: preserve the local `trajectory_update` event through SSE.
- `hooks/useAgentSession.ts`: expose active `leafId` and trajectory refresh generation without opening a second event stream.
- `components/AppShell.tsx`: add `Chat`/`Trajectory` sibling tabs and render `TrajectoryView` in the session area.
- `app/globals.css`: add the compact ledger/timeline/inspector responsive styles, reusing existing CSS variables.

Add tests beside the pure modules:

- `lib/trajectory-store.test.mjs`
- `lib/trajectory-privacy.test.mjs`
- `lib/trajectory-projection.test.mjs`
- `lib/trajectory-stream.test.mjs`
- `lib/trajectory-recorder.test.mjs`
- `lib/trajectory-runtime.test.mjs`
- `app/api/sessions/[id]/trajectory/route.test.mjs`
- `components/TrajectoryView.test.mjs`
- `hooks/useTrajectory.test.mjs`

## Task 1: Define the Sidecar Contract

**Files:**
- Create: `lib/trajectory-types.ts`
- Create: `lib/trajectory-store.ts`
- Test: `lib/trajectory-store.test.mjs`

- [ ] **Step 1: Add the type-level failing test fixture**

Add a JSON fixture inside `lib/trajectory-store.test.mjs` and assert that the reader returns the header, valid records and a warning for one malformed complete line while ignoring an incomplete final line:

```js
const input = [
  JSON.stringify({ schemaVersion: 1, type: "header", sessionId: "s1" }),
  JSON.stringify({ schemaVersion: 1, type: "record", sequence: 1, id: "r1", kind: "request_start", timestamp: 100, leafId: "l1" }),
  "{bad json}",
  "{\"schemaVersion\":1,\"type\":\"record\"",
].join("\n");
const result = await readTrajectoryText(input);
assert.equal(result.records.length, 1);
assert.equal(result.records[0].id, "r1");
assert.equal(result.warnings.length, 1);
```

Import `readTrajectoryText` from `./trajectory-store.ts`; the test must fail because the module does not exist.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
node --experimental-strip-types --test lib/trajectory-store.test.mjs
```

Expected: FAIL with a module-not-found or missing-export error.

- [ ] **Step 3: Define the stable sidecar types**

In `lib/trajectory-types.ts`, use these names and shapes as the shared contract:

```ts
export type TrajectoryDetailLevel = "summary" | "full";
export type TrajectoryRecordKind =
  | "session_start" | "turn_start" | "turn_end"
  | "request_start" | "request_first_token" | "request_end"
  | "tool_start" | "tool_end"
  | "retry_start" | "retry_end"
  | "compaction_start" | "compaction_end"
  | "subagent_link" | "error" | "warning";
export type TrajectoryStatus = "running" | "complete" | "aborted" | "error";

export interface TrajectoryHeader {
  schemaVersion: 1;
  type: "header";
  sessionId: string;
  createdAt: number;
}

export interface TrajectoryRecord {
  schemaVersion: 1;
  type: "record";
  sequence: number;
  id: string;
  kind: TrajectoryRecordKind;
  timestamp: number;
  endTimestamp?: number;
  status?: TrajectoryStatus;
  leafId?: string | null;
  entryId?: string | null;
  turnId?: string;
  requestId?: string;
  stepId?: string;
  data?: Record<string, unknown>;
}

export interface TrajectoryReadResult {
  header: TrajectoryHeader | null;
  records: TrajectoryRecord[];
  warnings: string[];
  incompleteTail: boolean;
}
```

Add the API shapes in the same file: `TrajectoryStats`, `TrajectoryTurn`, `TrajectoryRequest`, `TrajectoryRecordView`, `TrajectoryResponse`, and `TrajectoryUnsupportedResponse`. Keep `data` internal and use a typed view for API output; do not use `any`.

- [ ] **Step 4: Implement safe sidecar path and JSONL IO**

Implement these exact functions in `lib/trajectory-store.ts`:

```ts
export function trajectoryPath(agentDir: string, sessionId: string): string;
export async function ensureTrajectoryStore(agentDir: string, sessionId: string, now?: number): Promise<void>;
export async function appendTrajectoryRecord(agentDir: string, sessionId: string, record: TrajectoryRecord): Promise<void>;
export async function readTrajectoryFile(agentDir: string, sessionId: string): Promise<TrajectoryReadResult | null>;
export function readTrajectoryText(text: string): TrajectoryReadResult;
```

Use `mkdir(..., { recursive: true })`, `appendFile`, and UTF-8 JSONL. Accept only a UUID-like session id (`^[A-Za-z0-9_-]{1,128}$`) before joining it to `trajectories`; throw `TypeError` for invalid ids. A missing sidecar returns `null`. A final non-empty line without a terminating newline is `incompleteTail: true` and is ignored only if JSON parsing fails; a valid final line is parsed normally.

- [ ] **Step 5: Run the focused test and commit**

Run:

```bash
node --experimental-strip-types --test lib/trajectory-store.test.mjs
```

Expected: PASS. Then run `git diff --check`, stage only the three Task 1 files and commit:

```bash
git add lib/trajectory-types.ts lib/trajectory-store.ts lib/trajectory-store.test.mjs
git commit -m "feat: add trajectory sidecar contract"
```

## Task 2: Implement Privacy and Branch Projection

**Files:**
- Create: `lib/trajectory-privacy.ts`
- Create: `lib/trajectory-projection.ts`
- Test: `lib/trajectory-privacy.test.mjs`
- Test: `lib/trajectory-projection.test.mjs`

**Depends on:** Task 1

- [ ] **Step 1: Write failing privacy and projection tests**

Cover these concrete cases:

```js
const raw = {
  apiKey: "secret",
  headers: { authorization: "Bearer secret", "x-api-key": "secret", "content-type": "application/json" },
  systemPrompt: "system details",
  input: "x".repeat(20_000),
  nested: { toolInput: { path: "/private/file" } },
};
const safe = summarizePayload(raw);
assert.equal("apiKey" in safe, false);
assert.equal("headers" in safe, false);
assert.equal(safe.truncated, true);
assert.equal(fullPayload(raw).headers["content-type"], "application/json");
assert.equal("authorization" in fullPayload(raw).headers, false);

const projection = projectTrajectory(
  { header: null, records, warnings: [], incompleteTail: false },
  { leafId: "leaf-b", detailLevel: "summary", branchEntryIds: new Set(["branch-b-entry"]) },
);
assert.deepEqual(projection.records.map((record) => record.id), ["branch-b-record"]);
assert.equal(projection.stats.requests, 1);
```

Include a parent/child branch fixture where `leaf-b` is a descendant of only the selected branch. Include records with no completion timestamp and assert `status: "running"` and no duration.

- [ ] **Step 2: Run tests to verify failure**

```bash
node --experimental-strip-types --test lib/trajectory-privacy.test.mjs lib/trajectory-projection.test.mjs
```

Expected: FAIL because the exports are missing.

- [ ] **Step 3: Implement bounded redaction**

Export:

```ts
export const TRAJECTORY_MAX_DETAIL_CHARS = 12_000;
export function summarizePayload(value: unknown): Record<string, unknown>;
export function fullPayload(value: unknown): Record<string, unknown>;
export function redactRequestContext(value: unknown): Record<string, unknown>;
```

`redactRequestContext` must remove authentication, cookie and secret-like header keys while retaining safe request-header metadata such as `content-type`, `accept`, `user-agent` and provider-specific non-secret tracing headers. It must also drop object keys matching `apiKey`, `authorization`, `cookie`, `token`, `password`, `secret`, `credential`, `env`, and absolute session/log path keys. `summarizePayload` returns type, short text/shape, and `truncated`; it must not include raw tool input/output or headers. `fullPayload` keeps the non-sensitive request-header snapshot and other non-sensitive fields but recursively truncates strings and arrays at fixed limits and marks truncation. Preserve object keys only when they pass the allowlist; never stringify first and redact later.

- [ ] **Step 4: Implement current-branch projection**

Export:

```ts
export interface ProjectionOptions {
  leafId: string | null;
  detailLevel: TrajectoryDetailLevel;
  branchEntryIds: ReadonlySet<string>;
  cursor?: number;
}
export function projectTrajectory(
  result: TrajectoryReadResult,
  options: ProjectionOptions,
): TrajectoryResponse;
```

Build the selected entry-id set from the session branch supplied to the projector and pass it as the required `branchEntryIds` option. Do not infer branch membership from timestamps. Pair start/end records by `requestId`, `stepId` and `id`, compute durations only when both timestamps exist, and sum usage from completed request records. Preserve sidecar `sequence` as the stable record index.

Group `turn_start` through `turn_end` into `turns`; expose requests, tools, retries and compactions as typed records. Keep `warnings`, `incompleteTail` and unavailable fields explicit. `cursor` filters older records without changing aggregate stats.

- [ ] **Step 5: Run tests and commit**

```bash
node --experimental-strip-types --test lib/trajectory-privacy.test.mjs lib/trajectory-projection.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: PASS and no new type errors. Commit only Task 2 files:

```bash
git add lib/trajectory-privacy.ts lib/trajectory-projection.ts lib/trajectory-privacy.test.mjs lib/trajectory-projection.test.mjs
 git commit -m "feat: project trajectory records safely"
```

## Task 3: Add Provider Stream Timing and Recorder Lifecycle

**Files:**
- Create: `lib/trajectory-stream.ts`
- Create: `lib/trajectory-recorder.ts`
- Test: `lib/trajectory-stream.test.mjs`
- Test: `lib/trajectory-recorder.test.mjs`

**Depends on:** Task 1 and Task 2

- [ ] **Step 1: Write failing stream wrapper tests**

Use `createAssistantMessageEventStream()` to create a fake base stream. Assert that the wrapper records exactly one request start, marks first token only on the first `text_delta`/`thinking_delta`/`toolcall_delta`, forwards all events, and records completion after `result()` resolves:

```js
const events = [
  { type: "start", partial: assistant },
  { type: "text_start", contentIndex: 0, partial: assistant },
  { type: "text_delta", contentIndex: 0, delta: "ok", partial: assistant },
  { type: "text_end", contentIndex: 0, content: "ok", partial: assistant },
  { type: "done", reason: "stop", message: assistant },
];
const wrapped = wrapTrajectoryStream(fakeStream, hooks);
for await (const event of wrapped(model, context, options)) seen.push(event);
assert.equal(hooks.firstTokenCount, 1);
assert.equal(hooks.endCount, 1);
```

Add recorder tests for parallel tool calls, retry success/failure, compaction abort, ordered writes, and a recorder write rejection that does not reject the caller.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
node --experimental-strip-types --test lib/trajectory-stream.test.mjs lib/trajectory-recorder.test.mjs
```

Expected: FAIL with missing exports.

- [ ] **Step 3: Implement the stream wrapper**

Export:

```ts
import type { StreamFn } from "@earendil-works/pi-ai";
export interface TrajectoryStreamHooks {
  startRequest(model: unknown, context: unknown, options: unknown): string;
  firstToken(requestId: string): void;
  finishRequest(requestId: string, status: "complete" | "error" | "aborted", result?: unknown): void;
}
export function wrapTrajectoryStream(base: StreamFn, hooks: TrajectoryStreamHooks): StreamFn;
```

The wrapper must return an `AssistantMessageEventStream`, not an async generator, so Pi’s `result()` contract remains intact. Create an output stream, consume the base stream in a detached async task, push each event to the output, mark the first token on the first delta event, call `finishRequest` after the base `result()`, then `output.end(finalResult)`. On provider rejection or iterator error, call `finishRequest(..., "error")` and end the output with the error result according to the SDK stream contract. Do not call `base` twice.

- [ ] **Step 4: Implement the recorder lifecycle**

Export:

```ts
export interface TrajectoryRecorderOptions {
  agentDir: string;
  sessionId: string;
  cwd: string;
  now?: () => number;
  onVersion?: (version: number) => void;
}
export class TrajectoryRecorder {
  readonly sessionId: string;
  start(): Promise<void>;
  onAgentEvent(event: { type: string; [key: string]: unknown }): void;
  startRequest(model: unknown, context: unknown, options: unknown): string;
  firstToken(requestId: string): void;
  finishRequest(requestId: string, status: "complete" | "error" | "aborted", result?: unknown): void;
  recordSubagentLink(data: Record<string, unknown>): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}
```

Use `randomUUID()` ids and monotonic `sequence` values. `start()` writes a header and `session_start`. `onAgentEvent` translates lifecycle events, captures assistant usage/error metadata, creates stable turn ids, and closes active records on `agent_end`, compaction end and shutdown. A missing end event must leave the sidecar record open for the projection layer to report `running`. The recorder only writes summaries and redacted request context; raw tool input/output fields are stored behind the full-detail projection boundary.

- [ ] **Step 5: Run focused tests and commit**

```bash
node --experimental-strip-types --test lib/trajectory-stream.test.mjs lib/trajectory-recorder.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: PASS. Commit:

```bash
git add lib/trajectory-stream.ts lib/trajectory-recorder.ts lib/trajectory-stream.test.mjs lib/trajectory-recorder.test.mjs
git commit -m "feat: record provider timing and lifecycle"
```

## Task 4: Attach Recorder to AgentSessionWrapper

**Files:**
- Create: `lib/trajectory-runtime.ts`
- Create: `lib/trajectory-runtime.test.mjs`
- Modify: `lib/rpc-manager.ts`
- Modify: `lib/agent-event-wire.ts`
- Modify: `lib/agent-event-stream.ts` only if the type surface requires it

**Depends on:** Task 3

- [ ] **Step 1: Add failing runtime wiring tests**

Add source/runtime tests that verify:

```js
assert.match(rpcSource, /wrapTrajectoryStream/);
assert.match(rpcSource, /trajectoryRecorder/);
assert.match(rpcSource, /await trajectoryRecorder\.close\(\)/);
assert.match(wireSource, /trajectory_update/);
```

Use a fake `AgentSessionLike` with a replaceable `agent.streamFunction`, a fake session manager, and a recorder spy. Assert that an existing session (`hasExistingMessages === true`) does not create a new sidecar, while a new session does. Assert that destroying the wrapper flushes and closes the recorder.

- [ ] **Step 2: Implement the runtime adapter**

In `lib/trajectory-runtime.ts`, export:

```ts
export interface TrajectoryRuntime {
  recorder: TrajectoryRecorder;
  installStreamWrapper(): void;
  handleAgentEvent(event: { type: string; [key: string]: unknown }): void;
  close(): Promise<void>;
}
export function createTrajectoryRuntime(inner: AgentSessionLike, options: TrajectoryRecorderOptions): TrajectoryRuntime;
```

`installStreamWrapper()` replaces `inner.agent.streamFunction` once and delegates to `wrapTrajectoryStream`. The adapter’s `handleAgentEvent()` calls `recorder.onAgentEvent()` and invokes `onVersion` after a successful append. Do not use private SDK fields other than the already exposed `inner.agent` and `inner.sessionManager` references present in `rpc-manager.ts`.

- [ ] **Step 3: Wire new sessions in `startRpcSession()`**

After `createAgentSessionFromServices()` returns and before `wrapper.start()`:

1. Read `inner.sessionId` and `inner.sessionManager.getCwd()`.
2. Construct a runtime only when the session was created by Pi Web in this call and `hasExistingMessages` is false.
3. Start it, install the stream wrapper, and call `wrapper.start(trajectoryRuntime)`.
4. Emit `{ type: "trajectory_update", version }` through the existing wrapper listener path after each sidecar append. Keep this event non-blocking.
5. On `shutdown()`/`destroy()`, await recorder flush/close before releasing the wrapper. A recorder error is logged and swallowed after the agent has been shut down.

`AgentSessionWrapper.start(trajectoryRuntime?: TrajectoryRuntime)` must invoke `void trajectoryRuntime.handleAgentEvent(event)` before emitting the event to browser listeners. `shutdown()` awaits `trajectoryRuntime.close()` before `destroy()`; a direct `destroy()` performs a best-effort `void close()` after unsubscribing.

Do not start `startRpcSession()` from the trajectory GET route; historical route reads the session file and sidecar directly.

- [ ] **Step 4: Preserve the update event through SSE**

`AgentEventLike` already accepts string event types. Add `trajectory_update` to the explicit client event union if the local type uses one. `toClientAgentEvent()` must return the event unchanged with `version` and `promptGeneration`; it must not expose payload snapshots. The existing SSE connection remains the sole live transport.

- [ ] **Step 5: Run tests and commit**

```bash
node --experimental-strip-types --test lib/trajectory-runtime.test.mjs lib/agent-event-wire.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: PASS. Commit only the runtime/wire files and their tests:

```bash
git add lib/trajectory-runtime.ts lib/trajectory-runtime.test.mjs lib/rpc-manager.ts lib/agent-event-wire.ts lib/agent-event-stream.ts
 git commit -m "feat: attach trajectory recording to new sessions"
```

## Task 5: Add the Trajectory Projection API

**Files:**
- Modify: `lib/api-types.ts`
- Create: `app/api/sessions/[id]/trajectory/route.ts`
- Test: `app/api/sessions/[id]/trajectory/route.test.mjs`

**Depends on:** Task 2 and Task 4

- [ ] **Step 1: Define browser-facing API types and failing route tests**

Add `TrajectoryResponse`, `TrajectoryUnsupportedResponse`, `TrajectoryDetailLevel`, `TrajectoryRecordView`, `TrajectoryStats` and `TrajectoryWarning` re-exports/types to `lib/api-types.ts`. In the route test, stub `PI_CODING_AGENT_DIR`, write a session header/entries and a sidecar, then assert:

```js
const summary = await GET(request("?leafId=leaf-b&detailLevel=summary"), params("s1"));
assert.equal(summary.status, 200);
const body = await summary.json();
assert.equal(body.detailLevel, "summary");
assert.equal("input" in body.records[0], false);

const old = await GET(request("?detailLevel=summary"), params("without-sidecar"));
assert.equal(old.status, 409);
assert.equal((await old.json()).code, "trajectory_unsupported");
```

Also test invalid `detailLevel` (400), unknown session (404), and full detail truncation.

- [ ] **Step 2: Implement session and branch resolution**

The route must resolve `id` with `getRpcSession()` first only to reuse a live wrapper’s `inner.sessionManager`; otherwise call `resolveSessionPath(id)` and `SessionManager.open(path)`. It must not call `startRpcSession()`. Resolve `leafId` from the query or `sm.getLeafId()`, obtain `sm.getBranch(leafId ?? undefined)`, and pass its entry ids to `projectTrajectory()`.

Resolve the sidecar using `getAgentDir()` and `trajectoryPath(getAgentDir(), id)`. Compare the sidecar header’s `sessionId` to `id`; a mismatch is a 404/unsupported response, never a projection of another session.

- [ ] **Step 3: Implement summary/full and cursor behavior**

Accept only `detailLevel=summary|full`, defaulting to `summary`. Accept `cursor` only as a non-negative integer. Return the response shape from the design spec:

```ts
{
  schemaVersion: 1,
  detailLevel,
  session: { id, leafId, supported: true },
  stats,
  turns,
  requests,
  records,
  warnings,
  hasOlderRecords,
  nextCursor,
}
```

Full detail is still bounded and redacted by `fullPayload`; the browser confirmation is implemented in Task 7. Do not return raw request headers or secrets.

- [ ] **Step 4: Run route tests and commit**

```bash
node --experimental-strip-types --test "app/api/sessions/[id]/trajectory/route.test.mjs"
node_modules/.bin/tsc --noEmit
```

Expected: PASS. Commit:

```bash
git add lib/api-types.ts 'app/api/sessions/[id]/trajectory/route.ts' 'app/api/sessions/[id]/trajectory/route.test.mjs'
git commit -m "feat: expose trajectory projection API"
```

## Task 6: Add the Browser Data Hook

**Files:**
- Create: `hooks/useTrajectory.ts`
- Test: `hooks/useTrajectory.test.mjs`
- Modify: `hooks/useAgentSession.ts`

**Depends on:** Task 5

- [ ] **Step 1: Write failing hook/source contract tests**

Assert that the hook uses the session id and active leaf id in its request, starts at `summary`, exposes a full-detail confirmation callback, and reacts to `trajectory_update` without creating another `EventSource`:

```js
assert.match(hookSource, /detailLevel=summary/);
assert.match(hookSource, /leafId/);
assert.match(hookSource, /trajectory_update/);
assert.doesNotMatch(hookSource, /new EventSource.*trajectory/);
```

- [ ] **Step 2: Expose active leaf and trajectory generation from `useAgentSession`**

Add optional `onTrajectoryVersionChange?: (version: number) => void` to `UseAgentSessionOptions`. In the existing `handleAgentEventRef` path, handle `trajectory_update` by forwarding its numeric version. Return `activeLeafId` from the hook’s public result if it is not already returned. Do not add a second SSE connection or change the existing prompt-generation filtering.

- [ ] **Step 3: Implement `useTrajectory`**

Export:

```ts
export interface UseTrajectoryOptions {
  sessionId: string | null;
  leafId: string | null;
  trajectoryVersion: number;
}
export function useTrajectory(options: UseTrajectoryOptions): {
  data: TrajectoryResponse | null;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  select: (id: string | null) => void;
  query: string;
  setQuery: (value: string) => void;
  kind: string;
  setKind: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  detailLevel: "summary" | "full";
  fullDetailsPending: boolean;
  requestFullDetails: () => void;
  confirmFullDetails: () => Promise<void>;
  cancelFullDetails: () => void;
  expandedChildren: ReadonlyMap<string, TrajectoryResponse>;
  expandSubagent: (childSessionId: string) => Promise<void>;
  refresh: () => void;
};
```

Fetch summary on session id, leaf id or version changes. Abort stale requests. `requestFullDetails()` only opens the confirmation state; `confirmFullDetails()` performs the `detailLevel=full` request and `cancelFullDetails()` closes it. `expandSubagent(childSessionId)` fetches `/api/sessions/<childSessionId>/trajectory?detailLevel=summary` only after the user expands a link and stores the child response by session id. Preserve the selected record only if it remains in the new projection.

- [ ] **Step 4: Run hook tests and commit**

```bash
node --experimental-strip-types --test hooks/useTrajectory.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: PASS. Commit:

```bash
git add hooks/useTrajectory.ts hooks/useTrajectory.test.mjs hooks/useAgentSession.ts
 git commit -m "feat: stream trajectory updates into the browser"
```

## Task 7: Build Timeline, Ledger and Inspector UI

**Files:**
- Create: `components/TrajectoryView.tsx`
- Create: `components/TrajectoryTimeline.tsx`
- Create: `components/TrajectoryLedger.tsx`
- Create: `components/TrajectoryInspector.tsx`
- Create: `components/TrajectoryView.test.mjs`
- Modify: `app/globals.css`

**Depends on:** Task 6

- [ ] **Step 1: Add the static structure tests before UI implementation**

Use the project’s existing source-invariant test style. Assert that the view contains the `Chat`/`Trajectory` labels, timing overview, search, ledger, inspector, summary/full control, current-branch filter, child expansion and composer slot. Assert CSS contains desktop two-column layout, mobile bottom-sheet rules, stable ledger columns and reduced-motion handling:

```js
assert.match(view, /Timing overview/);
assert.match(view, /Load full details/);
assert.match(view, /TrajectoryInspector/);
assert.match(css, /trajectory-ledger/);
assert.match(css, /trajectory-inspector/);
assert.match(css, /@media.*max-width/);
```

- [ ] **Step 2: Implement `TrajectoryTimeline`**

Props:

```ts
interface TrajectoryTimelineProps {
  records: TrajectoryRecordView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}
```

Render model/tool/subagent/compaction lanes from record timestamps. Use stable percentage positions only when `endTimestamp` exists; a running record renders a marker, not a fake width. Selecting a span calls `onSelect`. Keep the overview compact and keyboard-focusable with `button`/`aria-label` spans where appropriate. No chart dependency.

- [ ] **Step 3: Implement `TrajectoryLedger`**

Props:

```ts
interface TrajectoryLedgerProps {
  records: TrajectoryRecordView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (value: string) => void;
  kind: string;
  onKindChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  onExpandSubagent: (record: TrajectoryRecordView) => void;
}
```

Use semantic `table` markup where it does not break the horizontal mobile layout; otherwise use a `role="grid"` with roving keyboard focus. Keep stable columns for sequence, turn/step, kind, summary, duration and status. Search only loaded summary/detail text. Current branch is a visible filter state, not an independent branch fetch.

- [ ] **Step 4: Implement `TrajectoryInspector`**

Props:

```ts
interface TrajectoryInspectorProps {
  record: TrajectoryRecordView | null;
  fullDetailsAvailable: boolean;
  fullDetailsPending: boolean;
  onRequestFullDetails: () => void;
  onConfirmFullDetails: () => void;
  onCancelFullDetails: () => void;
  onClose: () => void;
  mobile: boolean;
}
```

Render Overview/Input/Output/Timing/Usage/Schema tabs only when the field exists. Default to summary. Before full data is fetched, `onRequestFullDetails` toggles a confirmation state; `onConfirmFullDetails` calls the hook’s `confirmFullDetails`, and `onCancelFullDetails` clears it. Render the explicit privacy message in the confirmation state. On mobile render a bottom sheet with a visible close button and focus-safe semantics; on desktop render the right inspector. Do not place a card inside another page card.

- [ ] **Step 5: Compose `TrajectoryView` and style it**

`TrajectoryView` owns `useTrajectory`, passes `activeLeafId` and trajectory version, renders summary metrics, `TrajectoryTimeline`, `TrajectoryLedger`, `TrajectoryInspector`, and the existing composer React node. Accept the existing subagent tree nodes as a prop. For a subagent record, resolve `childSessionId` from the existing node’s `runId`/`index` mapping, then call `expandSubagent(childSessionId)`; render the returned child timeline inline below the placeholder. If no related node exists, render a non-expandable missing-child warning. Use the existing `var(--bg*)`, `var(--text*)`, `var(--border)`, `var(--accent)` variables. Use `lucide-react` icons for search, close, expand, refresh and send controls. Keep buttons at least 36px desktop and 44px on coarse pointers. Add CSS for desktop `grid-template-columns: minmax(0, 1fr) minmax(220px, 320px)`, mobile bottom sheet, `min-width: 0`, overflow containment, and `prefers-reduced-motion`.

- [ ] **Step 6: Run UI static tests and commit**

```bash
node --experimental-strip-types --test components/TrajectoryView.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
```

Expected: PASS. Commit:

```bash
git add components/TrajectoryView.tsx components/TrajectoryTimeline.tsx components/TrajectoryLedger.tsx components/TrajectoryInspector.tsx components/TrajectoryView.test.mjs app/globals.css
 git commit -m "feat: add trajectory timeline and inspector"
```

## Task 8: Integrate Chat and Trajectory Tabs in AppShell

**Files:**
- Modify: `components/AppShell.tsx`
- Modify: `components/ChatWindow.tsx`
- Modify: `hooks/useAgentSession.ts` if Task 6 did not expose the required composer/session state
- Test: `components/AppShell.trajectory.test.mjs`

**Depends on:** Task 7

- [ ] **Step 1: Write failing AppShell integration tests**

Assert source invariants for the active-session area:

```js
assert.match(appShell, /Chat/);
assert.match(appShell, /Trajectory/);
assert.match(appShell, /TrajectoryView/);
assert.match(appShell, /activeLeafId/);
assert.match(appShell, /trajectoryVersion/);
```

Also assert that `ChatWindow` remains mounted as the only composer owner and that no second prompt/SSE hook is introduced for Trajectory.

- [ ] **Step 2: Add view state and sibling tabs**

Add `const [sessionView, setSessionView] = useState<"chat" | "trajectory">("chat")` in `AppShell`. Reset it to `chat` when `selectedSession` changes to a different id or a new session starts. Render two accessible sibling tab buttons in the active session header and pass `sessionView` to `ChatWindow`. The selected tab controls only the content view and does not alter sidebar, branch or file-panel state.

- [ ] **Step 3: Preserve Chat state and share branch/composer state**

Keep ChatWindow as the only `useAgentSession` and composer owner. Add `sessionView?: "chat" | "trajectory"` to its props. AppShell owns the sibling tab buttons and passes `sessionView`; ChatWindow renders the transcript when it is `chat`, and renders `TrajectoryView` in the same workspace body while still rendering the existing `chatInputElement` at the bottom when it is `trajectory`. Do not call `useAgentSession` from `TrajectoryView` and do not extract a second ChatInput instance.

When `sessionView === "trajectory"`, pass `activeLeafId`, trajectory version, and the existing subagent tree nodes into `TrajectoryView`. On branch navigation, the active leaf already updates through ChatWindow’s existing `onBranchDataChange` path; the trajectory hook receives the same leaf id.

- [ ] **Step 4: Run integration tests and commit**

```bash
node --experimental-strip-types --test components/AppShell.trajectory.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
```

Expected: PASS. Commit:

```bash
git add components/AppShell.tsx components/ChatWindow.tsx hooks/useAgentSession.ts components/AppShell.trajectory.test.mjs
 git commit -m "feat: add Chat and Trajectory session views"
```

## Task 9: Add End-to-End Data and Responsive Verification

**Files:**
- Create: `e2e/trajectory.spec.ts`
- Create: `playwright.config.ts` only if the repository has no existing Playwright config at execution time
- Modify: `package.json` only if a `test:e2e` script is needed
- Test fixtures: `e2e/fixtures/trajectory-session.ts`

**Depends on:** Task 5 and Task 8

- [ ] **Step 1: Create an isolated fixture**

The fixture must set a temporary `PI_CODING_AGENT_DIR`, create a real Pi session header/entry file with `SessionManager`, create a matching trajectory sidecar using `trajectory-store.ts`, and start the dev server on a free port. Do not use the user’s real `~/.pi/agent` directory. The fixture record must include one request, one tool, one compaction and one child-link placeholder.

- [ ] **Step 2: Add desktop interaction coverage**

Write Playwright assertions for:

```ts
await expect(page.getByRole("tab", { name: "Trajectory" })).toBeVisible();
await page.getByRole("tab", { name: "Trajectory" }).click();
await expect(page.getByText("Timing overview")).toBeVisible();
await page.getByRole("button", { name: /read.*AGENTS/ }).click();
await expect(page.getByText(/Load full details/)).toBeVisible();
```

Also test search, type filter, timeline-to-ledger selection, explicit full-detail confirmation and a child record expansion that returns the child trajectory through the fixture route.

- [ ] **Step 3: Add mobile bounds coverage**

Run the same fixture at `390x844`. Assert that the bottom sheet is visible after selecting a record, its close button is reachable, the composer remains visible, and `document.documentElement.scrollWidth <= window.innerWidth`.

- [ ] **Step 4: Run browser tests and commit**

```bash
node_modules/.bin/playwright test e2e/trajectory.spec.ts
```

Expected: PASS at desktop and mobile viewports. Capture screenshots only as verification artifacts; do not commit generated output. Commit only the fixture/spec/config/script changes:

```bash
git add e2e/trajectory.spec.ts e2e/fixtures/trajectory-session.ts playwright.config.ts package.json
 git commit -m "test: verify trajectory views on desktop and mobile"
```

## Task 10: Full Verification and Handoff Review

**Files:**
- Modify: only files required by failing checks from Tasks 1-9
- Test: existing repository test suite and changed tests

**Depends on:** Tasks 1-9

- [ ] **Step 1: Run the complete required checks**

Run each command separately from `/Users/kale/pi-web` or the implementation worktree:

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
node_modules/.bin/playwright test e2e/trajectory.spec.ts
```

Expected: all commands exit 0. Do not run a production build.

- [ ] **Step 2: Run the security and persistence audit**

Inspect the final diff and verify:

```bash
rg -n "apiKey|authorization|cookie|password|secret|credential" lib/trajectory-* 'app/api/sessions/[id]/trajectory'
rg -n "startRpcSession" 'app/api/sessions/[id]/trajectory/route.ts'
git diff --check
```

The first search may find redaction key names, but no code path may serialize their values. The route must not call `startRpcSession`. Verify that only sidecar files are written by the recorder and that the original session JSONL is byte-for-byte unchanged in a fixture test.

- [ ] **Step 3: Review the feature against the approved spec**

Check each requirement in `docs/superpowers/specs/2026-08-14-pi-web-trajectory-design.md`: new-session-only behavior, summary-first privacy, explicit full details, current-leaf filtering, on-demand subagent expansion, timeline/ledger/inspector, desktop/mobile composer placement, non-blocking recorder errors, malformed tail warnings, and no upstream package edits.

- [ ] **Step 4: Commit only verified fixes**

If the audit finds a defect, add the smallest focused test first, fix the root cause, rerun the affected command and commit the fix with a message that names the behavior. Otherwise leave the implementation commits unchanged and report the exact command output plus any residual test gap.

## Agent Handoff Checklist

The implementing agent must return:

- Worktree path and branch name.
- Commit list for Tasks 1-10.
- Exact outputs for `npm test`, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and Playwright.
- Desktop/mobile screenshots or paths to non-committed screenshot artifacts.
- Confirmation that old sessions without sidecars return `trajectory_unsupported`.
- Confirmation that summary responses omit raw payloads and full responses are bounded/redacted.
- Any residual risk, especially provider-specific stream event semantics or unavailable subagent child links.
