# Pi Web Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut long-session input readiness from the measured 8.5 seconds to at most 4 seconds under 4x CPU and 10 Mbps emulation, eliminate idle transcript reloads, and keep streaming responsive without changing chat behavior.

**Architecture:** Apply the smallest measured fixes first: stop redundant refreshes, cap session-list summaries, batch streaming text updates, and defer only oversized historical tool results. Re-run the same browser probe after each batch. Do not add transcript pagination unless the final gate still fails; the current payload is dominated by tool results that can be deferred with much less state-management risk.

**Tech Stack:** React 19, TanStack Start, Nitro, TypeScript, Node 22 test runner, Playwright/Chromium, existing SessionManager APIs.

---

## Scope And Budgets

Current measured baseline:

- Static first-screen transfer: about 582 KB after Brotli precompression.
- Long session: about 8.5 seconds until the textarea is usable under 4x CPU and 10 Mbps.
- Long-session context response: about 3.36 MB JSON for the measured 792-message active branch.
- Session list: 352,645 bytes for 128 sessions; `firstMessage` contributes 260,145 characters.
- Initial navigation: one normal `/api/sessions` request plus three `/api/sessions?force=1` requests.
- Selected terminal child: a 621 KB transcript reload every 1.5 seconds.

Release budgets:

- Initial navigation performs zero automatic `force=1` requests and never overlaps `/api/sessions` requests (server-side scan coalescing keeps it to one disk scan).
- A selected terminal child performs zero `/api/sessions/:id` requests during a 10-second idle observation after initial settlement.
- `/api/sessions` is at most 150 KB raw with the current 128-session fixture.
- Streaming text schedules at most one React text-delta dispatch per animation frame, permits synchronous flushes only at ordering boundaries, and preserves the exact final text.
- The measured long session reaches a usable textarea within 4 seconds under the same 4x CPU and 10 Mbps profile.
- No new main-thread long task exceeds 250 ms after the textarea becomes usable.
- Static first-screen transfer does not regress above 650 KB when an approved production candidate is externally built and deployed.

Repository constraint: never run `npm run build` or `npm run pack:tanstack` during development. Use targeted tests, the full Node test suite, typecheck, lint, and a browser probe against an isolated Vite development server. Production bundle size and service-worker caching are separate release gates, measured only after an approved release process produces and deploys the candidate artifact.

## File Map

Files created:

- `scripts/perf-session-load.mjs` - repeatable browser/network benchmark for root and child sessions.
- `lib/text-delta-batcher.ts` - tiny scheduler for coalescing text deltas while preserving ordering boundaries.
- `lib/text-delta-batcher.test.mjs` - behavioral batching, flush, and disposal checks.
- `app/api/sessions/[id]/entries/[entryId]/tool-result/route.ts` - fetches one deferred historical tool result.
- `app/api/sessions/[id]/entries/[entryId]/tool-result/route.test.mjs` - route behavior and trust-boundary coverage.

Files modified:

- `hooks/useSubagentTree.ts` - advance transcript refresh generation only while active or when work settles.
- `hooks/useSubagentTree.test.mjs` - behavioral generation tests.
- `components/SubagentSessions.tsx` and `components/SubagentSessions.test.mjs` - stable nonvisual child selector for the browser probe.
- `components/CodexSidebar.tsx` - reserve forced inventory scans for the manual refresh command.
- `components/CodexSidebar.test.mjs` - assert automatic refresh policy.
- `app/api/sessions/route.ts` - cap list-only `firstMessage` values.
- `app/api/sessions/runtime-route.test.mjs` - test list summary capping.
- `hooks/useAgentSession.ts` - request deferred tool results and batch streaming text deltas by animation frame.
- `hooks/useAgentSession.test.mjs` - verify batching, flushing, and request flags.
- `lib/types.ts` - optional deferred tool-result metadata.
- `lib/session-reader.ts` - omit oversized historical tool-result bodies only when explicitly requested.
- `lib/session-reader.test.mjs` - verify threshold and unchanged full-history behavior.
- `components/ChatWindow.tsx` - retain each tool-result entry id for on-demand loading.
- `components/MessageView.tsx` - fetch a deferred result when its tool row is expanded.
- `components/MessageView.test.mjs` - verify collapsed deferred rendering.
- `e2e/fixtures/trajectory-session.ts`, `playwright.config.ts`, and `e2e/trajectory.spec.ts` - exercise failure, retry, rendering, and cache reuse for deferred results.
- `lib/i18n/messages/en.ts` and `lib/i18n/messages/zh-CN.ts` - loading and failure strings for deferred tool results.
- `components/AppShell.tsx` - lazy-load the settings surface.
- `components/CodexSidebar.test.mjs` - verify the settings boundary remains conditional.
- `public/sw.js` - cache production `/assets/` paths.
- `public/sw.test.mjs` - verify the emitted asset prefix.

## Release Sequence

- Release A: Tasks 1-4. Removes repeated work without changing payload semantics.
- Release B: Tasks 5-6. Reduces response parsing and streaming render frequency.
- Release C: Tasks 7-8. Safe conditional loading and PWA cache correction.
- Final gate: Task 9. Stop when budgets pass; do not implement pagination speculatively.

---

### Task 1: Add A Repeatable Performance Probe

**Files:**
- Create: `scripts/perf-session-load.mjs`
- Modify: `components/SubagentSessions.tsx:318-330`
- Modify: `components/AppShell.tsx:1272-1273` (add `data-subagent-panel-toggle="true"` so the probe can open the subagent panel)
- Test: `components/SubagentSessions.test.mjs`

- [x] **Step 1: Create the probe**

Create `scripts/perf-session-load.mjs` with this implementation:

