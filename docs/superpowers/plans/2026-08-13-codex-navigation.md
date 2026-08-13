# Codex Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session-aware sidebar search and a keyboard-first Codex-style quick switcher.

**Architecture:** Keep `CodexSidebar` as the owner of project/session data and derive both sidebar and dialog results from those arrays. Use a native modal dialog and existing selection callbacks, with no dependency or persistence changes.

**Tech Stack:** React 19, TypeScript, native HTML dialog, existing CSS tokens, Node test runner.

---

### Task 1: Specify observable navigation behavior

**Files:**
- Modify: `components/CodexSidebar.test.mjs`

- [x] Add a failing source-level regression test for session filtering, native dialog use, global shortcut handling, and arrow-key navigation.
- [x] Run `node --experimental-strip-types --test components/CodexSidebar.test.mjs` and confirm the new test fails because the feature is absent.

### Task 2: Implement sidebar and quick-switch search

**Files:**
- Modify: `components/CodexSidebar.tsx`
- Modify: `app/globals.css`
- Modify: `lib/i18n/messages/en.ts`
- Modify: `lib/i18n/messages/zh-CN.ts`

- [x] Filter project rows by project metadata or matching session title/first message.
- [x] Force matching projects open and render only matching session rows when the match came from a session.
- [x] Add the native quick-switch dialog, global `Meta+K`/`Ctrl+K`, arrows, Enter, Escape, focus restoration, and responsive styles.
- [x] Keep English and Simplified Chinese registry keys synchronized.

### Task 3: Verify behavior

**Files:**
- Test: `components/CodexSidebar.test.mjs`

- [x] Run the focused sidebar test and confirm all cases pass.
- [x] Run `node_modules/.bin/tsc --noEmit`.
- [x] Run `npm test` and distinguish the pre-existing `.output/` environment failure.
- [ ] Inspect desktop and mobile behavior in the browser; browser automation was unavailable in this run.
