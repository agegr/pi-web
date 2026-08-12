# Stable Session Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse completed session process details by default while keeping the currently running turn expanded, preventing first-open layout shifts.

**Architecture:** `ChatWindow` already identifies the live tail. It will pass an explicit `defaultDetailsExpanded` property into messages of that live turn and the streaming message. `MessageView` will forward that property into thinking and tool-call disclosures; historical disclosures use their existing collapsed default. Deferred thinking remains gated behind its local expanded state.

**Tech Stack:** React, TypeScript, Node test runner, React server rendering, TanStack Start.

---

### Task 1: Define Disclosure Defaults In MessageView

**Files:**
- Modify: `components/MessageView.test.mjs`
- Modify: `components/MessageView.tsx`

- [ ] **Step 1: Write the failing rendering tests**

Replace the default-expanded test with two explicit render cases:

```js
test("collapses historical thinking and tool inputs by default", () => {
  const html = renderMessage(assistantWithThinkingAndTool());
  assert.doesNotMatch(html, /<h2>Plan<\/h2>/);
  assert.doesNotMatch(html, /command: printf/);
});

test("expands thinking and tool inputs for a live message", () => {
  const html = renderMessage(assistantWithThinkingAndTool(), { defaultDetailsExpanded: true });
  assert.match(html, /<h2>Plan<\/h2>/);
  assert.match(html, /command: printf/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test components/MessageView.test.mjs`

Expected: the historical case fails because the current component renders details expanded by default.

- [ ] **Step 3: Add the explicit default property**

Add `defaultDetailsExpanded?: boolean` to `MessageView` props, comparator, `AssistantMessageView`, `BlockView`, `ThinkingBlock`, and `ToolCallBlock`. Initialize each disclosure with `useState(defaultDetailsExpanded)`. Do not change click handlers or formatting.

- [ ] **Step 4: Keep deferred thinking lazy**

Retain the effect guard so a deferred block loads only if `expanded` is true:

```ts
if (!expanded || !block.deferred || content !== null) return;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --experimental-strip-types --test components/MessageView.test.mjs`

Expected: all MessageView tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/MessageView.tsx components/MessageView.test.mjs
git commit -m "fix: collapse historical message details"
```

### Task 2: Keep The Live Turn Expanded

**Files:**
- Modify: `components/ChatWindow.process-details.test.mjs`
- Modify: `components/ChatWindow.tsx`

- [ ] **Step 1: Write the failing source-contract test**

Replace the current process-default assertion with checks that completed groups omit `defaultExpanded`, the live-tail render path passes `defaultDetailsExpanded`, and the streaming message does too:

```js
assert.doesNotMatch(source, /<ProcessDetailsGroup[\s\S]*?defaultExpanded/);
assert.match(source, /renderMessage\(renderIdx, \{[^}]*defaultDetailsExpanded: true/);
assert.match(source, /<MessageView message=\{streamState\.streamingMessage[^>]*defaultDetailsExpanded/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test components/ChatWindow.process-details.test.mjs`

Expected: the test fails because completed groups currently receive `defaultExpanded` and live messages have no explicit default property.

- [ ] **Step 3: Pass the live-tail default exactly once**

Extend `renderMessage` options with `defaultDetailsExpanded?: boolean`, pass it to `MessageView`, and in the existing `isLiveTail` branch call `renderMessage` with `{ defaultDetailsExpanded: true }`. Pass `defaultDetailsExpanded` to the separate `streamState.streamingMessage` view.

Remove `defaultExpanded` from completed `ProcessDetailsGroup` usage so its existing default (`false`) applies.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test components/ChatWindow.process-details.test.mjs components/MessageView.test.mjs`

Expected: both suites pass.

- [ ] **Step 5: Commit**

```bash
git add components/ChatWindow.tsx components/ChatWindow.process-details.test.mjs
git commit -m "fix: expand only live session details"
```

### Task 3: Verify Stability And Production Build

**Files:**
- Verify: `components/ChatWindow.tsx`
- Verify: `components/MessageView.tsx`

- [ ] **Step 1: Run static validation**

Run:

```bash
npx tsc --noEmit
npx eslint components/ChatWindow.tsx components/ChatWindow.process-details.test.mjs components/MessageView.tsx components/MessageView.test.mjs
node --experimental-strip-types --test components/ChatWindow.process-details.test.mjs components/MessageView.test.mjs components/MarkdownBody.test.mjs
```

Expected: all commands exit zero.

- [ ] **Step 2: Build a standalone output outside the repository**

Run:

```bash
output_dir=$(mktemp -d /tmp/pi-web-stable-details.XXXXXX)
PI_WEB_TANSTACK_OUTPUT_DIR="$output_dir" npm run build:tanstack:standalone
```

Expected: build exits zero and creates `$output_dir/server/index.mjs`.

- [ ] **Step 3: Browser-check a long real session**

Open a completed session and verify every visible `Process details` button initially has `aria-expanded="false"`. Check that no `.markdown-thinking` nodes mount until a disclosure is opened. Open a current working session and verify its live details are expanded. Capture desktop and narrow viewport screenshots.

- [ ] **Step 4: Compare initial-load layout behavior**

Use a `PerformanceObserver` for `layout-shift` and sample chat scroll height during first load. Confirm the long completed session does not mount all historical Markdown blocks or jump from a short shell to a six-figure-pixel content height.

- [ ] **Step 5: Commit plan completion state if changed**

```bash
git status --short
```

Expected: only intentional implementation commits exist; do not include unrelated worktree changes or generated output.

## Plan Self-Review

- Spec coverage: Task 1 covers historical and live block defaults plus deferred loading. Task 2 assigns live-tail ownership to `ChatWindow` and returns completed process groups to collapsed defaults. Task 3 checks source, runtime, build, and measured layout stability.
- Placeholder scan: no placeholders or deferred decisions remain.
- Type consistency: `defaultDetailsExpanded` is the same optional boolean from `ChatWindow` through `MessageView`, `AssistantMessageView`, `BlockView`, `ThinkingBlock`, and `ToolCallBlock`.