```js
import { chromium } from "playwright";

const baseUrl = process.env.PI_WEB_BASE_URL ?? "http://127.0.0.1:30141";
const sessionId = process.env.PI_WEB_SESSION_ID;
const childSessionId = process.env.PI_WEB_CHILD_SESSION_ID;
const password = process.env.PI_WEB_PASSWORD;
const mode = process.env.PI_WEB_MODE ?? "root";
const settleMs = Number(process.env.PI_WEB_SETTLE_MS ?? 2_000);
const observeMs = Number(process.env.PI_WEB_OBSERVE_MS ?? 10_000);

if (!sessionId || !password || !["root", "child"].includes(mode)) {
  throw new Error("PI_WEB_SESSION_ID, PI_WEB_PASSWORD, and PI_WEB_MODE=root|child are required");
}
if (mode === "child" && !childSessionId) {
  throw new Error("PI_WEB_CHILD_SESSION_ID is required in child mode");
}

const browser = await chromium.launch();
const context = await browser.newContext({
  serviceWorkers: "block",
  extraHTTPHeaders: {
    Authorization: `Basic ${Buffer.from(`pi:${password}`).toString("base64")}`,
  },
});
const page = await context.newPage();
await page.addInitScript(() => {
  window.__piLongTasks = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__piLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
    }
  }).observe({ type: "longtask", buffered: true });
});

const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 50,
  downloadThroughput: 1_250_000,
  uploadThroughput: 625_000,
});

const targetId = mode === "child" ? childSessionId : sessionId;
const targetPath = `/api/sessions/${encodeURIComponent(targetId)}`;
const firstHistoryResponse = mode === "child"
  ? page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === targetPath && response.ok();
    }, { timeout: 120_000 })
  : null;

const startedAt = performance.now();
await page.goto(`${baseUrl}/?session=${encodeURIComponent(sessionId)}`, {
  waitUntil: "domcontentloaded",
  timeout: 120_000,
});

if (mode === "root") {
  const input = page.locator("textarea").last();
  await input.waitFor({ state: "visible", timeout: 120_000 });
  await input.focus();
  const originalValue = await input.inputValue();
  const probeValue = `${originalValue}pi readiness probe`;
  await input.fill(probeValue);
  if (await input.inputValue() !== probeValue) {
    throw new Error("Chat input is visible but not editable");
  }
  await input.fill(originalValue);
} else {
  const childRow = page.locator(`[data-subagent-session-id="${childSessionId}"]`);
  await childRow.waitFor({ state: "visible", timeout: 120_000 });
  await childRow.click();
  await firstHistoryResponse;
  await page.waitForTimeout(settleMs);
}

const readyMs = performance.now() - startedAt;
const readyAt = await page.evaluate(() => performance.now());
if (mode === "root") await page.waitForTimeout(settleMs);

const { navigationResource, initialResources } = await page.evaluate(() => {
  const navigation = performance.getEntriesByType("navigation")[0];
  return {
    navigationResource: navigation ? {
      name: navigation.name,
      startTime: navigation.startTime,
      encodedBodySize: navigation.encodedBodySize,
      duration: navigation.duration,
    } : null,
    initialResources: performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name,
      startTime: entry.startTime,
      encodedBodySize: entry.encodedBodySize,
      duration: entry.duration,
    })),
  };
});
await page.evaluate(() => performance.clearResourceTimings());
await page.waitForTimeout(observeMs);

const browserMetrics = await page.evaluate((browserReadyAt) => {
  const longTasks = window.__piLongTasks;
  return {
    longTasks,
    postReadyLongTasks: longTasks.filter((entry) => entry.startTime >= browserReadyAt),
    idleResources: performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name,
      startTime: entry.startTime,
      encodedBodySize: entry.encodedBodySize,
      duration: entry.duration,
    })),
    nodes: document.getElementsByTagName("*").length,
  };
}, readyAt);

const staticEncodedBytes = (navigationResource?.encodedBodySize ?? 0)
  + initialResources
    .filter(({ name }) => new URL(name).pathname.startsWith("/assets/"))
    .reduce((total, resource) => total + resource.encodedBodySize, 0);
const idleSessionRequests = browserMetrics.idleResources.filter(({ name }) => (
  name.includes("/api/sessions/") && !name.includes("/state")
));
const sessionListRequests = [...initialResources, ...browserMetrics.idleResources]
  .filter(({ name }) => new URL(name).pathname === "/api/sessions");
const sessionListEvents = sessionListRequests
  .flatMap(({ startTime, duration }) => [
    { at: startTime, delta: 1 },
    { at: startTime + duration, delta: -1 },
  ])
  .sort((left, right) => left.at - right.at || left.delta - right.delta);
let activeSessionListRequests = 0;
let maxConcurrentSessionListRequests = 0;
for (const event of sessionListEvents) {
  activeSessionListRequests += event.delta;
  maxConcurrentSessionListRequests = Math.max(maxConcurrentSessionListRequests, activeSessionListRequests);
}
console.log(JSON.stringify({
  mode,
  readyMs,
  navigationResource,
  staticEncodedBytes,
  initialResources,
  sessionListRequests,
  maxConcurrentSessionListRequests,
  idleSessionRequests,
  ...browserMetrics,
}, null, 2));
await browser.close();
```

- [x] **Step 2: Run the root-session baseline**

Run:

```bash
PI_WEB_SESSION_ID='019fff63-d9fb-795b-a70b-f70c061237fe' \
PI_WEB_PASSWORD="$PI_WEB_PASSWORD" \
node scripts/perf-session-load.mjs
```

Expected: JSON containing an actual editable-input `readyMs`, timestamped `longTasks`, `postReadyLongTasks`, cache-cold `staticEncodedBytes` (navigation document plus `/assets/**`, excluding APIs), `initialResources`, `idleResources`, `sessionListRequests`, `maxConcurrentSessionListRequests`, and `idleSessionRequests`. Save the result in the implementation session notes; do not commit credentials or captured session content.

- [x] **Step 3: Add a stable child-selection hook**

Add `data-subagent-session-id={node.sessionId ?? undefined}` to the existing subagent row button in `components/SubagentSessions.tsx`. Add a source assertion to `components/SubagentSessions.test.mjs`. This is a nonvisual attribute used only to select the exact child during the idle-polling probe.

- [x] **Step 4: Add the subagent-panel toggle hook**

Add `data-subagent-panel-toggle="true"` to the subagent panel toggle button in `components/AppShell.tsx` (the button rendered when `subagentCount > 0`). This nonvisual attribute lets the child probe open the tree; the plan's original assumption that child rows are immediately visible was wrong — the tree lives behind the panel toggle.

- [x] **Step 5: Run the selected-child idle baseline**

