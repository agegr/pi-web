# Visual Subagent Acceptance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make visual subagent sessions safe to control, correct during root/session changes, accessible in the tree UI, and green under the Pi Web acceptance gates.

**Architecture:** Keep the existing root-scoped API and `runStatus v1` bridge. Narrow the POST response to a Pi Web-owned DTO, protect the reserved subagent session-name namespace at the session rename boundary, and make the hook consume the server's returned tree snapshot without a duplicate GET. Fix the existing tree component and AppShell integration in place, then update focused and full-suite gates in a clean verification worktree.

**Tech Stack:** TypeScript, React 19, TanStack Start, Node `node:test`, Jiti, Playwright, existing `pi-subagents` RPC bridge, lucide-react.

**Design Spec:** `docs/superpowers/specs/2026-08-14-visual-subagent-acceptance-fixes-design.md`

---

## Scope and Execution Rules

This plan is for `/Users/kale/pi-web` only. Do not edit or vendor `/Users/kale/pi-subagents`; the installed RPC package already provides the required public run-status projection.

The current worktree contains unrelated tracked edits in `components/ChatWindow.*` and `hooks/useAgentSession.*`, plus generated/untracked artifacts. Before creating an execution worktree, preserve those tracked edits as a patch and apply the patch to the worker worktree; do not reset, stash, or delete them:

```bash
git -C /Users/kale/pi-web diff --binary -- components/ChatWindow.plan.test.mjs components/ChatWindow.tsx hooks/useAgentSession.test.mjs hooks/useAgentSession.ts > /tmp/pi-web-local-changes.patch
git -C /Users/kale/pi-web status --short
```

Each task below is one agent handoff. Only one implementation agent writes to a given worktree at a time. After each task, the parent agent reviews the diff and runs the task's focused command before starting the next task. Agents may commit their task in the worker worktree; the parent decides whether to merge it after review.

Never run `npm run build`, `npm run pack:tanstack`, or any production build command. Use `npm run lint`, `node_modules/.bin/tsc --noEmit`, focused Node tests, the real-extension smoke, and Playwright.

---

### Task 1: Narrow the subagent control response

**Owner:** backend/API agent

**Files:**
- Modify: `lib/api-types.ts:118-165`
- Modify: `app/api/agent/[id]/subagents/route.ts:145-175`
- Test: `app/api/agent/[id]/subagents/route.test.mjs`
- Test: `hooks/useSubagentTree.test.mjs`

- [ ] **Step 1: Add a failing public response contract test**

In `route.test.mjs`, extend the fake bridge so a successful control returns a deliberately sensitive object:

```js
bridge.controlResult = {
  ok: true,
  details: {
    asyncDir: "/tmp/private-async",
    sessionFile: "/Users/kale/.pi/agent/sessions/private.jsonl",
    transcriptPath: "/tmp/private-transcript.jsonl",
    capabilityToken: "secret-token",
    controlInbox: "/tmp/control-inbox",
    intercomTarget: "private-target",
  },
};
```

Add a test that POSTs `interrupt` for the owned child and asserts the public fields:

```js
assert.equal(body.success, true);
assert.equal(body.data.action, "interrupt");
assert.equal(body.data.childSessionId, "child");
assert.equal(body.data.tree?.rootSessionId, "root");
assert.equal(body.data.control, undefined);
assert.doesNotMatch(JSON.stringify(body), /asyncDir|sessionFile|transcriptPath|capabilityToken|controlInbox|intercomTarget/);
```

The test must fail against the current raw `control` field.

Add a type-level/source assertion in `hooks/useSubagentTree.test.mjs` that the control response is parsed as a response with `data.tree` and that the hook does not read `body.data.control`.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```bash
cd /Users/kale/pi-web
node --experimental-strip-types --test 'app/api/agent/[id]/subagents/route.test.mjs' hooks/useSubagentTree.test.mjs
```

Expected: the new privacy test fails because the response contains the raw `control` object.

- [ ] **Step 3: Define the public DTO**

Add this beside `SubagentControlRequest` in `lib/api-types.ts`:

```ts
export interface SubagentControlResponse {
  success: true;
  data: {
    action: SubagentControlRequest["action"];
    childSessionId: string;
    tree?: SubagentTreeResponse;
  };
}
```

Keep `SubagentControlRequest` unchanged so the browser input remains limited to `action`, `childSessionId`, and optional `message`.

- [ ] **Step 4: Return only the allowlisted fields from the route**

