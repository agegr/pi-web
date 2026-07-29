# Turn Artifact Preview Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under each assistant reply, show a row of clickable chips for the files that turn's `write`/`edit` tool calls actually produced (successful only), each opening the right-hand `FileViewer` preview.

**Architecture:** A pure extractor (`extractTurnArtifacts`) reads the assistant message's `toolCall` blocks + the session `toolResults` map + `cwd`, resolves each produced file to an absolute path via the existing `resolveLocalFileHref`, dedupes, and returns a list. A small presentational component (`TurnArtifacts`) renders one chip per file. `AssistantMessageView` computes the list with `useMemo` and renders the component below the reply's content blocks. No markdown mutation, no prose parsing, no new dependencies.

**Tech Stack:** Next.js 16, React 19, TypeScript, `node:test` + `jiti` for tests.

**Branch:** `feat/turn-artifact-preview-links` (based on `feat/chat-file-path-links`). Spec: `docs/superpowers/specs/2026-07-29-turn-artifact-preview-links-design.md`.

## Global Constraints

- **No new dependencies.** Reuse `resolveLocalFileHref` (`lib/file-links.ts:77`), `getFileName` (`lib/file-paths.ts:16`), and the types in `lib/types.ts`.
- **Path read order:** `input.file_path ?? input.path` (matches the agent's own `write.js`/`edit.js`). Non-string or missing → skip.
- **`write`/`edit` tool-name detection** (self-contained in `lib/turn-artifacts.ts`, do NOT import from `components/`):
  - `write`: `toolName.toLowerCase() === "write"`
  - `edit` family: `name === "edit"` || `name.startsWith("edit_")` || `name.endsWith(".edit")` || `name.endsWith("_edit")` || `name.includes("str_replace")` || `name.includes("replace_editor")` (verbatim copy of `isEditToolName` at `components/MessageView.tsx:1012`)
- **Success gate:** a tool call contributes a chip only when its result exists in `toolResults` AND `isError` is not `true` — i.e. skip when `!result || result.isError`. This means during streaming a file appears only after its tool result lands.
- **Dedupe** by resolved absolute `filePath`, preserving first-seen order. **Per-turn** (each assistant message aggregates only its own `content`).
- **No extension filtering** — list every successfully produced `write`/`edit` target; the `FileViewer` handles rendering.
- **`TurnArtifacts` lives in its own file** `components/TurnArtifacts.tsx` (not inline in `MessageView.tsx`) so it is unit-testable in isolation; `MessageView.tsx` is too large to pull into a `jiti` test and the repo tests leaf components in their own files.
- **No i18n label** — chips are icon + basename only, so no translation keys are touched and the change stays within `lib/` + `components/`.
- **Test conventions:** `lib/*.test.mjs` and `components/*.test.mjs` use `node:test` + `jiti` (see existing `lib/file-path-scan.test.mjs` and `components/MarkdownBody.test.mjs`). Component tests render with `renderToStaticMarkup` (SSR) — assert on rendered HTML, not on click events.
- **Commit messages** are Conventional Commits (`feat: ...` / `fix: ...`) and end with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Create `lib/turn-artifacts.ts`** — pure extractor + `TurnArtifact` type. Self-contained tool-name detection; reuses `resolveLocalFileHref`. One responsibility: "which absolute file paths did this turn successfully produce?"
- **Create `lib/turn-artifacts.test.mjs`** — unit tests for the extractor (the logic core).
- **Create `components/TurnArtifacts.tsx`** — presentational chip row. Reuses `getFileName`. One responsibility: render a list of `{ filePath }` as clickable buttons.
- **Create `components/TurnArtifacts.test.mjs`** — SSR render test for the component.
- **Modify `components/MessageView.tsx`** — import the extractor + component, compute artifacts in `AssistantMessageView`, render below the content blocks.

---

### Task 1: Pure extractor `extractTurnArtifacts` + unit tests

**Files:**
- Create: `lib/turn-artifacts.ts`
- Test: `lib/turn-artifacts.test.mjs`

**Interfaces:**
- Consumes: `resolveLocalFileHref(href, baseDir?, relativeRoot?): string | null` from `./file-links`; types `AssistantContentBlock`, `ToolResultMessage` from `./types`.
- Produces:
  ```ts
  export interface TurnArtifact { filePath: string } // resolved absolute path
  export function extractTurnArtifacts(
    content: AssistantContentBlock[],
    toolResults: Map<string, ToolResultMessage> | undefined,
    cwd?: string,
  ): TurnArtifact[]
  ```
  Later tasks consume `TurnArtifact` and `extractTurnArtifacts` by these exact names.

- [ ] **Step 1: Write the failing tests**

Create `lib/turn-artifacts.test.mjs` with this exact content:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { extractTurnArtifacts } = await jiti.import("./turn-artifacts.ts");

function toolCall(toolCallId, toolName, input) {
  return { type: "toolCall", toolCallId, toolName, input };
}

function okResult(toolCallId) {
  return { role: "toolResult", toolCallId, content: [{ type: "text", text: "ok" }] };
}

function errorResult(toolCallId) {
  return { role: "toolResult", toolCallId, content: [{ type: "text", text: "boom" }], isError: true };
}

function results(...entries) {
  return new Map(entries.map((r) => [r.toolCallId, r]));
}

function paths(content, toolResults, cwd) {
  return extractTurnArtifacts(content, toolResults, cwd).map((a) => a.filePath);
}

test("extracts a file from a successful write tool call", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html" })];
  assert.deepEqual(paths(content, results(okResult("1"))), ["/abs/out/report.html"]);
});

