# Compact Sidebar Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the brand-heavy sidebar header with a new-session button and compact workspace toolbar.

**Architecture:** Keep all project management handlers in `CodexSidebar`; only reorganize their controls. Search becomes a toolbar-triggered inline input and uses the existing filter state.

**Tech Stack:** React, TypeScript, Lucide, CSS, Node test runner.

---

### Task 1: Lock the compact toolbar contract

**Files:**
- Modify: `components/CodexSidebar.test.mjs`

- [ ] Add a failing source-contract test requiring the new-session button, workspace toolbar, toolbar search trigger, and removal of the old Pi Web brand/refresh header.
- [ ] Run `node --experimental-strip-types --test components/CodexSidebar.test.mjs` and confirm the new assertion fails.

### Task 2: Implement the compact header

**Files:**
- Modify: `components/CodexSidebar.tsx`
- Modify: `app/globals.css`

- [ ] Add toolbar-controlled search state and focus behavior.
- [ ] Remove the brand header and refresh action.
- [ ] Render the new-session button, workspace toolbar, and conditionally expanded search input using existing handlers.
- [ ] Update styles for the reference hierarchy without changing project/recent lists.
- [ ] Run focused tests and confirm all pass.

### Task 3: Verify the surface

**Files:**
- Test: `components/CodexSidebar.test.mjs`
- Test: `components/AppShell.mobile-toolbar.test.mjs`

- [ ] Run both focused test files.
- [ ] Check `git diff --check`.
