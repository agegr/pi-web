# Subagent Right Context Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the existing recursive subagent tree as a compact card below the conversation-context card in the wide-desktop right gutter, without changing the RPC contract, TanStack Start stack, or child-session safety rules.

**Architecture:** Keep `AppShell` as the owner of the root-scoped `useSubagentTree` state and callbacks. Add a presentational `DesktopSubagentCard` and small tree presentation helpers next to the existing subagent components, then compose it with `DesktopConversationContext` through `ChatWindow`'s existing `desktopAside` slot. Make wide-desktop card visibility part of polling eligibility so newly started children appear without opening the top popover.

**Tech Stack:** React 19, TanStack Start, TypeScript, existing inline style/CSS token conventions, Node built-in test runner, Playwright.

**Design spec:** `docs/superpowers/specs/2026-08-14-subagent-right-context-card-design.md`

---

### Task 1: Add failing contracts for the desktop card

**Files:**
- Modify: `components/SubagentSessions.test.mjs`
- Modify: `components/AppShell.subagents.test.mjs`
- Read: `components/SubagentSessions.tsx`
- Read: `components/AppShell.tsx`

- [ ] **Step 1: Add the card imports and failing render assertions**

Extend the existing import from `./SubagentSessions.tsx` with:

```js
DesktopSubagentCard,
countActiveSubagentNodes,
```

Add a test fixture with one running direct child, one complete sibling, and one paused grandchild. Add this test before implementation:

```js
test("desktop subagent card renders summary, stale state, and recursive rows", () => {
  const child = node("reviewer", "running", {
    agent: "reviewer",
    task: "Review the current implementation",
    activity: "reading files",
    elapsedMs: 83_000,
    children: [node("analyst", "paused", { agent: "analyst", task: "Check edge cases" })],
  });
  const finished = node("finished", "complete", { agent: "worker", task: "Update tests" });
  const html = render(React.createElement(DesktopSubagentCard, {
    nodes: [child, finished],
    selectedSessionId: "reviewer",
    rpcAvailable: true,
    stale: true,
    callbacks,
  }));

  assert.match(html, /aria-label="Subagents"/);
  assert.match(html, /2 subagents/);
  assert.match(html, /1 running/);
  assert.match(html, /Live status is stale/);
  assert.match(html, /Review the current implementation/);
  assert.match(html, /reading files/);
  assert.match(html, /1m 23s/);
  assert.match(html, /Check edge cases/);
  assert.match(html, /aria-current="true"/);
  assert.equal(countActiveSubagentNodes([child, finished]), 1);
});
```

Use the project's existing `node()` and `render()` helpers. The test must fail because the exports do not yet exist.

- [ ] **Step 2: Add the failing AppShell composition and polling assertions**

Append source-contract checks to `components/AppShell.subagents.test.mjs`:

```js
test("wide desktop keeps subagent polling eligible for the right card", () => {
  assert.match(source, /treeOpen: activeTopPanel === "subagents" \|\| isWideDesktop/);
  assert.match(source, /desktop-workspace-context-stack/);
  assert.match(source, /<DesktopSubagentCard/);
  assert.match(source, /<DesktopConversationContext/);
});

test("desktop aside orders conversation context before subagents", () => {
  const contextIndex = source.indexOf("<DesktopConversationContext");
  const subagentIndex = source.indexOf("<DesktopSubagentCard");
  assert.ok(contextIndex >= 0 && subagentIndex > contextIndex);
});
```

The assertions should fail before the integration is implemented.

- [ ] **Step 3: Keep the existing polling policy test unchanged**

The existing `hooks/useSubagentTree.test.mjs` already proves that `shouldPollSubagents({ treeOpen: true, childSelected: false, hasActiveDescendant: false })` returns `true`. Do not add a duplicate hook test. The new AppShell source-contract test is the required proof that wide-desktop card visibility is passed as `treeOpen`.

- [ ] **Step 4: Run the focused tests and verify the intended failures**

Run:

```bash
node --experimental-strip-types --test \
  components/SubagentSessions.test.mjs \
  components/AppShell.subagents.test.mjs
```

Expected: failure naming missing `DesktopSubagentCard`/`countActiveSubagentNodes` or missing AppShell composition. Do not proceed if the new tests pass before production code changes.

- [ ] **Step 5: Commit only the new tests**