test("extracts a file from a successful edit tool call using input.path", () => {
  const content = [toolCall("1", "edit", { path: "/abs/src/a.ts" })];
  assert.deepEqual(paths(content, results(okResult("1"))), ["/abs/src/a.ts"]);
});

test("recognizes edit-family tool names", () => {
  const content = [toolCall("1", "str_replace_editor", { file_path: "/abs/src/a.ts" })];
  assert.deepEqual(paths(content, results(okResult("1"))), ["/abs/src/a.ts"]);
});

test("skips a tool call whose result errored", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html" })];
  assert.deepEqual(paths(content, results(errorResult("1"))), []);
});

test("skips a tool call whose result has not arrived (streaming)", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html" })];
  assert.deepEqual(paths(content, results()), []);
  assert.deepEqual(paths(content, undefined), []);
});

test("deduplicates the same file written then edited", () => {
  const content = [
    toolCall("1", "write", { file_path: "/abs/out/report.html" }),
    toolCall("2", "edit", { path: "/abs/out/report.html" }),
  ];
  assert.deepEqual(paths(content, results(okResult("1"), okResult("2"))), ["/abs/out/report.html"]);
});

test("resolves a relative path against cwd", () => {
  const content = [toolCall("1", "write", { file_path: "out/report.html" })];
  assert.deepEqual(paths(content, results(okResult("1")), "/abs"), ["/abs/out/report.html"]);
});

test("skips non-artifact tools like read and bash", () => {
  const content = [
    toolCall("1", "read", { file_path: "/abs/a.ts" }),
    toolCall("2", "bash", { command: "echo hi > /abs/a.txt" }),
  ];
  assert.deepEqual(paths(content, results(okResult("1"), okResult("2"))), []);
});

test("skips a write call missing both file_path and path", () => {
  const content = [toolCall("1", "write", { content: "hi" })];
  assert.deepEqual(paths(content, results(okResult("1"))), []);
});