In `route.ts`, keep `controlResult` as an awaited local only to determine that the RPC call succeeded. Replace the current response construction:

```ts
return Response.json({ success: true, data: { control: controlResult, ...(tree ? { tree } : {}) } });
```

with:

```ts
return Response.json({
  success: true,
  data: {
    action,
    childSessionId: body.childSessionId,
    ...(tree ? { tree } : {}),
  },
} satisfies SubagentControlResponse);
```

Import `SubagentControlResponse` as a type. Do not put `controlResult` into logs, error messages, or the JSON response.

- [ ] **Step 5: Verify the response boundary**

Run:

```bash
node --experimental-strip-types --test 'app/api/agent/[id]/subagents/route.test.mjs' hooks/useSubagentTree.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: focused tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit the API boundary change**

```bash
git add lib/api-types.ts 'app/api/agent/[id]/subagents/route.ts' 'app/api/agent/[id]/subagents/route.test.mjs' hooks/useSubagentTree.test.mjs
git commit -m "fix: keep subagent control responses public"
```

---

### Task 2: Protect the reserved subagent identity namespace

**Owner:** session-integrity agent

**Files:**
- Modify: `lib/session-relations.ts:1-32`
- Test: `lib/session-relations.test.mjs`
- Modify: `app/api/sessions/[id]/route.ts:75-112`
- Test: `app/api/sessions/runtime-route.test.mjs`

- [ ] **Step 1: Add failing relation and rename tests**

In `lib/session-relations.test.mjs`, add tests for an exported helper named `isReservedSubagentSessionName`:

```js
assert.equal(isReservedSubagentSessionName("subagent-worker-317e1ca0-1"), true);
assert.equal(isReservedSubagentSessionName("subagent-reviewer-76fa6d64-6031-4824-8a88-1282c22d9afa-2"), true);
assert.equal(isReservedSubagentSessionName("Main task"), false);
assert.equal(isReservedSubagentSessionName("subagent-worker-not-a-run"), false);
```

In `runtime-route.test.mjs`, add two PATCH tests:

1. A normal session with `name: "Main task"` cannot be renamed to `subagent-worker-317e1ca0-1`; expect HTTP 409 and no `set_session_name` command.
2. A session whose current name is `subagent-worker-317e1ca0-1` cannot be renamed to `ordinary name`; expect HTTP 409 and no rename command.

Keep the existing normal rename test and assert it still returns 200.

Keep the existing subagent route tests for foreign, orphan, placeholder, and valid nested children. The rename-transition tests belong in `runtime-route.test.mjs`, where the Web boundary can verify that the wrapper receives no `set_session_name` command when a rename would enter or leave the reserved namespace.

- [ ] **Step 2: Run the focused tests and confirm failure**

```bash
cd /Users/kale/pi-web
node --experimental-strip-types --test lib/session-relations.test.mjs app/api/sessions/runtime-route.test.mjs
```

Expected: the helper import fails or the new rename tests currently return 200.

- [ ] **Step 3: Centralize the reserved-name predicate**

In `lib/session-relations.ts`, export the existing regex through a small predicate without exposing the regex itself:

```ts
export function isReservedSubagentSessionName(name: string | undefined): boolean {
  return typeof name === "string" && SUBAGENT_SESSION_NAME.test(name);
}
```

Use this predicate inside `attachSessionRelations` instead of duplicating `.match(...)` checks. Preserve all existing relation fields and behavior for valid generated names.

- [ ] **Step 4: Reject both reserved-name transitions at the PATCH boundary**

In `app/api/sessions/[id]/route.ts`, resolve the current session name before applying the rename. Use the live wrapper's `inner.sessionManager.getSessionName()` when available; otherwise open the resolved file with `SessionManager.open(filePath)` and read `getSessionName()`.

Apply this transition rule before `set_session_name` or `appendSessionInfo`:

```ts
const currentReserved = isReservedSubagentSessionName(currentName);
const nextReserved = isReservedSubagentSessionName(trimmedName);
if (currentReserved !== nextReserved) {
  return Response.json({ error: "subagent session names are reserved" }, { status: 409 });
}
```

This prevents ordinary sessions from entering the namespace and prevents generated subagent sessions from losing the namespace through the web UI. A primary/fork rename to another ordinary name remains unchanged. Do not reject ordinary names merely because they contain the word `subagent`.

- [ ] **Step 5: Make the ownership and rename boundary explicit**

Keep the existing route tests for foreign, orphan, placeholder, and valid nested children. In `runtime-route.test.mjs`, assert that a normal primary/fork cannot enter the reserved namespace through PATCH and that an identified subagent cannot leave it. The route continues to resolve ownership from the existing durable parent/name/run identity contract; protection against direct manual JSONL edits is outside this Web rename boundary.

- [ ] **Step 6: Verify and commit**

```bash
node --experimental-strip-types --test lib/session-relations.test.mjs app/api/sessions/runtime-route.test.mjs
node_modules/.bin/tsc --noEmit
git diff --check
git add lib/session-relations.ts lib/session-relations.test.mjs 'app/api/sessions/[id]/route.ts' app/api/sessions/runtime-route.test.mjs
git commit -m "fix: protect subagent session identity names"
```

---

### Task 3: Make root changes and control snapshots race-safe

**Owner:** state-management agent

**Files:**
- Modify: `hooks/useSubagentTree.ts:52-190`
- Modify: `hooks/useSubagentTree.test.mjs`
- Modify: `lib/api-types.ts:157-165`
- Modify: `app/api/agent/[id]/subagents/route.test.mjs`

- [ ] **Step 1: Add failing hook contract tests**

Extend `useSubagentTree.test.mjs` source checks with these required behaviors:

- a root-change effect increments `generationRef.current` before the next root refresh;
- the same root can still coalesce concurrent refreshes;
- root change clears `data`, `stale`, and `error` before new data is rendered;
- the control path reads `body.data.tree` and conditionally adopts it;
- the control path only calls `refresh()` when the response does not contain a tree.

Add a route test where the fake bridge returns a changed tree after control and assert the POST body contains `data.tree` but no `data.control`.

- [ ] **Step 2: Run and confirm failure**

```bash
cd /Users/kale/pi-web
node --experimental-strip-types --test hooks/useSubagentTree.test.mjs 'app/api/agent/[id]/subagents/route.test.mjs'
```

Expected: the new source assertions fail because root-change cleanup and snapshot adoption are absent.

- [ ] **Step 3: Add the response type and snapshot adoption path**

Import `SubagentControlResponse` in `useSubagentTree.ts` and parse successful control responses as that type. Add one local callback, `adoptSnapshot(tree)`, that:

1. advances `transcriptRefreshGeneration` using `dataRef.current` and the new tree;
2. calls `setData(tree)`;
3. clears `stale` and `error`.

Use `adoptSnapshot(body.data.tree)` when present; otherwise call `await refresh()`. Never apply optimistic lifecycle changes and never read `body.data.control`.

- [ ] **Step 4: Invalidate old root requests and clear visible state**

Add a root-change effect before the immediate-refresh effect:

```ts
useEffect(() => {
  generationRef.current += 1;
  inFlightRef.current = null;
  dataRef.current = null;
  setData(null);
  setStale(false);
  setError(null);
}, [rootId]);
```

Retain the existing generation checks in both the response and `finally` paths. The old promise may finish in the background, but it must not clear loading state or publish data for the new root. Keep the existing 504 fallback behavior for the current root.

- [ ] **Step 5: Verify and commit**

```bash
node --experimental-strip-types --test hooks/useSubagentTree.test.mjs 'app/api/agent/[id]/subagents/route.test.mjs'
node_modules/.bin/tsc --noEmit
git add hooks/useSubagentTree.ts hooks/useSubagentTree.test.mjs lib/api-types.ts 'app/api/agent/[id]/subagents/route.test.mjs'
git commit -m "fix: isolate subagent trees across root changes"
```

---

### Task 4: Fix tree selection, breadcrumb IDs, focus, and activity semantics

**Owner:** AppShell integration agent

**Files:**
- Modify: `components/SubagentSessions.tsx:100-420`
- Modify: `components/AppShell.tsx:313-359,747-760,1120-1140,1890-1955,2180-2245`
- Modify: `components/SubagentSessions.test.mjs`
- Modify: `components/AppShell.subagents.test.mjs`
- Modify: `lib/api-types.ts:130-147`

- [ ] **Step 1: Add failing component contract tests**

Update `SubagentSessions.test.mjs` to assert:

- `buildBreadcrumbItems(nodes, selectedId, rootId, rootLabel)` returns the root item with `id === rootId`;
- a row renders `agent` and `task` as separate bounded text fields;
- every tree row has the expected `role="treeitem"`, `aria-level`, `aria-posinset`, and `aria-setsize`;
- nested rows render inside `role="group"`;
- disclosure is a real button with an accessible label;
- Arrow Left logic targets the parent node, not merely the previous visible row.

Update `AppShell.subagents.test.mjs` to assert the source closes the top panel on both desktop and mobile selection and passes `hasActiveDescendant(...)` rather than `rpcAvailable` to the header live marker.

- [ ] **Step 2: Run and confirm failure**

```bash
cd /Users/kale/pi-web
node --experimental-strip-types --test components/SubagentSessions.test.mjs components/AppShell.subagents.test.mjs
```

Expected: root ID, agent/task, ARIA group, disclosure, desktop close, and activity-marker assertions fail against the current implementation.

- [ ] **Step 3: Fix breadcrumb identity and AppShell selection**

Change `buildBreadcrumbItems` to accept `rootSessionId` explicitly and initialize:

```ts
const chain: BreadcrumbItem[] = [{ id: rootSessionId, label: rootLabel }];
```

Pass `selectedRootId` from AppShell. In `handleSubagentSelect` and `handleBreadcrumbSelect`, call `closeTopPanel()` after the durable session resolves, not only when `isMobile` is true. Preserve the existing session-resolution guard so placeholder rows remain unselectable.

Use the existing `topPanelReturnFocusRef`/`closeTopPanel` path. Set the return-focus ref when opening the subagent panel and do not replace it with the selected session's transcript element. The trigger must regain focus after the panel closes.

- [ ] **Step 4: Derive the header marker from active descendants**

Import or reuse `hasActiveDescendant` in `AppShell.tsx` and pass:

```tsx
subagentsLive={hasActiveDescendant(subagents.data?.nodes)}
```

to `TaskHeader` and the mobile header action. The count remains the recursive durable/live node count. RPC availability continues to control whether a composer is editable, but it no longer controls the activity marker.

- [ ] **Step 5: Verify and commit**

```bash
node --experimental-strip-types --test components/SubagentSessions.test.mjs components/AppShell.subagents.test.mjs
node_modules/.bin/tsc --noEmit
git add components/SubagentSessions.tsx components/SubagentSessions.test.mjs components/AppShell.tsx components/AppShell.subagents.test.mjs lib/api-types.ts
git commit -m "fix: make subagent selection and activity state accurate"
```

---

### Task 5: Implement semantic ARIA tree keyboard behavior

**Owner:** accessibility agent

**Files:**
- Modify: `components/SubagentSessions.tsx:100-300`
- Modify: `components/SubagentSessions.test.mjs`
- Modify: `app/globals.css` only if an existing selector is needed to preserve focus styling

- [ ] **Step 1: Add failing keyboard/ARIA assertions**

Render a three-level tree and assert:

```js
assert.match(html, /role="tree"/);
assert.match(html, /role="treeitem"/);
assert.match(html, /role="group"/);
assert.match(html, /aria-posinset="1"/);
assert.match(html, /aria-setsize="2"/);
```

Add source-level assertions for an ancestor lookup in the Arrow Left branch and for a real `<button` disclosure control with an `aria-label`. Assert the row button remains the only focusable tree item and disabled placeholders remain disabled.

- [ ] **Step 2: Run and confirm failure**

```bash
node --experimental-strip-types --test components/SubagentSessions.test.mjs
```

Expected: `role="group"`, positional ARIA attributes, and parent navigation assertions fail.

- [ ] **Step 3: Add tree metadata helpers**

Keep the existing `getVisibleNodes` and `nodeId` helpers. Add a parent/depth metadata map that records, for every visible node:

```ts
{ depth: number; position: number; setSize: number; parentId: string | null }
```

Use sibling list length for `aria-setsize` and one-based index for `aria-posinset`. Do not calculate these values from the flattened list.

- [ ] **Step 4: Render nested groups and real disclosure buttons**

Replace the single flattened row wrapper with recursive rendering. Render each sibling list in a `div role="group"` when nested. Keep the root container as `role="tree"` and keep the row button as the focus target with roving `tabIndex`.

Render the disclosure control as:

```tsx
<button
  type="button"
  aria-label={collapsed ? t("subagents.expand") : t("subagents.collapse")}
  onClick={(event) => { event.stopPropagation(); toggle(id); }}
