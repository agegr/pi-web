# Codex Dialog System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every Pi Web modal surface to the approved Codex-style dialog system without changing existing workflows.

**Architecture:** Add one small native-dialog shell for standard confirmation, request, input, editor, and tool surfaces. Keep workflow state in the existing owner components; reuse shared CSS classes for provider/search dialogs and full-screen viewers where a standardized content shell would be constraining.

**Tech Stack:** React, TypeScript, native `<dialog>`, Lucide icons, CSS, Node test runner.

---

### Task 1: Shared native dialog shell

**Files:**
- Create: `components/DialogShell.tsx`
- Create: `components/DialogShell.test.mjs`
- Modify: `app/globals.css`

- [ ] Add failing tests for native `showModal`, focus restoration, Escape/backdrop dismissal, size classes, close control, footer, desktop dimensions, mobile bottom sheets, tool fullscreen behavior, and reduced motion.
- [ ] Run `node --experimental-strip-types --test components/DialogShell.test.mjs` and confirm failure because the shell does not exist.
- [ ] Implement a minimal `DialogShell` with `size`, `title`, `subtitle`, `onClose`, `dismissible`, `showClose`, `bodyClassName`, `footer`, and `children` props.
- [ ] Add shared `codex-dialog-*` styles using the fixed values from the approved specification.
- [ ] Re-run the focused test and commit the shell independently.

### Task 2: Agent and extension requests

**Files:**
- Modify: `components/ChatWindow.tsx`
- Create: `components/ChatWindow.dialogs.test.mjs`
- Modify: `lib/i18n/messages/en.ts`
- Modify: `lib/i18n/messages/zh-CN.ts`

- [ ] Add failing source-contract tests for `DialogShell`, request source text, dense option rows, existing cancellation responses, input Enter, editor Ctrl/Cmd+Enter, and terminal Ctrl+C.
- [ ] Convert select, confirm, input, editor, and custom terminal overlays to native shared dialogs while preserving response payloads.
- [ ] Verify request and terminal tests and commit.

### Task 3: Confirmation and risk dialogs

**Files:**
- Modify: `components/ProjectTrustDialog.tsx`
- Modify: `components/SettingsPage.tsx`
- Modify: `components/ModelsConfig.tsx`
- Modify: `components/CodexSidebar.tsx`
- Modify: `components/SettingsPage.test.mjs`
- Modify: `components/ModelsConfig.test.mjs`
- Modify: `components/CodexSidebar.test.mjs`

- [ ] Add failing tests requiring the shared confirmation shell and prohibiting `window.confirm`.
- [ ] Convert project trust, unsaved settings, provider/model deletion, dirty-worktree force removal, and session deletion.
- [ ] Preserve busy-state cancellation guards, existing API calls, draft behavior, and focus restoration.
- [ ] Run confirmation and owner-component tests and commit.

### Task 4: Tool dialogs

**Files:**
- Modify: `components/DirectoryPicker.tsx`
- Modify: `components/ModelsConfig.tsx`
- Modify: `components/CodexSidebar.tsx`
- Create: `components/DialogTools.test.mjs`
- Modify: `app/globals.css`

- [ ] Add failing tests for tool-size classes, native dialog behavior, Escape/backdrop rules, mobile fullscreen layout, and dense provider rows.
- [ ] Migrate directory picker, provider picker, and quick switcher to the shared tool dimensions and chrome.
- [ ] Preserve filesystem creation, provider search, keyboard result navigation, and focus restoration.
- [ ] Run tool and owner-component tests and commit.

### Task 5: Full-screen viewers

**Files:**
- Modify: `components/ImagePreview.tsx`
- Modify: `components/MermaidBlock.tsx`
- Modify: `components/ImagePreview.test.mjs`
- Create: `components/MermaidBlock.dialog.test.mjs`
- Modify: `app/globals.css`

- [ ] Add failing tests requiring shared viewer toolbar/close classes and the approved backdrop values.
- [ ] Align image and Mermaid viewer chrome while preserving containment and zoom behavior.
- [ ] Run viewer tests and commit.

### Task 6: System verification

**Files:**
- Test all modified components and styles.

- [ ] Run focused dialog and owner-component tests.
- [ ] Run the full project test suite.
- [ ] Build to a fresh external `PI_WEB_TANSTACK_OUTPUT_DIR` and verify the standalone output.
- [ ] Run `git diff --check`.
- [ ] Use authenticated browser QA at 1440x900 and 390x844 to inspect request, confirmation, tool, and viewer examples; verify no overflow and all close paths.
- [ ] Review the final diff for unrelated worktree changes, then commit any final test-only adjustments.