test("returns an empty array for an empty or text-only turn", () => {
  assert.deepEqual(paths([], results()), []);
  assert.deepEqual(paths([{ type: "text", text: "hi" }], results()), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test lib/turn-artifacts.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` / module `./turn-artifacts.ts` cannot be resolved (the file does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/turn-artifacts.ts` with this exact content:

```ts
import type { AssistantContentBlock, ToolResultMessage } from "./types";
import { resolveLocalFileHref } from "./file-links";

export interface TurnArtifact {
  /** Resolved absolute path of a file produced this turn. */
  filePath: string;
}

function isWriteToolName(toolName: string): boolean {
  return toolName.toLowerCase() === "write";
}

function isEditToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return (
    name === "edit" ||
    name.startsWith("edit_") ||
    name.endsWith(".edit") ||
    name.endsWith("_edit") ||
    name.includes("str_replace") ||
    name.includes("replace_editor")
  );
}

function isArtifactToolName(toolName: string): boolean {
  return isWriteToolName(toolName) || isEditToolName(toolName);
}

function readToolPath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const value = input.file_path ?? input.path;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Collect the distinct files a single assistant turn successfully produced.
 *
 * Iterates the turn's `toolCall` blocks, keeps `write`/`edit` calls whose
 * result exists and did not error, resolves each path against `cwd`, dedupes
 * by absolute path, and preserves first-seen order.
 */
export function extractTurnArtifacts(
  content: AssistantContentBlock[],
  toolResults: Map<string, ToolResultMessage> | undefined,
  cwd?: string,
): TurnArtifact[] {
  const seen = new Set<string>();
  const artifacts: TurnArtifact[] = [];

  for (const block of content) {
    if (block.type !== "toolCall") continue;
    if (!isArtifactToolName(block.toolName)) continue;

    const result = toolResults?.get(block.toolCallId);
    if (!result || result.isError) continue;

    const rawPath = readToolPath(block.input);
    if (!rawPath) continue;

    const filePath = resolveLocalFileHref(rawPath, cwd);
    if (!filePath) continue;

    if (seen.has(filePath)) continue;
    seen.add(filePath);
    artifacts.push({ filePath });
  }

  return artifacts;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test lib/turn-artifacts.test.mjs`
Expected: PASS — 10 tests, 0 fail.

- [ ] **Step 5: Run the full lib suite to confirm no regression**

Run: `node --experimental-strip-types --test lib/*.test.mjs`
Expected: PASS — all lib tests green (previous total was 158; now 158 + 10 = 168).

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/turn-artifacts.ts lib/turn-artifacts.test.mjs
git commit -m "$(cat <<'EOF'
feat(turn-artifacts): extract produced files from a turn's tool calls

Pure extractor that collects the distinct absolute paths a single assistant
turn successfully produced via write/edit tool calls, resolved against cwd.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `TurnArtifacts` chip-row component + render test

**Files:**
- Create: `components/TurnArtifacts.tsx`
- Test: `components/TurnArtifacts.test.mjs`

**Interfaces:**
- Consumes: `TurnArtifact` (from `@/lib/turn-artifacts`, Task 1), `getFileName(filePath: string): string` (from `@/lib/file-paths`).
- Produces: `TurnArtifacts({ artifacts, onOpenFile })` — renders `null` when `artifacts` is empty, otherwise a wrapping `div` of `<button>` chips. Task 3 renders `<TurnArtifacts artifacts={artifacts} onOpenFile={onOpenFile} />`.

- [ ] **Step 1: Write the failing test**

Create `components/TurnArtifacts.test.mjs` with this exact content:

```js
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { TurnArtifacts } = await jiti.import("./TurnArtifacts.tsx");

function render(props) {
  return renderToStaticMarkup(React.createElement(TurnArtifacts, props));
}

test("renders a chip per artifact showing the basename and absolute path", () => {
  const html = render({
    artifacts: [{ filePath: "/abs/out/report.html" }, { filePath: "/abs/out/data.json" }],
    onOpenFile() {},
  });
  assert.match(html, /<button/);
  assert.match(html, /report\.html/);
  assert.match(html, /data\.json/);
  assert.match(html, /title="\/abs\/out\/report\.html"/);
  assert.match(html, /title="\/abs\/out\/data\.json"/);
});

test("renders nothing when there are no artifacts", () => {
  assert.equal(render({ artifacts: [], onOpenFile() {} }), "");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test components/TurnArtifacts.test.mjs`
Expected: FAIL — cannot resolve `./TurnArtifacts.tsx`.

- [ ] **Step 3: Write the component**

Create `components/TurnArtifacts.tsx` with this exact content:

```tsx
import { getFileName } from "@/lib/file-paths";
import type { TurnArtifact } from "@/lib/turn-artifacts";

export function TurnArtifacts({ artifacts, onOpenFile }: {
  artifacts: TurnArtifact[];
  onOpenFile?: (filePath: string) => void;
}) {
  if (artifacts.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
      {artifacts.map((artifact) => (
        <button
          key={artifact.filePath}
          type="button"
          title={artifact.filePath}
          onClick={() => onOpenFile?.(artifact.filePath)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            color: "var(--text)",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8A1.5 1.5 0 0 0 13.5 13V6z" />
            <path d="M9 1.5V6h4.5" />
          </svg>
          <span>{getFileName(artifact.filePath)}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test components/TurnArtifacts.test.mjs`
Expected: PASS — 2 tests, 0 fail.

- [ ] **Step 5: Run the full components suite to confirm no regression**

Run: `node --test components/*.test.mjs`
Expected: PASS — all component tests green (previous total was 24 across 5 files; now 24 + 2 = 26 across 6 files).

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add components/TurnArtifacts.tsx components/TurnArtifacts.test.mjs
git commit -m "$(cat <<'EOF'
feat(turn-artifacts): add TurnArtifacts chip-row component

Presentational component rendering one clickable chip per produced file;
clicking calls onOpenFile with the absolute path. Renders nothing when empty.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wire `TurnArtifacts` into `AssistantMessageView`

**Files:**
- Modify: `components/MessageView.tsx` (import block ~lines 3-22; `AssistantMessageView` body ~line 402 and render ~line 533)

**Interfaces:**
- Consumes: `extractTurnArtifacts` + `TurnArtifact` (Task 1), `TurnArtifacts` component (Task 2). `AssistantMessageView` already receives `message: AssistantMessage`, `toolResults?: Map<string, ToolResultMessage>`, `cwd?: string`, and `onOpenFile?: (filePath: string) => void` (verified at `components/MessageView.tsx:341-363`).

**Note on testing this task:** `MessageView.tsx` is a large `"use client"` module whose import graph (markdown, katex, streaming effects) is not unit-tested in this repo — there is no `MessageView.test.mjs`. The behavioral logic is already covered by Task 1 (extractor) and Task 2 (component). This task is integration glue; its gate is a clean type-check/build, lint, and a dev-boot smoke check.

- [ ] **Step 1: Add the imports**

In `components/MessageView.tsx`, in the import block near the top (alongside the other `@/lib` imports around lines 5-8), add:

```tsx
import { extractTurnArtifacts } from "@/lib/turn-artifacts";
import { TurnArtifacts } from "./TurnArtifacts";
```

- [ ] **Step 2: Compute the artifacts in `AssistantMessageView`**

In `AssistantMessageView` (the function starting at `components/MessageView.tsx:341`), immediately after the `toolCallDurations` `useMemo` block (which ends at line 402), add:

```tsx
  const artifacts = useMemo(
    () => extractTurnArtifacts(message.content ?? [], toolResults, cwd),
    [message.content, toolResults, cwd],
  );
```

(`useMemo` is already imported at line 3. `message.content ?? []` mirrors the existing defensive read at line 366.)

- [ ] **Step 3: Render the chip row below the content blocks**

In `AssistantMessageView`'s return, the content blocks are rendered inside a column `<div>` that closes at line 533 (`</div>`), immediately before the footer `<div>` at line 535. Insert the conditional chip row between those two divs:

```tsx
        {artifacts.length > 0 && (
          <TurnArtifacts artifacts={artifacts} onOpenFile={onOpenFile} />
        )}
```

The surrounding structure after the edit looks like:

```tsx
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {blockItems.map(({ block, originalIndex }) => (
          <BlockView key={`${entryId ?? "stream"}-${originalIndex}`} block={block} toolResults={toolResults} isStreaming={isStreaming} streamingDuration={streamingDurations.get(originalIndex) ?? (block.type === "thinking" ? thinkingDurationFromFile : undefined)} toolCallDurations={toolCallDurations} cwd={cwd} onOpenFile={onOpenFile} sessionId={sessionId} entryId={entryId} blockIndex={originalIndex} />
        ))}
      </div>

      {artifacts.length > 0 && (
        <TurnArtifacts artifacts={artifacts} onOpenFile={onOpenFile} />
      )}

      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginTop: 4,
      }}>
```

- [ ] **Step 4: Re-run the extractor and component suites (unchanged code, must stay green)**

Run: `node --test lib/turn-artifacts.test.mjs components/TurnArtifacts.test.mjs`
Expected: PASS — 12 tests, 0 fail.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 6: Build (type-check + Next build)**

Run: `npm run build`
Expected: exit 0, "✓ Compiled successfully". This verifies the new imports resolve, the `useMemo` types line up, and the JSX is valid.

- [ ] **Step 7: Dev-boot smoke check**

Run the dev server in the background: `npm run dev` (serves at `http://127.0.0.1:30141`).
Then: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:30141/`
Expected: `200`. Then stop the dev server and confirm port 30141 is free.

- [ ] **Step 8: Commit**

```bash
git add components/MessageView.tsx
git commit -m "$(cat <<'EOF'
feat(turn-artifacts): show produced-file chips under each assistant reply

AssistantMessageView aggregates the turn's successful write/edit outputs and
renders a TurnArtifacts chip row below the content blocks; clicking a chip
opens the file in the right-hand preview.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (run after writing, fix inline)

**Spec coverage:**
- Data source = tool-call ground truth (`write`/`edit`, `file_path ?? path`) → Task 1.
- Form = chip row below prose → Task 2 + Task 3.
- Rules: success-only + require-result / dedupe / per-turn / no ext filter → Task 1 + Global Constraints.
- Security: reuse `resolveLocalFileHref` (isPathInside) + same gate as existing feature → Task 1.
- Known gap: bash indirect writes not detected → `bash` is not a `write`/`edit` tool name, so it is naturally skipped (covered by the "skips non-artifact tools like read and bash" test).
- Tests: extractor unit tests (Task 1) + component render test (Task 2) + build/lint/smoke for wiring (Task 3).
- Out of scope (YAGNI): create-vs-modify tag, cross-turn aggregation, copy/download, in-place tool-call click, extension filtering — none implemented; none referenced.

**Placeholder scan:** None. All code blocks are complete and verbatim.

**Type consistency:** `TurnArtifact { filePath: string }` (Task 1) → consumed by name in Task 2 (`import type { TurnArtifact }`) and Task 3 (`extractTurnArtifacts` returns it, `<TurnArtifacts artifacts={artifacts} ...>`). `extractTurnArtifacts(content, toolResults, cwd)` signature identical across all three tasks. `TurnArtifacts({ artifacts, onOpenFile })` identical in Task 2 (defined) and Task 3 (used).