>
  <ChevronRight aria-hidden="true" />
</button>
```

Use `aria-expanded` on the treeitem, not on the disclosure button. Preserve disabled placeholders and selected styling.

- [ ] **Step 5: Correct keyboard navigation**

Keep Up/Down/Home/End over `visibleNodes`. For Arrow Right, expand a collapsed node; otherwise move to its first visible child. For Arrow Left, collapse an expanded node; otherwise find the nearest visible ancestor from the metadata map and focus it. Enter selects the durable row. Space may select the focused durable row if the existing button behavior supports it; do not add a custom key handler if native button activation already covers it.

- [ ] **Step 6: Verify and commit**

```bash
node --experimental-strip-types --test components/SubagentSessions.test.mjs
node_modules/.bin/tsc --noEmit
git add components/SubagentSessions.tsx components/SubagentSessions.test.mjs app/globals.css
git commit -m "fix: make the subagent tree keyboard accessible"
```

---

### Task 6: Fix task labels and narrow composer layout

**Owner:** UI/responsive agent

**Files:**
- Modify: `lib/subagent-tree.ts:130-150`
- Modify: `components/SubagentSessions.tsx:207-300,430-590`
- Modify: `components/SubagentSessions.test.mjs`
- Modify: `tests/subagent-sessions.e2e.spec.mjs`
- Modify: `app/globals.css` only for focused layout rules if inline styles cannot express them

- [ ] **Step 1: Add failing label and responsive assertions**

In `SubagentSessions.test.mjs`, render a node with `agent: "worker"` and `task: "Inspect RPC"` and assert both strings are visible. Assert that a long error message is placed in an element with `min-width: 0`/wrapping support and that the textarea and action buttons retain stable minimum dimensions.

In `tests/subagent-sessions.e2e.spec.mjs`, add a mobile test that injects a rejected control response with a long message and asserts:

```js
expect(await page.locator('[role="alert"]').boundingBox()).not.toBeNull();
expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true);
```

- [ ] **Step 2: Run and confirm failure**

```bash
node --experimental-strip-types --test components/SubagentSessions.test.mjs
npx playwright test tests/subagent-sessions.e2e.spec.mjs --grep 'error|mobile'
```

Expected: agent text and narrow-error assertions fail against the current task-only row and `flex: 0 0 100%` alert.

- [ ] **Step 3: Build the display label at the tree boundary**

In `lib/subagent-tree.ts`, keep `agent` and `task` as separate API fields. Change only the fallback task selection so an internal session name is not the primary visible task:

```ts
task: entry?.label || session.firstMessage || session.name || session.id,
```

For durable sessions, preserve the raw bounded task in `task`; the component will render `agent` as the role label. Do not concatenate the fields in the API, because consumers need separate values.

- [ ] **Step 4: Render bounded agent and task text**

In each row, render a small agent label and a separate two-line task summary. Apply `minWidth: 0`, `overflow: hidden`, `textOverflow: ellipsis`, and `overflowWrap: anywhere` to the text containers. Keep state/activity/elapsed details on a third bounded line only when present.

- [ ] **Step 5: Fix the composer width contract**

Change the live composer wrapper to `minWidth: 0` and allow the textarea to shrink. Put the error alert in a separate full-width row inside a wrapping composer shell instead of a flex child with `flex: 0 0 100%`. Use `overflowWrap: anywhere` for the alert. Keep textarea and action buttons at `min-height: 44px` on mobile and a stable 34px desktop height, using the existing responsive CSS conventions. Do not add a new layout dependency.

- [ ] **Step 6: Verify and commit**

```bash
node --experimental-strip-types --test components/SubagentSessions.test.mjs lib/subagent-tree.test.mjs
npx playwright test tests/subagent-sessions.e2e.spec.mjs --grep 'error|mobile'
node_modules/.bin/tsc --noEmit
git add lib/subagent-tree.ts components/SubagentSessions.tsx components/SubagentSessions.test.mjs tests/subagent-sessions.e2e.spec.mjs app/globals.css
git commit -m "fix: improve subagent labels and narrow composer layout"
```

---

### Task 7: Repair stale acceptance tests and create a clean full-suite gate

**Owner:** test-gate agent

**Files:**
- Modify: `components/DialogConfirmations.test.mjs:33-43`
- Modify: `components/MobilePwaLayout.test.mjs:58-65`
- Modify: `tests/smoke-real-extension.mjs`
- Test: all focused subagent tests and existing full suite

- [ ] **Step 1: Update stale static assertions to current behavior**

In `DialogConfirmations.test.mjs`, the current `CodexSidebar` has two distinct behaviors:

- worktree force removal uses `pendingConfirmation`, `worktreeBusy`, `dismissible={!worktreeBusy}`, `disabled={worktreeBusy}`, and `removeWorktree(path, true)`;
- session deletion is an immediate async row action using `deleting`, `deleteError`, and `menuButtonRef`, without the old confirmation shell.

Replace the two stale tests with assertions for those current contracts. Do not reintroduce a session delete confirmation solely to satisfy the old test.

In `MobilePwaLayout.test.mjs`, replace the exact `/className="composer-shell"/` assertion with a class contract that accepts the intentional streaming expression while still requiring the `composer-shell` token, for example `/className=\{`composer-shell\$\{/`. Keep the mobile sizing assertions unchanged.

- [ ] **Step 2: Extend real-extension smoke to cover POST privacy**

Keep the existing GET privacy checks. Add a fake/controlled interrupt or resume response containing `details`, `sessionFile`, `asyncDir`, `transcriptPath`, `capabilityToken`, control inbox, and intercom target fields. POST through the real bridge route and assert the returned JSON has `data.action`, `data.childSessionId`, and optional `data.tree`, but none of the sensitive field names or values.

- [ ] **Step 3: Run the full suite in a clean verification worktree**

Create a temporary detached worktree from the implementation branch containing only tracked files and the preserved local patch. Do not copy `.output`, `.pi-subagents`, `.tanstack`, or `pi-web.log` into it. Run:

```bash
env -u PI_WEB_PASSWORD node --experimental-strip-types --test
```

Expected: all Node tests pass and the repository-output hygiene test sees no `.output` directory.

- [ ] **Step 4: Run the complete non-build gates**

From the same clean worktree:

```bash
npm run lint
node_modules/.bin/tsc --noEmit
node tests/smoke-real-extension.mjs
npx playwright test tests/subagent-sessions.e2e.spec.mjs --reporter=line
git diff 76d70edb708834427ffc2127e029f0a12cbb47dd --check
git diff --check
```

Expected: lint has zero errors, TypeScript exits 0, smoke passes without privacy leaks, all subagent E2E tests pass, and both tracked-range and current-worktree diff checks are clean.

```bash
git add components/DialogConfirmations.test.mjs components/MobilePwaLayout.test.mjs tests/smoke-real-extension.mjs
git commit -m "test: restore visual subagent acceptance gates"
```

---

### Task 8: Parent review and delivery audit

**Owner:** parent agent; read-only review agents may be used in parallel after all implementation tasks finish.

**Files:**
- Review all files changed by Tasks 1-7.
- Do not modify unrelated tracked or untracked files.

- [ ] **Step 1: Review security and ownership changes**

Check that no route response serializes `controlResult`, no user-controlled rename can cross the reserved namespace boundary, and all POST ownership decisions still require a root-owned durable child with a run identity.

- [ ] **Step 2: Review race and UI behavior**

Check that root changes invalidate old responses, control snapshots do not cause duplicate GETs, breadcrumbs carry real IDs, panel selection closes on desktop/mobile, focus returns to the trigger, and `ArrowLeft` resolves an ancestor.

- [ ] **Step 3: Run the final gates**

Repeat the commands from Task 7 in the actual implementation worktree and record exact pass/fail counts. Do not run production build or pack commands.

- [ ] **Step 4: Inspect the final diff and status**

```bash
git diff --check
git status --short
git diff --stat
```

The final report must distinguish implementation changes from pre-existing user edits and generated artifacts. No user artifact may be deleted as part of this work.

- [ ] **Step 5: Prepare the handoff**

Report:

- commits produced by each implementation agent;
- files changed per task;
- focused, full-suite, TypeScript, lint, smoke, and E2E results;
- any residual warnings or known behavior not covered by tests;
- whether the branch is ready for merge.

---

## Agent Delegation Order

1. Task 1 and Task 2 can be reviewed independently, but run them sequentially if both agents touch shared route fixtures.
2. Task 3 depends on Task 1's response DTO.
3. Task 4 depends on Task 3's root/tree behavior.
4. Task 5 depends on Task 4's row structure and focus model.
5. Task 6 depends on Task 5's final tree markup but can be prepared in parallel if the agent does not edit the same component blocks.
6. Task 7 runs after Tasks 1-6 so the full-suite gate reflects the final contracts.
7. Task 8 is always parent-owned and runs only after all worker outputs are reviewed.

Each worker must stop after its focused tests and commit are complete. The parent agent is responsible for resolving merge conflicts, applying the preserved local patch, and deciding whether to continue after a failed gate.
