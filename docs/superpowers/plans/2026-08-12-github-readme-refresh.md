# GitHub README Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the English and Simplified Chinese GitHub introductions and capture three privacy-safe screenshots that present both Pi Web's current workflows and its TanStack Start foundation.

**Architecture:** Documentation-only changes are developed in an isolated worktree based on the exact latest `origin/main`. Screenshots come from the real app running against a disposable agent directory and demo repository; only the final PNG assets enter git.

**Tech Stack:** Markdown, TanStack Start/Vite dev server, Kimi WebBridge/Chrome DevTools Protocol, Node.js test runner, ESLint, TypeScript.

---

### Task 1: Create The Isolated Demo Environment

**Files:**
- Create outside repository: temporary Pi agent directory, demo repository, and session fixtures

- [ ] Create a disposable directory with `mktemp -d` and a demo Git repository containing representative source, Markdown, and configuration files.
- [ ] Create synthetic Pi session JSONL fixtures only after inspecting the repository's session parser and sample fixtures for the exact supported schema.
- [ ] Start the exact worktree application with `PI_CODING_AGENT_DIR` pointing at the disposable agent directory, `PI_WEB_HOSTNAME=127.0.0.1`, an unused port, and no real credential environment variables.
- [ ] Verify root, sessions, projects, settings, and file endpoints return expected non-sensitive demo content.

### Task 2: Capture And Validate Screenshots

**Files:**
- Create: `docs/pi-web-workspace.png`
- Create: `docs/pi-web-projects.png`
- Create: `docs/pi-web-settings.png`

- [ ] Use the real browser at a stable desktop viewport to arrange a complete workspace view and capture `docs/pi-web-workspace.png` without browser chrome.
- [ ] Arrange the project sidebar to show grouped sessions, running state, archive affordance, and a linked worktree; capture `docs/pi-web-projects.png` with a tight but readable crop.
- [ ] Open Settings and capture `docs/pi-web-settings.png` with Models, Providers, Plugins, and Skills visible and no credential material.
- [ ] Inspect all three PNGs at original resolution and scan visible text for `/Users/kale`, real project names, keys, tokens, personal session names, and other private content.
- [ ] Verify dimensions and nonblank pixel content, then stop the demo server while retaining no tracked fixture files.

### Task 3: Rewrite The English README

**Files:**
- Modify: `README.md`

- [ ] Rewrite the opening around the product purpose and one-command start.
- [ ] Add the three screenshots near the workflow they demonstrate, with concise, descriptive alt text and repository-relative paths.
- [ ] Describe project navigation, live activity, session relationships, worktrees, files, configuration, and responsive/PWA behavior.
- [ ] Add a compact technical-foundation section covering TanStack Start, Vite, Nitro, framework-neutral API handlers, SSE, request security, Windows CI, and install-package verification without volatile test totals.
- [ ] Preserve and tighten CLI configuration, remote-access warning, proxy setup, operational notes, development commands, repository layout, and license.

### Task 4: Rewrite The Simplified Chinese README

**Files:**
- Modify: `README.zh-CN.md`

- [ ] Mirror the English README's section order and meaning in idiomatic Simplified Chinese.
- [ ] Use the same image targets with Chinese alt text.
- [ ] Preserve the Chinese community link and the same security warnings and operational details as English.
- [ ] Compare headings, tables, commands, links, and feature claims side by side to prevent translation drift.

### Task 5: Documentation And Product Verification

**Files:**
- Verify: `README.md`
- Verify: `README.zh-CN.md`
- Verify: `docs/pi-web-workspace.png`
- Verify: `docs/pi-web-projects.png`
- Verify: `docs/pi-web-settings.png`

- [ ] Run a local Markdown target check for every relative link and image in both READMEs; expected result is zero missing targets.
- [ ] Render or inspect both READMEs at GitHub-like content width and confirm images, tables, headings, and code blocks are coherent.
- [ ] Run `env -u NODE_ENV -u PI_WEB_PASSWORD npm test`; expected result is all tests passing.
- [ ] Run `env -u NODE_ENV -u PI_WEB_PASSWORD npm run lint`; expected result is zero errors.
- [ ] Run `env -u NODE_ENV -u PI_WEB_PASSWORD npx tsc --noEmit`; expected result is exit 0.
- [ ] Run `git diff --check`, verify no `.output`, no temporary demo data, and no unrelated files.
- [ ] Commit the verified README and screenshot changes.

### Task 6: Merge And Push GitHub Main

**Files:**
- Merge the completed `docs/github-readme-refresh` branch into `main`

- [ ] Fetch `origin` and verify remote `main` has not moved from the documented base; if it moved, inspect and integrate it before proceeding.
- [ ] Merge the documentation branch into local `main` using a normal non-force merge while preserving the user's untracked `pi-web.log`.
- [ ] Re-run the Markdown target check and `git diff --check` on the exact merged result.
- [ ] Push local `main` to GitHub with a normal non-force push.
- [ ] Use `git ls-remote` to confirm `refs/heads/main` equals the verified merged SHA. Keep the documentation worktree unless the user later requests cleanup.