```bash
git add components/SubagentSessions.test.mjs components/AppShell.subagents.test.mjs hooks/useSubagentTree.test.mjs
git commit -m "test: define right context subagent card behavior"
```

Do not use `git stash`; the shared workspace has unrelated user changes.

---

### Task 2: Implement the presentational card and compact tree details

**Files:**
- Modify: `components/SubagentSessions.tsx`
- Modify: `components/SubagentSessions.test.mjs`
- Modify: `app/globals.css`

- [ ] **Step 1: Add the minimal active-count helper**

Add this next to `countSubagentNodes`:

```ts
export function countActiveSubagentNodes(nodes: SubagentTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (ACTIVE_ROW_STATES.has(node.state)) count += 1;
    count += countActiveSubagentNodes(node.children);
  }
  return count;
}
```

Use the existing `ACTIVE_ROW_STATES`; do not create a second lifecycle-state set.

- [ ] **Step 2: Add a compact `DesktopSubagentCard` component**

Add the component after `SubagentTree` and before the breadcrumb helpers. Its public props must be:

```ts
export function DesktopSubagentCard({
  nodes,
  selectedSessionId,
  rpcAvailable,
  stale,
  callbacks,
}: {
  nodes: SubagentTreeNode[];
  selectedSessionId: string | null;
  rpcAvailable: boolean;
  stale: boolean;
  callbacks: SubagentTreeCallbacks;
})
```

The component must:

- return `null` when `nodes.length === 0`;
- render a `<section className="desktop-subagent-card" aria-label={t("subagents.title")}>`;
- render a header with `Network`, `t("subagents.title")`, total count, and `t("subagents.runningSummary", { count: activeCount })` when `activeCount > 0`;
- render the existing `SubagentTree` with the same callbacks and selected id;
- render `t("subagents.stale")` in a compact status row when `stale` is true;
- pass `rpcAvailable` only for display/state; do not add controls to this card.

Use `data-subagent-card="true"` and `data-subagent-card-row` hooks for E2E selectors. The card must not create a second `SubagentTree` data model or fetch.

- [ ] **Step 3: Add status dots and agent labels without changing tree semantics**

Keep the existing recursive/keyboard implementation. In each row:

- add a small `aria-hidden="true"` status dot with `data-subagent-state={node.state}`;
- show the bounded agent name before the existing detail line, using `node.agent` and existing `detail` text;
- add an accessible row label that combines task, localized state, activity, and elapsed text;
- preserve `role="tree"`, `role="treeitem"`, `aria-level`, `aria-expanded`, `aria-selected`, roving `tabIndex`, disabled placeholders, and Enter/Arrow behavior.

Do not add a second click target around the row. The disclosure icon may continue to stop propagation as it does today.

- [ ] **Step 4: Add focused CSS using existing tokens**

Add these selectors near the existing desktop context card styles:

```css
.desktop-workspace-context-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.desktop-subagent-card {
  width: 268px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  background: var(--bg);
  box-shadow: 0 2px 8px rgba(0, 0, 0, .06);
}
.desktop-subagent-card-header {
  min-height: 38px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 7px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  font-weight: 600;
}
.desktop-subagent-card-header > span:first-of-type { min-width: 0; flex: 1; }
.desktop-subagent-card-summary,
.desktop-subagent-card-stale { color: var(--text-muted); font-size: 10px; font-weight: 400; }
.desktop-subagent-card-stale { padding: 5px 12px; border-bottom: 1px solid var(--border); color: #b45309; }
.desktop-subagent-card [role="tree"] { max-height: min(360px, 42vh); padding: 5px; }
.desktop-subagent-card [role="treeitem"] > button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.subagent-state-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: var(--text-dim); }
.subagent-state-dot[data-subagent-state="running"],
.subagent-state-dot[data-subagent-state="queued"],
.subagent-state-dot[data-subagent-state="starting"] { background: var(--accent); }
.subagent-state-dot[data-subagent-state="needs_attention"],
.subagent-state-dot[data-subagent-state="paused"] { background: #d97706; }
.subagent-state-dot[data-subagent-state="failed"] { background: #dc2626; }
@media (prefers-reduced-motion: reduce) {
  .desktop-subagent-card [role="tree"] * { transition: none !important; }
}
```

If the repository's existing semantic colors are changed before this task, use those exact existing tokens. Otherwise use the explicit amber `#d97706` and error `#dc2626` values above, matching the current AppShell state colors.