Run (use the child's real parent session as `PI_WEB_SESSION_ID`; the measured child `019fff99-9285-72f6-b82b-bbf605407bd5` belongs to root `019ffa98-47bd-7aa6-81c2-0ad8b5566b3e`):

```bash
PI_WEB_SESSION_ID='019ffa98-47bd-7aa6-81c2-0ad8b5566b3e' \
PI_WEB_CHILD_SESSION_ID='019fff99-9285-72f6-b82b-bbf605407bd5' \
PI_WEB_MODE='child' \
PI_WEB_SETTLE_MS=4000 \
PI_WEB_PASSWORD="$PI_WEB_PASSWORD" \
node scripts/perf-session-load.mjs
```

Expected before Task 2: after opening the subagent panel, selecting the child, and a 4-second settlement window, multiple child-history requests appear in `idleSessionRequests` during the next 10 seconds (measured baseline: 4 reloads of the 621 KB child transcript).

- [x] **Step 6: Commit the probe**

```bash
git add scripts/perf-session-load.mjs components/SubagentSessions.tsx components/SubagentSessions.test.mjs components/AppShell.tsx
git commit -m "test: add repeatable session load probe"
```

---

### Task 2: Stop Idle Child Transcript Reloads

**Files:**
- Modify: `hooks/useSubagentTree.ts:31-51`
- Test: `hooks/useSubagentTree.test.mjs:31-51`

- [x] **Step 1: Replace the existing generation test with explicit lifecycle cases**

Replace the current terminal-discovery test with:

```js
test("transcript refreshes only while active and once when work settles", () => {
  const running = { nodes: [node("running")] };
  const complete = { nodes: [node("complete")] };

  assert.equal(nextTranscriptGeneration(null, running, 3), 4);
  assert.equal(nextTranscriptGeneration(running, running, 3), 4);
  assert.equal(nextTranscriptGeneration(running, complete, 3), 4);
  assert.equal(nextTranscriptGeneration(complete, complete, 3), 3);
  assert.equal(nextTranscriptGeneration(null, complete, 3), 3);
  assert.equal(nextTranscriptGeneration(running, null, 3), 3);
});
```

Update the source-policy test description from “successful snapshots plus the terminal transition” to “active snapshots and the terminal transition.”

- [x] **Step 2: Run the test and verify the old behavior fails**

```bash
node --experimental-strip-types --test hooks/useSubagentTree.test.mjs
```

Expected: FAIL because terminal-to-terminal and initial-terminal snapshots currently increment the generation.

- [x] **Step 3: Implement the minimal generation policy**

Replace `nextTranscriptGeneration()` with:

```ts
export function nextTranscriptGeneration(
  previous: SubagentTreeResponse | null,
  next: SubagentTreeResponse | null,
  current: number,
): number {
  if (!next) return current;
  const wasActive = previous ? hasActiveDescendant(previous.nodes) : false;
  const isActive = hasActiveDescendant(next.nodes);
  return isActive || (wasActive && !isActive) ? current + 1 : current;
}
```

Do not change the 1.5-second tree polling yet. The tree is still needed to detect resume and new children; only the expensive transcript reload is suppressed.

- [x] **Step 4: Run the targeted tests**

```bash
node --experimental-strip-types --test hooks/useSubagentTree.test.mjs hooks/useAgentSession.test.mjs
```

Expected: PASS.

- [x] **Step 5: Re-run the child idle probe**

Use the Task 1 child command.

Expected: zero `/api/sessions/<child-id>` requests during the 10-second observation after settlement. Tree polling may remain visible as `/api/agent/<root-id>/subagents` and is not a failure.

- [x] **Step 6: Commit**

```bash
git add hooks/useSubagentTree.ts hooks/useSubagentTree.test.mjs
git commit -m "perf: stop reloading settled child transcripts"
```

---

### Task 3: Reserve Forced Scans For Manual Refresh And Coalesce Sidebar Reloads

**Files:**
- Modify: `components/CodexSidebar.tsx:176-198,456-475,607,767-808`
- Test: `components/CodexSidebar.test.mjs`

- [x] **Step 1: Add source-policy tests**

Append:

```js
test("automatic inventory refreshes are unforced and coalesced", () => {
  assert.match(sidebar, /useEffect\(\(\) => \{ void loadData\(false\); \}, \[loadData, refreshKey\]\)/);
  assert.doesNotMatch(sidebar, /loadData\(refreshKey !== undefined\)/);
  assert.match(sidebar, /loadDataInFlightRef = useRef<Promise<void> \| null>\(null\)/);
  assert.match(sidebar, /loadDataQueuedRef\.current = true/);
  assert.match(sidebar, /while \(loadDataQueuedRef\.current\)/);

  const forcedCalls = sidebar.match(/loadData\(true\)/g) ?? [];
  assert.equal(forcedCalls.length, 1, "only the manual refresh button may force a scan");
  assert.match(sidebar, /sidebar\.refresh[^]*?onClick=\{\(\) => void loadData\(true\)\}/);
});

test("initial running ids establish a baseline without a second inventory request", () => {
  assert.match(sidebar, /previousRunningRef = useRef<Set<string> \| null>\(null\)/);
  assert.match(sidebar, /previousRawRunningRef = useRef<Set<string> \| null>\(null\)/);
  assert.match(sidebar, /if \(previous === null\) \{[\s\S]*?previousRunningRef\.current = activeRootIds;[\s\S]*?return;/);
  assert.match(sidebar, /if \(previous === null\) \{[\s\S]*?previousRawRunningRef\.current = runningIds;[\s\S]*?return;/);
});
```

- [x] **Step 2: Run the test and verify it fails**

```bash
node --experimental-strip-types --test components/CodexSidebar.test.mjs
```

Expected: FAIL because initial mount and automatic refreshes force scans, and no client-side request coalescing exists.

- [x] **Step 3: Coalesce browser requests and preserve one trailing refresh**

Move the current request body into a throwing helper; keep the existing state assignments but leave error/loading ownership to `loadData`:

```ts
const fetchData = useCallback(async (force: boolean) => {
  const [sessionsResponse, projectsResponse] = await Promise.all([
    fetch(force ? "/api/sessions?force=1" : "/api/sessions", { cache: "no-store" }),
    fetch("/api/projects", { cache: "no-store" }),
  ]);
  if (!sessionsResponse.ok || !projectsResponse.ok) {
    throw new Error(`HTTP ${sessionsResponse.status}/${projectsResponse.status}`);
  }
  const sessionData = await sessionsResponse.json() as {
    sessions: SessionInfo[];
    runningSessionIds?: string[];
  };
  const projectData = await projectsResponse.json() as { projects: ProjectPreference[] };
  setSessions(sessionData.sessions);
  setPreferences(projectData.projects);
  setRunningIds((current) => current.size ? current : new Set(sessionData.runningSessionIds ?? []));
  setError(null);
}, []);
```

Add these refs next to the other sidebar refs:

```ts
const loadDataInFlightRef = useRef<Promise<void> | null>(null);
const loadDataQueuedRef = useRef(false);
const loadDataForceQueuedRef = useRef(false);
```

Replace `loadData` with:

```ts
const loadData = useCallback((force = false): Promise<void> => {
  if (loadDataInFlightRef.current) {
    loadDataQueuedRef.current = true;
    loadDataForceQueuedRef.current ||= force;
    return loadDataInFlightRef.current;
  }

  const run = async () => {
    let requestForce = force;
    try {
      do {
        loadDataQueuedRef.current = false;
        requestForce ||= loadDataForceQueuedRef.current;
        loadDataForceQueuedRef.current = false;
        await fetchData(requestForce);
        requestForce = false;
      } while (loadDataQueuedRef.current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  const pending = run();
  loadDataInFlightRef.current = pending;
  void pending.finally(() => {
    if (loadDataInFlightRef.current === pending) loadDataInFlightRef.current = null;
  });
  return pending;
}, [fetchData]);
```

This permits one request in flight and at most one trailing request when state changes during that request. A queued manual refresh retains `force=true`.

- [x] **Step 4: Establish running-state baselines without an initial reload**

Change both previous-running refs to `Set<string> | null`. In each running-state effect, store the first observed set and return without refreshing. Keep `onRunningSessionIdsChange?.(activeRootIds)` on that first pass.

For completed roots, avoid two refresh triggers:

```ts
if (completed.length) {
  onBackgroundTaskDone?.();
  if (!onBackgroundTaskDone) void loadData(false);
}
```

`onBackgroundTaskDone` already advances the parent `refreshKey`; when it exists, that effect owns the refresh.

- [x] **Step 5: Change every automatic refresh to the cached path**

Use:

```ts
useEffect(() => { void loadData(false); }, [loadData, refreshKey]);
```

Change unresolved-running and `SessionRow` mutation calls to `loadData(false)`. Their server routes already invalidate the list cache.

Keep only the visible manual refresh button as:

```tsx
<IconButton label={t("sidebar.refresh")} onClick={() => void loadData(true)}>
```

Do not remove server-side invalidation or the `force=1` endpoint; manual repair remains available.

- [x] **Step 6: Run targeted tests**

```bash
node --experimental-strip-types --test components/CodexSidebar.test.mjs lib/session-reader.test.mjs app/api/sessions/runtime-route.test.mjs
```

Expected: PASS.

- [x] **Step 7: Verify request count in Chromium**

Run the Task 1 root probe and inspect session-list resources.

Expected after initial navigation settles: zero automatic `/api/sessions?force=1` requests and at most one concurrent `/api/sessions` request at any time (maxConcurrentSessionListRequests === 1). Multiple sequential plain requests are allowed — AppShell's own session fetches (root-session info, hydration, restore) are outside this task's scope — but they all hit the server's 30-second cache and in-flight coalescing, so only one disk scan occurs (measured: 3 plain requests, 1 scan, 0 force, maxConcurrent 1). Clicking the refresh icon once must produce exactly one `force=1` request.

- [x] **Step 8: Commit**

```bash
git add components/CodexSidebar.tsx components/CodexSidebar.test.mjs
git commit -m "perf: coalesce automatic session refreshes"
```

---

### Task 4: Cap Session-List Summaries

**Files:**
- Modify: `app/api/sessions/route.ts`
- Test: `app/api/sessions/runtime-route.test.mjs`

- [x] **Step 1: Add a pure summary test**

Import `compactSessionForList` from `./route.ts`, then add:

```js
test("session listing caps firstMessage without mutating the source", async () => {
  const { compactSessionForList } = await jiti.import("./route.ts");
  const source = {
    id: "long",
    path: "/tmp/long.jsonl",
    cwd: "/tmp",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "x".repeat(2_000),
  };

  const compact = compactSessionForList(source);
  assert.equal(compact.firstMessage.length, 512);
  assert.equal(source.firstMessage.length, 2_000);
  assert.equal(compactSessionForList({ ...source, firstMessage: "short" }).firstMessage, "short");
});
```

- [x] **Step 2: Run the route test and verify it fails**

```bash
node --experimental-strip-types --test app/api/sessions/runtime-route.test.mjs
```

Expected: FAIL because `compactSessionForList` does not exist.

- [x] **Step 3: Add the list-only compaction helper**

In `app/api/sessions/route.ts`, import `SessionInfo` and add:

```ts
import type { SessionInfo } from "@/lib/types";

const SESSION_LIST_FIRST_MESSAGE_CHARS = 512;

export function compactSessionForList(session: SessionInfo): SessionInfo {
  if (session.firstMessage.length <= SESSION_LIST_FIRST_MESSAGE_CHARS) return session;
  return { ...session, firstMessage: session.firstMessage.slice(0, SESSION_LIST_FIRST_MESSAGE_CHARS) };
}
```

Apply it only to the API response:

```ts
const sessions = attachSessionRelations(
  mergeSessionLists(persistedSessions, runtimeSessions),
).map(compactSessionForList);
```

This preserves full session files and runtime prompts. Sidebar search intentionally covers the first 512 characters; do not add a search service until a real search miss is reported.

- [x] **Step 4: Run tests**

```bash
node --experimental-strip-types --test app/api/sessions/runtime-route.test.mjs components/CodexSidebar.test.mjs
```

Expected: PASS.

- [x] **Step 5: Measure the endpoint**

```bash
curl -sS -u "pi:$PI_WEB_PASSWORD" http://127.0.0.1:30141/api/sessions -o /tmp/pi-sessions.json
wc -c /tmp/pi-sessions.json
```

Expected with the measured 128 sessions: at most 150,000 bytes raw. The earlier simulation produced about 123 KB.

- [x] **Step 6: Commit**

```bash
git add app/api/sessions/route.ts app/api/sessions/runtime-route.test.mjs
git commit -m "perf: cap session list summaries"
```

---

### Task 5: Batch Streaming Text Deltas By Animation Frame

**Files:**
- Create: `lib/text-delta-batcher.ts`
- Create: `lib/text-delta-batcher.test.mjs`
- Modify: `hooks/useAgentSession.ts:283-350,475-550,1170-1235,1880-1910`
- Test: `hooks/useAgentSession.test.mjs`

- [x] **Step 1: Write behavioral tests for the scheduler**

Create `lib/text-delta-batcher.test.mjs` with three cases:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { createTextDeltaBatcher } = await jiti.import("./text-delta-batcher.ts");

function harness() {
  const emitted = [];
  const cancelled = [];
  let frame = null;
  let nextId = 1;
  const batcher = createTextDeltaBatcher(
    (callback) => { frame = callback; return nextId++; },
    (id) => { cancelled.push(id); },
    (event) => { emitted.push(event); },
  );
  return { batcher, emitted, cancelled, runFrame: () => { const callback = frame; frame = null; callback?.(16); } };
}

const delta = (contentIndex, text) => ({ type: "text_delta", contentIndex, delta: text });

test("coalesces same-block text into one scheduled emission", () => {
  const h = harness();
  h.batcher.push(delta(0, "a"));
  h.batcher.push(delta(0, "b"));
  assert.equal(h.emitted.length, 0);
  h.runFrame();
  assert.deepEqual(h.emitted, [delta(0, "ab")]);
});

test("flushes synchronously at an ordering boundary", () => {
  const h = harness();
  h.batcher.push(delta(0, "before"));
  h.batcher.push(delta(1, "after"));
  assert.deepEqual(h.emitted, [delta(0, "before")]);
  h.runFrame();
  assert.deepEqual(h.emitted, [delta(0, "before"), delta(1, "after")]);
});

test("flush preserves final text and dispose drops stale frames", () => {
  const h = harness();
  h.batcher.push(delta(0, "final"));
  h.batcher.flush();
  assert.deepEqual(h.emitted, [delta(0, "final")]);
  h.batcher.push(delta(0, "stale"));
  h.batcher.dispose();
  h.runFrame();
  assert.deepEqual(h.emitted, [delta(0, "final")]);
});
```

- [x] **Step 2: Run the new test and verify it fails**

```bash
node --experimental-strip-types --test lib/text-delta-batcher.test.mjs
```

Expected: FAIL because the helper does not exist.

- [x] **Step 3: Implement the small scheduler**

Create `lib/text-delta-batcher.ts`:

```ts
import type { ClientAssistantMessageEvent } from "@/lib/agent-event-wire";

type TextDelta = Extract<ClientAssistantMessageEvent, { type: "text_delta" }>;
type Schedule = (callback: FrameRequestCallback) => number;
type Cancel = (id: number) => void;

export function createTextDeltaBatcher(
  schedule: Schedule,
  cancel: Cancel,
  emit: (event: TextDelta) => void,
) {
  let pending: TextDelta | null = null;
  let frame: number | null = null;

  const emitPending = () => {
    const event = pending;
    pending = null;
    if (event) emit(event);
  };

  const onFrame = () => {
    frame = null;
    emitPending();
  };

  const flush = () => {
    if (frame !== null) {
      cancel(frame);
      frame = null;
    }
    emitPending();
  };

  return {
    push(event: TextDelta) {
      if (pending && pending.contentIndex !== event.contentIndex) flush();
      pending = pending
        ? { ...event, delta: pending.delta + event.delta }
        : event;
      if (frame === null) frame = schedule(onFrame);
    },
    flush,
    dispose() {
      if (frame !== null) cancel(frame);
      frame = null;
      pending = null;
    },
  };
}
```

- [x] **Step 4: Run the behavioral test**

```bash
node --experimental-strip-types --test lib/text-delta-batcher.test.mjs
```

Expected: PASS.

- [x] **Step 5: Integrate the batcher into the hook**

Create it once near the other stream refs:

```ts
const textDeltaBatcherRef = useRef<ReturnType<typeof createTextDeltaBatcher> | null>(null);
if (!textDeltaBatcherRef.current) {
  textDeltaBatcherRef.current = createTextDeltaBatcher(
    (callback) => requestAnimationFrame(callback),
    (id) => cancelAnimationFrame(id),
    (event) => dispatch({ type: "delta", event }),
  );
}
const textDeltaBatcher = textDeltaBatcherRef.current;
```

Inside the existing `message_update` branch:

```ts
const delta = event.assistantMessageEvent as ClientAssistantMessageEvent | undefined;
if (delta) {
  if (delta.type === "text_delta") {
    textDeltaBatcher.push(delta);
  } else {
    textDeltaBatcher.flush();
    dispatch({ type: "delta", event: delta });
  }
  if (delta.type !== "toolcall_start" && delta.type !== "toolcall_delta") {
    setAgentPhase(null);
  }
}
```

Call `textDeltaBatcher.flush()` before `message_end` commits the completed message, before `loadSession()` or branch-context loading replaces persisted messages, and before abort/reconciliation terminal transitions. Call `textDeltaBatcher.dispose()` in unmount cleanup.

The acceptance rule is one **scheduled** text-delta dispatch per animation frame. Synchronous flushes are allowed only at content-index changes, non-text events, `message_end`, abort, and persisted-state replacement because ordering is more important than the frame budget at those boundaries.

- [x] **Step 6: Add a hook integration policy test**

Append to `hooks/useAgentSession.test.mjs`:

```js
test("stream integration batches text and flushes at lifecycle boundaries", () => {
  assert.match(source, /createTextDeltaBatcher\(/);
  assert.match(source, /delta\.type === "text_delta"[\s\S]*?textDeltaBatcher\.push\(delta\)/);
  assert.match(source, /textDeltaBatcher\.flush\(\);[\s\S]*?dispatch\(\{ type: "delta", event: delta \}\)/);
  assert.match(source, /case "message_end":[\s\S]*?textDeltaBatcher\.flush\(\)/);
  assert.match(source, /textDeltaBatcher\.dispose\(\)/);
});
```

The helper test proves coalescing, exact final text, ordering-boundary flushes, and stale-frame disposal; this source test only protects the hook wiring.

- [x] **Step 7: Run tests and typecheck**

```bash
node --experimental-strip-types --test \
  lib/text-delta-batcher.test.mjs \
  hooks/useAgentSession.test.mjs \
  components/MarkdownBody.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: PASS with no type errors.

- [x] **Step 8: Manually verify event ordering**

Send one prompt that produces prose followed by a tool call, then one prompt that produces a long Markdown table and code fence.

Expected: no missing final characters, tool rows appear after preceding text, abort preserves partial text, and long streaming remains smooth.

- [x] **Step 9: Commit**

```bash
git add \
  lib/text-delta-batcher.ts lib/text-delta-batcher.test.mjs \
  hooks/useAgentSession.ts hooks/useAgentSession.test.mjs
git commit -m "perf: batch streaming text updates by frame"
```

---

### Task 6: Defer Oversized Historical Tool Results

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/session-reader.ts:420-480`
- Modify: `app/api/sessions/[id]/route.ts:35-40`
- Modify: `app/api/sessions/[id]/context/route.ts:8-28`
- Create: `app/api/sessions/[id]/entries/[entryId]/tool-result/route.ts`
- Create: `app/api/sessions/[id]/entries/[entryId]/tool-result/route.test.mjs`
- Modify: `hooks/useAgentSession.ts:477-550`
- Modify: `components/ChatWindow.tsx:437-445`
- Modify: `components/MessageView.tsx:140-180,840-1040`
- Modify: `components/MessageView.test.mjs`
- Modify: `e2e/fixtures/trajectory-session.ts`
- Modify: `playwright.config.ts`
- Modify: `e2e/trajectory.spec.ts`
- Modify: `lib/i18n/messages/en.ts`
- Modify: `lib/i18n/messages/zh-CN.ts`
- Test: `lib/session-reader.test.mjs`

- [x] **Step 1: Add deferred metadata to the shared type**

Extend `ToolResultMessage` in `lib/types.ts`:

```ts
export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName?: string;
  content: (TextContent | ImageContent)[];
  isError?: boolean;
  details?: unknown;
  timestamp?: number;
  entryId?: string;
  deferred?: boolean;
  contentLength?: number;
}
```

These fields are optional so live SSE messages and existing callers remain unchanged.

- [x] **Step 2: Write session-reader tests for the threshold and opt-in behavior**

Add a `toolResultEntry()` fixture and these assertions:

```js
test("defers only oversized historical tool results when requested", () => {
  const entries = [
    userEntry("u1", null, "start"),
    toolResultEntry("tr1", "u1", "x".repeat(20_001)),
  ];

  const deferred = buildSessionContext(entries, undefined, { deferToolResults: true });
  assert.equal(deferred.messages[1].deferred, true);
  assert.ok(deferred.messages[1].contentLength > 20_000);
  assert.deepEqual(deferred.messages[1].content, []);

  const full = buildSessionContext(entries);
  assert.equal(full.messages[1].deferred, undefined);
  assert.equal(full.messages[1].content[0].text.length, 20_001);
});

test("keeps small tool results in the initial payload", () => {
  const context = buildSessionContext([
    userEntry("u1", null, "start"),
    toolResultEntry("tr1", "u1", "small"),
  ], undefined, { deferToolResults: true });

  assert.equal(context.messages[1].deferred, undefined);
  assert.equal(context.messages[1].content[0].text, "small");
});
```

- [x] **Step 3: Run the reader test and verify it fails**

```bash
node --experimental-strip-types --test lib/session-reader.test.mjs
```

Expected: FAIL because `deferToolResults` is not supported.

- [x] **Step 4: Implement opt-in result deferral**

Add the threshold and helper in `lib/session-reader.ts`:

```ts
const DEFERRED_TOOL_RESULT_CHARS = 20_000;

function deferToolResultContent(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult") return message;
  const contentLength = JSON.stringify({
    content: message.content,
    details: message.details,
  }).length;
  if (contentLength <= DEFERRED_TOOL_RESULT_CHARS) return message;
  return {
    ...message,
    content: [],
    details: undefined,
    deferred: true,
    contentLength,
  };
}
```

Extend the options accepted by `buildSessionContext()` and `entryToUiMessage()`:

```ts
{
  deferThinking?: boolean;
  deferToolResultImages?: boolean;
  deferToolResults?: boolean;
}
```

After tool-call normalization and image omission, apply `deferToolResultContent()` only when `deferToolResults` is true. Full exports and live events must retain complete results.

- [x] **Step 5: Run the reader test**

```bash
node --experimental-strip-types --test lib/session-reader.test.mjs
```

Expected: PASS.

- [x] **Step 6: Request deferral from both history loads**

In both `loadSession()` and branch-context loading in `hooks/useAgentSession.ts`, use:

```ts
const params = new URLSearchParams({
  deferThinking: "1",
  deferMedia: "1",
  deferToolResults: "1",
});
```

In both session GET routes, read the flag and pass it to `buildSessionContext()`:

```ts
const deferToolResults = searchParams.has("deferToolResults");
```

- [x] **Step 7: Write the tool-result endpoint test**

Create `app/api/sessions/[id]/entries/[entryId]/tool-result/route.test.mjs`. Build a temporary JSONL file with a session header and one tool-result entry, cache its session path, call `GET()`, and assert:

```js
assert.equal(response.status, 200);
assert.deepEqual((await response.json()).result, {
  role: "toolResult",
  toolCallId: "call-1",
  content: [{ type: "text", text: "full result" }],
});
```

Also assert that an unknown entry id and an assistant-message entry both return 404.

- [x] **Step 8: Run the route test and verify it fails**

```bash
node --experimental-strip-types --test 'app/api/sessions/[id]/entries/[entryId]/tool-result/route.test.mjs'
```

Expected: FAIL because the route does not exist.

- [x] **Step 9: Implement the endpoint using the existing thinking route pattern**

Create `route.ts`:

```ts
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { normalizeToolCalls } from "@/lib/normalize";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const entries = liveRpc
      ? liveRpc.inner.sessionManager.getEntries()
      : getSessionEntries(filePath!);
    const entry = entries.find((candidate) => candidate.id === entryId);
    if (!entry || entry.type !== "message" || entry.message.role !== "toolResult") {
      return Response.json({ error: "Tool result not found" }, { status: 404 });
    }

    return Response.json({ result: normalizeToolCalls(entry.message) });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
```

The route must resolve the session id through either the live RPC registry or the existing session path cache; never accept a file path from the browser.

- [x] **Step 10: Retain tool-result entry ids in `ChatWindow`**

Change the tool-result map construction to iterate by index:

```ts
const toolResultsMap = useMemo(() => {
  const map = new Map<string, ToolResultMessage>();
  messages.forEach((message, index) => {
    if (message.role !== "toolResult") return;
    map.set(message.toolCallId, { ...message, entryId: entryIds[index] });
  });
  return map;
}, [entryIds, messages]);
```

- [x] **Step 11: Add cached client loading and expansion behavior**

Use a separate 100-entry cache, following the existing thinking cache policy:

```ts
const toolResultCache = new Map<string, Promise<ToolResultMessage>>();

function loadToolResult(sessionId: string, entryId: string): Promise<ToolResultMessage> {
  const key = `${sessionId}:${entryId}`;
  const cached = toolResultCache.get(key);
  if (cached) return cached;

  const request = fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/tool-result`,
  ).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { result?: ToolResultMessage };
    if (!data.result || data.result.role !== "toolResult") {
      throw new Error("Invalid tool result response");
    }
    return data.result;
  }).catch((error) => {
    toolResultCache.delete(key);
    throw error;
  });

  toolResultCache.set(key, request);
  if (toolResultCache.size > 100) {
    const oldestKey = toolResultCache.keys().next().value;
    if (oldestKey) toolResultCache.delete(oldestKey);
  }
  return request;
}
```

Pass `sessionId` from `BlockView` into `ToolCallBlock`. In `ToolCallBlock`, add local loading state and replace the current header toggle with:

```ts
const [loadedResult, setLoadedResult] = useState<ToolResultMessage | null>(null);
const [resultLoading, setResultLoading] = useState(false);
const [resultError, setResultError] = useState<string | null>(null);
const resultRequestRef = useRef<string | null>(null);
const effectiveResult = loadedResult ?? result;

useEffect(() => {
  if (!expanded || !result?.deferred || loadedResult) return;
  if (!sessionId || !result.entryId) {
    setResultError(t("i18n.toolResultUnavailable"));
    return;
  }
  const key = `${sessionId}:${result.entryId}`;
  if (resultRequestRef.current === key) return;
  resultRequestRef.current = key;
  setResultLoading(true);
  setResultError(null);
  void loadToolResult(sessionId, result.entryId).then(
    (value) => {
      if (resultRequestRef.current !== key) return;
      resultRequestRef.current = null;
      setResultLoading(false);
      setLoadedResult(value);
    },
    () => {
      if (resultRequestRef.current !== key) return;
      resultRequestRef.current = null;
      setResultLoading(false);
      setResultError(t("i18n.toolResultUnavailable"));
    },
  );
}, [expanded, loadedResult, result?.deferred, result?.entryId, sessionId, t]);
```

Use this header toggle so collapsing clears an error and reopening retries:

```tsx
onClick={() => {
  const nextExpanded = !expanded;
  setUserExpanded(nextExpanded);
  if (!nextExpanded) setResultError(null);
}}
```

Derive `resultText`, `isError`, and the diff from `effectiveResult`. When an expanded deferred result is loading, render `t("i18n.loadingToolResult")`; on failure render `resultError`. Keep the tool name, success/error icon, duration, input, and written-file derivation available before loading.

Add translations:

```ts
// en.ts
"i18n.loadingToolResult": "Loading tool result...",
"i18n.toolResultUnavailable": "Tool result is unavailable.",

// zh-CN.ts
"i18n.loadingToolResult": "正在加载工具结果...",
"i18n.toolResultUnavailable": "工具结果不可用。",
```

- [x] **Step 12: Add rendering and interaction tests**

In `components/MessageView.test.mjs`, assert that a collapsed deferred result omits its body while retaining the success header. Add `data-tool-call-id={block.toolCallId}` to the tool wrapper for stable end-to-end selection.

Extend `e2e/fixtures/trajectory-session.ts` so the root fixture contains one assistant `read` tool call followed by a tool-result entry whose text is `"x".repeat(25_000) + "E2E_DEFERRED_RESULT_MARKER"`. Return the call id from the fixture and expose it as `E2E_TOOL_CALL_ID` in `playwright.config.ts`.

Add this behavioral test to `e2e/trajectory.spec.ts`:

```ts
test("deferred tool result shows loading, retries after failure, and reuses the cache", async ({ page }) => {
  let resultRequests = 0;
  let releaseRetry = () => {};
  const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
  await page.route("**/api/sessions/*/entries/*/tool-result", async (route) => {
    resultRequests += 1;
    if (resultRequests === 1) {
      await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"test"}' });
      return;
    }
    if (resultRequests === 2) await retryGate;
    await route.continue();
  });

  await page.goto(`/?session=${process.env.E2E_SESSION_ID}`);
  const row = page.locator(`[data-tool-call-id="${process.env.E2E_TOOL_CALL_ID}"]`);
  const header = row.getByRole("button");

  await header.click();
  await expect(row).toContainText("Tool result is unavailable.");
  await header.click();
  await header.click();
  await expect(row).toContainText("Loading tool result...");
  releaseRetry();
  await expect(row).toContainText("E2E_DEFERRED_RESULT_MARKER");
  await header.click();
  await header.click();
  await expect(row).toContainText("E2E_DEFERRED_RESULT_MARKER");
  expect(resultRequests).toBe(2);
});
```

This covers loading/failure state, collapse-to-retry behavior, successful rendering, and cache reuse. Keep the existing route and reader tests for trust boundaries and threshold semantics.

- [x] **Step 13: Run the complete targeted set**

```bash
node --experimental-strip-types --test \
  lib/session-reader.test.mjs \
  'app/api/sessions/[id]/entries/[entryId]/tool-result/route.test.mjs' \
  components/MessageView.test.mjs \
  hooks/useAgentSession.test.mjs
node_modules/.bin/playwright test e2e/trajectory.spec.ts
node_modules/.bin/tsc --noEmit
```

Expected: PASS.

- [x] **Step 14: Measure payload reduction and expansion**

Run the root probe against the measured long session. Then expand one deferred tool row in the browser and confirm exactly one `tool-result` request occurs and the result renders identically.

Expected: initial context payload decreases substantially from 3.36 MB; the earlier payload breakdown suggests roughly 2.2 MB is removable. A second expansion should use the client cache.

- [x] **Step 15: Commit**

```bash
git add \
  lib/types.ts lib/session-reader.ts lib/session-reader.test.mjs \
  app/api/sessions/'[id]'/route.ts \
  app/api/sessions/'[id]'/context/route.ts \
  app/api/sessions/'[id]'/entries/'[entryId]'/tool-result/route.ts \
  app/api/sessions/'[id]'/entries/'[entryId]'/tool-result/route.test.mjs \
  hooks/useAgentSession.ts hooks/useAgentSession.test.mjs \
  components/ChatWindow.tsx components/MessageView.tsx components/MessageView.test.mjs \
  e2e/fixtures/trajectory-session.ts e2e/trajectory.spec.ts playwright.config.ts \
  lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts
git commit -m "perf: defer oversized historical tool results"
```

---

### Task 7: Lazy-Load The Settings Surface

**Files:**
- Modify: `components/AppShell.tsx:1-40,2424-2438`
- Test: `components/CodexSidebar.test.mjs`

- [x] **Step 1: Add an import-boundary test**

Append:

```js
test("settings stays outside the initial AppShell module graph", () => {
  assert.doesNotMatch(shell, /import \{ SettingsPage \} from "\.\/SettingsPage"/);
  assert.match(shell, /lazy\(\(\) => import\("\.\/SettingsPage"\)/);
  assert.match(shell, /settingsOpen && \([\s\S]*?<Suspense/);
});
```

- [x] **Step 2: Run the test and verify it fails**

```bash
node --experimental-strip-types --test components/CodexSidebar.test.mjs
```

Expected: FAIL because `SettingsPage` is statically imported.

- [x] **Step 3: Introduce the existing React lazy boundary**

Replace the static `SettingsPage` import and extend the existing React import:

```ts
import { lazy, Suspense, useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";

const SettingsPage = lazy(() => import("./SettingsPage").then((module) => ({
  default: module.SettingsPage,
})));
```

Wrap the existing conditional settings mount with its full current prop contract:

```tsx
{settingsOpen && (
  <Suspense fallback={null}>
    <SettingsPage
      cwd={projectTrustCwd}
      sessionId={selectedSession?.id ?? null}
      themePreference={preference}
      onThemeChange={setThemePreference}
      locale={locale}
      supportedLocales={supportedLocales}
      onLocaleChange={setLocale}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
      onClose={() => setSettingsOpen(false)}
      onRegisterSettingsBack={(handler) => { settingsBackHandlerRef.current = handler; }}
      onModelsChanged={() => setModelsRefreshKey((key) => key + 1)}
      onSessionReloaded={() => setSessionKey((key) => key + 1)}
      onProjectsChanged={() => setRefreshKey((key) => key + 1)}
    />
  </Suspense>
)}
```

Do not lazy-load `ChatWindow` or `CodexSidebar`; they are first-screen functionality. Do not add a loading card or explanatory UI.

- [x] **Step 4: Run tests and typecheck**

```bash
node --experimental-strip-types --test components/CodexSidebar.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: PASS.

- [x] **Step 5: Verify settings interaction in development**

Open settings, switch between at least two settings sections, close, and reopen.

Expected: first open may load the chunk once; subsequent opens are immediate, with no hydration warning or layout overlap.

- [x] **Step 6: Commit**

```bash
git add components/AppShell.tsx components/CodexSidebar.test.mjs
git commit -m "perf: lazy load settings"
```

---

### Task 8: Correct The Service-Worker Asset Prefix

**Files:**
- Modify: `public/sw.js:42-48`
- Test: `public/sw.test.mjs`

- [x] **Step 1: Add the production-prefix assertion**

Add:

```js
test("runtime cache recognizes emitted production assets", () => {
  assert.match(source, /url\.pathname\.startsWith\("\/assets\/"\)/);
  assert.doesNotMatch(source, /url\.pathname\.startsWith\("\/_build\/"\)/);
});
```

- [x] **Step 2: Run the test and verify it fails**

```bash
node --experimental-strip-types --test public/sw.test.mjs
```

Expected: FAIL because the worker currently checks `/_build/`.

- [x] **Step 3: Replace the obsolete path**

Use:

```js
const isStaticAsset =
  url.pathname.startsWith("/assets/") ||
  PRECACHE_URLS.includes(url.pathname);
```

Do not cache API responses or navigation HTML with `cacheFirst()`.

- [x] **Step 4: Run the test**

```bash
node --experimental-strip-types --test public/sw.test.mjs
```

Expected: PASS.

- [x] **Step 5: Keep runtime cache validation for the release gate**

The unit test proves the emitted path policy. Do not claim installed-PWA behavior from the Vite development server because `/assets/` chunk emission is production-only; Task 9 validates the deployed candidate.

- [x] **Step 6: Commit**

```bash
git add public/sw.js public/sw.test.mjs
git commit -m "fix: cache production assets in service worker"
```

---

### Task 9: Run Development Verification, Then The Production Release Gate

**Files:**
- No product files unless a verification failure identifies a regression.

- [x] **Step 1: Run all automated checks**

```bash
npm test
node_modules/.bin/playwright test e2e/trajectory.spec.ts
node_modules/.bin/tsc --noEmit
npm run lint
```

Expected: all commands exit 0.

- [x] **Step 2: Check the final diff for accidental scope growth**

```bash
git status --short
git diff --stat HEAD~8..HEAD
git diff --check HEAD~8..HEAD
```

Expected: only the files listed in this plan are changed; `git diff --check` produces no output. Do not add `.output/`.

- [x] **Step 3: Run behavior probes against an isolated development server**

Start the source tree without producing a bundle:

```bash
PI_WEB_PASSWORD="$PI_WEB_PASSWORD" \
node_modules/.bin/vite dev \
  --configLoader runner \
  --config vite.tanstack.config.ts \
  --host 127.0.0.1 \
  --port 30142 \
  --strictPort
```

In a second terminal, run the root and child probes with:

```bash
PI_WEB_BASE_URL='http://127.0.0.1:30142' \
PI_WEB_SESSION_ID='019fff63-d9fb-795b-a70b-f70c061237fe' \
PI_WEB_PASSWORD="$PI_WEB_PASSWORD" \
node scripts/perf-session-load.mjs

PI_WEB_BASE_URL='http://127.0.0.1:30142' \
PI_WEB_SESSION_ID='019fff63-d9fb-795b-a70b-f70c061237fe' \
PI_WEB_CHILD_SESSION_ID='019fff99-9285-72f6-b82b-bbf605407bd5' \
PI_WEB_MODE='child' \
PI_WEB_SETTLE_MS=4000 \
PI_WEB_PASSWORD="$PI_WEB_PASSWORD" \
node scripts/perf-session-load.mjs
```

Expected:

- The root probe proves the input accepts and restores text.
- Initial navigation has one normal session-list request and no automatic `force=1` request.
- The selected terminal child has zero history reloads in the 10-second idle window.
- The long-session initial context is below 1,000,000 raw JSON bytes after result deferral.

Do not apply the 4-second or 650 KB production budgets to Vite development output.

- [x] **Step 4: Exercise behavior-sensitive flows on the development server**

Manually verify:

1. Open a root session and switch branches.
2. Select an active child, watch its transcript update, then let it settle and remain selected for 10 seconds.
3. Expand a small tool result and an oversized deferred result.
4. Stream a long Markdown response, abort once, and send a follow-up.
5. Open settings and return to chat.

Expected: no missing messages, duplicate rows, stale child completion, hydration warning, lost draft text, or failed result expansion.

- [x] **Step 5: Validate the approved production candidate**

This step begins only after the repository's approved external release process builds and deploys the exact candidate commit. Do not run a forbidden build command from this development plan. Set `PI_WEB_BASE_URL` to that deployed candidate and first prove the expected source landed:

```bash
curl -fsS -u "pi:$PI_WEB_PASSWORD" "$PI_WEB_BASE_URL/sw.js" | rg 'pathname\.startsWith\("/assets/"\)'
curl -fsS -u "pi:$PI_WEB_PASSWORD" "$PI_WEB_BASE_URL/" | rg '/assets/'
```

Run the Task 1 root probe three times against the candidate and record the median `readyMs`, maximum `postReadyLongTasks[].duration`, cache-cold `staticEncodedBytes`, initial context bytes, and automatic session-list request count.

Release acceptance:

- Median editable-input `readyMs` is at most 4,000 ms under 4x CPU and 10 Mbps.
- No post-ready long task exceeds 250 ms.
- Cache-cold `staticEncodedBytes`, defined as the navigation document plus `/assets/**` and excluding `/api/**`, is at most 650 KB encoded.
- One initial automatic session-list request, no automatic `force=1`.
- Initial context JSON is below 1,000,000 raw bytes.

Then unregister the old service worker, load the candidate once to install the new worker, reload, and verify hashed `/assets/` requests are served through the worker cache while `/api/**` remains network-backed.

If no approved candidate artifact is available, report Tasks 1-8 as development-verified and leave this release gate explicitly open; do not claim the overall performance target is complete.

- [x] **Step 6: Apply the pagination decision gate**

Stop here when every release budget passes. Do not add transcript pagination, dynamic JSON compression, minimap virtualization, KaTeX lazy loading, or a new caching layer.

Open a separate design and plan only when either condition remains after candidate measurement:

- Long-session median `readyMs` is above 4,000 ms under the fixed profile.
- Initial context JSON remains above 1,000,000 bytes after oversized tool-result deferral.

The follow-up design should compare two options with fresh measurements: tail pagination with cursor-based history loading, or response compression at the server boundary. Pagination must preserve branch switching, parallel `entryIds`, session statistics, minimap navigation, and tool-call/result pairing; it is intentionally excluded from this first plan because none of those complexities are needed if the measured budgets already pass.

- [x] **Step 7: Record final evidence**

Add automated-check output, development probe results, candidate commit/artifact identity, and production medians to the implementation handoff or pull-request description. Do not commit credentials, raw session JSON, or user message content.

---

## Deliberately Skipped

- **KaTeX lazy loading:** about 65 KB compressed benefit with hydration and first-formula failure modes; not justified while multi-megabyte history work remains.
- **Transcript pagination:** gated on the final benchmark because deferring tool results removes the measured dominant payload with fewer moving parts.
- **Dynamic JSON compression:** useful only if the remaining API payload stays large; synchronous route-level Brotli would trade network time for event-loop stalls.
- **Minimap virtualization and binary-search scroll tracking:** current measured nine-turn hover added no new long task. Add only with a reproducible large-turn benchmark.
- **Non-git file-index rewrite:** replace `queue.shift()` with an index only when a broad non-git workspace reproduces an event-loop delay; it is not on the measured chat critical path.
- **FileViewer lazy loading:** shared syntax-highlighter code remains required by chat code blocks, so isolate it only after a bundle report proves material savings.

## Self-Review Checklist

- Every measured bottleneck has either an implementation task or an explicit benchmark gate.
- No task runs the forbidden production build commands.
- Automatic refresh changes preserve manual force refresh and server-side invalidation.
- Child refresh changes preserve active updates and one final settlement refresh.
- Deferred tool results remain opt-in and full exports remain unchanged.
- Streaming batching flushes before event-order boundaries and unmount.
- Security boundaries resolve session ids server-side and never accept browser-provided file paths.
- No new dependency, cache framework, pagination state machine, or abstraction is introduced without a measured need.