- [ ] **Step 5: Run the component tests and verify they pass**

Run:

```bash
node --experimental-strip-types --test components/SubagentSessions.test.mjs
```

Expected: all existing subagent component tests plus the new desktop-card test pass.

- [ ] **Step 6: Commit the presentational change**

```bash
git add components/SubagentSessions.tsx components/SubagentSessions.test.mjs app/globals.css
git commit -m "feat: add desktop subagent context card"
```

---

### Task 3: Compose the card in the right gutter and keep it live

**Files:**
- Modify: `components/AppShell.tsx`
- Modify: `components/AppShell.subagents.test.mjs`

- [ ] **Step 1: Import the card and set the desktop visibility condition**

Extend the existing `SubagentSessions` import with `DesktopSubagentCard`. Define the local condition near `subagentCount`:

```ts
const desktopSubagentCardVisible = isWideDesktop;
```

Use the condition only to keep polling eligible. The existing CSS/container query remains the actual render gate for the right gutter.

- [ ] **Step 2: Make wide-desktop card visibility poll the root tree**

Change the existing hook call from:

```ts
treeOpen: activeTopPanel === "subagents",
```

to:

```ts
treeOpen: activeTopPanel === "subagents" || desktopSubagentCardVisible,
```

Use the condition directly in the hook input; no hook signature or dependency array changes are required because `useSubagentTree` already receives the object on every AppShell render.

- [ ] **Step 3: Compose the ordered aside stack**

Replace the current `desktopAside={conversationContextModel ? ... : null}` expression with this shape:

```tsx
desktopAside={conversationContextModel || subagentCount > 0 ? (
  <div className="desktop-workspace-context-stack">
    {conversationContextModel ? (
      <DesktopConversationContext
        model={conversationContextModel}
        onOpenDetails={() => toggleTopPanel("session")}
      />
    ) : null}
    {subagents.data && subagentCount > 0 ? (
      <DesktopSubagentCard
        nodes={subagents.data.nodes}
        selectedSessionId={childSelected && selectedSession ? selectedSession.id : null}
        rpcAvailable={subagents.data.rpcAvailable}
        stale={subagents.stale}
        callbacks={{
          onSelect: handleSubagentSelect,
          onControl: async (action, childSessionId, message) => {
            await subagents.control(action, childSessionId, message);
          },
        }}
      />
    ) : null}
  </div>
) : null}
```

Do not add a new data-fetching prop or change the `ChatWindow` contract. The existing `desktopAside?: ReactNode` slot already accepts the composed stack. The top popover block remains in place for narrow layouts and quick access.

- [ ] **Step 4: Run the AppShell and subagent test set**

Run:

```bash
node --experimental-strip-types --test \
  components/AppShell.subagents.test.mjs \
  components/SubagentSessions.test.mjs \
  hooks/useSubagentTree.test.mjs \
  components/ChatWindow.subagents.test.mjs
```

Expected: all tests pass, including the new composition and wide-desktop polling contracts.

- [ ] **Step 5: Commit the integration**

```bash
git add components/AppShell.tsx components/AppShell.subagents.test.mjs
# Add ChatWindow.tsx only if it was actually changed by the type-only adjustment.
git commit -m "feat: place subagents in the desktop context gutter"
```

Do not stage `ChatWindow.plan.test.mjs`, `hooks/useAgentSession.test.mjs`, `hooks/useAgentSession.ts`, `.output/`, `.pi-subagents/`, `.tanstack/`, `.impeccable/`, `pi-web.log`, or the unrelated plan document already present in the worktree.

---

### Task 4: Add localized summary labels and render-level coverage

**Files:**
- Modify: `lib/i18n/messages/en.ts`
- Modify: `lib/i18n/messages/zh-CN.ts`
- Modify: `components/SubagentSessions.test.mjs`

- [ ] **Step 1: Add the exact localized key**

Add the same key to both locale maps:

```ts
"subagents.runningSummary": "{count} running"
```

and:

```ts
"subagents.runningSummary": "{count} 个运行中"
```

Keep the existing `subagents.*` namespace and do not add a separate translation file.

- [ ] **Step 2: Add English and Chinese render checks**

Render the card through the existing `I18nProvider` with the locale override used elsewhere in the repository. Assert the English `1 running` and Chinese `1 个运行中` strings, plus the localized accessible label. Also assert that a zero-node input returns an empty string.

- [ ] **Step 3: Run locale and component tests**

Run:

```bash
node --experimental-strip-types --test components/SubagentSessions.test.mjs
```

Expected: the component assertions pass. Do not create a new locale test harness for this one key.

- [ ] **Step 4: Commit the translations**

```bash
git add lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts components/SubagentSessions.test.mjs
git commit -m "feat: localize desktop subagent summary"
```

---

### Task 5: Verify desktop, narrow, and mobile behavior in Playwright

**Files:**
- Modify: `tests/subagent-sessions.e2e.spec.mjs`
- Read: `tests/fixtures/subagent-sessions.mjs`
- Read: `playwright.config.*` or the repository's existing Playwright configuration

- [ ] **Step 1: Add a wide-desktop card assertion**

Using the existing fixture and test server, add a test that waits for `[data-subagent-card="true"]`, then asserts:

```js
await expect(page.locator('[data-subagent-card="true"]')).toBeVisible();
await expect(page.locator('[data-subagent-card="true"] [role="tree"]')).toBeVisible();
await expect(page.locator('.desktop-conversation-context')).toBeVisible();
```

Assert that the conversation-context card appears before the subagent card in the DOM and that the card contains the fixture task text.

- [ ] **Step 2: Add navigation and responsive assertions**

Click a durable child row via `[data-subagent-card-row]`, then assert the child transcript/breadcrumb is visible and the normal child runtime/SSE path is not started, using the existing fixture assertions. At the narrow viewport, assert the right-gutter card is absent and the existing top-bar subagent control remains available.

- [ ] **Step 3: Run only the feature E2E suite**

Run:

```bash
npx playwright test tests/subagent-sessions.e2e.spec.mjs --project=chromium
```

Expected: all existing and new subagent scenarios pass. If a dev server is already running, use the repository's existing alternate port mechanism; do not kill an unrelated user server without confirmation.

- [ ] **Step 4: Inspect screenshots at both viewports**

Capture or use the test artifacts to inspect:

- wide desktop: context card above subagent card, no overlap, task text clipped inside rows;
- narrow desktop/mobile: no right-card overflow, top popover remains reachable, no toolbar overlap.

Do not accept an exit code alone; inspect the actual rendered artifact.

- [ ] **Step 5: Commit E2E coverage**

```bash
git add tests/subagent-sessions.e2e.spec.mjs
git commit -m "test: cover desktop subagent context card"
```

---

### Task 6: Run the final acceptance gate and prepare handoff

**Files:**
- Read: all changed files from `git diff 1524703..HEAD`
- Modify: only files needed to fix a failing acceptance check

- [ ] **Step 1: Run the complete targeted subagent suite**

```bash
node --experimental-strip-types --test \
  app/api/agent/'[id]'/subagents/route.test.mjs \
  components/AppShell.subagents.test.mjs \
  components/SubagentSessions.test.mjs \
  components/ChatWindow.subagents.test.mjs \
  hooks/useSubagentTree.test.mjs \
  lib/subagent-rpc.test.mjs \
  lib/subagent-tree.test.mjs
```

Expected: all tests pass with zero failures, cancellations, or skipped tests.

- [ ] **Step 2: Run static checks**

```bash
npx tsc --noEmit
npm run lint -- --quiet
git diff --check
```

Expected: TypeScript and ESLint exit 0, and `git diff --check` prints no whitespace errors.

- [ ] **Step 3: Run the feature Playwright suite again**

```bash
npx playwright test tests/subagent-sessions.e2e.spec.mjs --project=chromium
```

Expected: all feature E2E tests pass at wide and narrow/mobile coverage.

- [ ] **Step 4: Check the final staged scope**

```bash
git status --short
git diff --cached --name-only
```

Expected: only the planned subagent card, AppShell, i18n, CSS, and test files are staged. Existing user changes and generated artifacts remain untouched and unstaged.

- [ ] **Step 5: Report the handoff**

Return:

- commits created;
- files changed;
- exact test commands and pass counts;
- screenshot paths and viewport sizes;
- any baseline failures clearly separated from new failures;
- residual risks, especially provider/RPC compatibility and the existing historical fallback.

Do not push or open a pull request unless the repository owner separately authorizes that action.
