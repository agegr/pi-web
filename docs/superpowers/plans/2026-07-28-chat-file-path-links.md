# Chat File Path Preview Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn bare absolute file paths in assistant chat replies into clickable links that open in the right-hand FileViewer panel.

**Architecture:** A remark plugin operates on the mdast tree, splitting `text` nodes that contain absolute file paths into `text` + `link` + `text` sequences. Because code blocks are `code` nodes and inline code is `inlineCode` — neither is a `text` node — they are skipped structurally with no explicit checks. The generated `link` nodes flow into `MarkdownBody`'s existing `a()` handler, which already calls `resolveLocalFileHref()` and `onOpenFile()`. No downstream component changes.

**Tech Stack:** TypeScript, Next.js 16, react-markdown 10, remark (mdast), `node:test` + `jiti` for tests.

## Global Constraints

- Node.js `>=22.19.0` (`package.json` engines). Local dev machine is v23.1.0.
- **Do NOT add any new package.json dependency.** Specifically do not install `unist-util-visit` — it is not a direct dependency and may only exist transitively. The plugin walks the tree with a hand-written recursion (~15 lines).
- `lib/file-types.ts` is imported by client components (`FileViewer.tsx`). It must stay browser-safe: **never import `node:path`, `node:fs`, or any Node builtin into it.** Use the existing private `getBaseName()` string helper.
- Scope is fixed and must not expand: assistant reply body prose only; absolute paths only; previewable extensions only. Do not touch `ToolCallBlock` (`components/MessageView.tsx:687`) — the tool-card gap is tracked separately.
- Existing behaviour must not regress: `components/MarkdownBody.test.mjs` currently passes and must continue to pass.

### Running tests

`node_modules` is **not installed** in this working copy. Task 1 installs it.

All new tests use `jiti`, because a plain `await import("./x.ts")` **cannot** resolve an extensionless cross-file TypeScript value import (verified: `ERR_MODULE_NOT_FOUND` for `./file-types` when importing `lib/git-changes.ts`). `jiti` compiles TypeScript itself and resolves those specifiers.

Standard command for a single new test file:

```bash
node --test lib/file-path-scan.test.mjs
```

If a test file that uses a plain `import("./x.ts")` (the older pattern, e.g. `lib/file-types.test.mjs`) fails with `ERR_UNKNOWN_FILE_EXTENSION`, that is the Node version — type stripping is only on by default from Node 23.6. Re-run those with:

```bash
node --experimental-strip-types --test lib/file-types.test.mjs
```

`jiti`-based test files do not need that flag.

---

### Task 1: Share the previewable-extension whitelist

The extension whitelist currently lives in three places: `EXT_TO_LANGUAGE` inside the API route, plus the image and audio maps in `lib/file-types.ts`. The scanner needs all three. Move the language map into `lib/file-types.ts` so there is one source and no drift.

**Files:**
- Modify: `lib/file-types.ts` (append after the existing `isDocumentPreviewPath`, ends line 73)
- Modify: `app/api/files/[...path]/route.ts:47-69` (delete local `EXT_TO_LANGUAGE` and `getLanguage`, import instead)
- Test: `lib/file-types.test.mjs` (append)

**Interfaces:**
- Consumes: existing private `getBaseName()` and exported `getFileExt()` in `lib/file-types.ts`
- Produces:
  - `EXT_TO_LANGUAGE: Record<string, string>`
  - `getLanguageForPath(filePath: string): string`
  - `PREVIEWABLE_EXTENSIONS: ReadonlySet<string>`
  - `isPreviewableExtension(filePath: string): boolean`

- [ ] **Step 1: Install dependencies**

`node_modules` is absent, so nothing can run yet.

```bash
npm install
```

Expected: completes without error; `node_modules/jiti` exists.

- [ ] **Step 2: Write the failing test**

Append to `lib/file-types.test.mjs`:

```js
test("classifies previewable extensions", async () => {
  const { isPreviewableExtension, getLanguageForPath } = await loadSubject();

  assert.equal(isPreviewableExtension("/tmp/report.html"), true);
  assert.equal(isPreviewableExtension("/tmp/notes.md"), true);
  assert.equal(isPreviewableExtension("/tmp/shot.PNG"), true);
  assert.equal(isPreviewableExtension("/tmp/voice.opus"), true);
  assert.equal(isPreviewableExtension("/tmp/paper.pdf"), true);

  assert.equal(isPreviewableExtension("/usr/bin"), false);
  assert.equal(isPreviewableExtension("/tmp/data.xyz"), false);

  assert.equal(getLanguageForPath("/tmp/a.tsx"), "typescript");
  assert.equal(getLanguageForPath("/tmp/Dockerfile"), "dockerfile");
  assert.equal(getLanguageForPath("/tmp/.env.local"), "bash");
  assert.equal(getLanguageForPath("C:\\Users\\me\\Makefile"), "makefile");
  assert.equal(getLanguageForPath("/tmp/unknown.xyz"), "text");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --experimental-strip-types --test lib/file-types.test.mjs`
Expected: FAIL — `isPreviewableExtension is not a function`

- [ ] **Step 4: Add the shared whitelist to `lib/file-types.ts`**

Append to the end of `lib/file-types.ts`:

```ts
export const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
  go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
  html: "html", htm: "html", css: "css", scss: "css", less: "css",
  json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", xml: "xml", md: "markdown", mdx: "markdown",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  sql: "sql", graphql: "graphql", gql: "graphql",
  dockerfile: "dockerfile", tf: "hcl", hcl: "hcl",
  env: "bash", gitignore: "bash", txt: "text",
  pdf: "pdf", docx: "word",
};

export function getLanguageForPath(filePath: string): string {
  const base = getBaseName(filePath).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "bash";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  const ext = base.split(".").pop() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "text";
}

export const PREVIEWABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...Object.keys(EXT_TO_LANGUAGE),
  ...Object.keys(IMAGE_EXT_TO_MIME),
  ...Object.keys(AUDIO_EXT_TO_MIME),
]);

export function isPreviewableExtension(filePath: string): boolean {
  return PREVIEWABLE_EXTENSIONS.has(getFileExt(filePath));
}
```

Note: this uses the module-private `getBaseName()` (already defined at `lib/file-types.ts:37`) rather than `path.basename`, keeping the module browser-safe.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --experimental-strip-types --test lib/file-types.test.mjs`
Expected: PASS

- [ ] **Step 6: Point the API route at the shared map**

In `app/api/files/[...path]/route.ts`, delete the local `EXT_TO_LANGUAGE` constant and the `getLanguage` function (lines 47-69), then add `getLanguageForPath` to the existing `@/lib/file-types` import block:

```ts
import {
  DOCX_PREVIEW_MAX_BYTES,
  IMAGE_PREVIEW_MAX_BYTES,
  TEXT_PREVIEW_MAX_BYTES,
  documentPreviewKind,
  getAudioMime,
  getDocumentMime,
  getFileExt,
  getImageMime,
  getLanguageForPath,
} from "@/lib/file-types";
```

Then replace the two call sites — `route.ts:472` and `route.ts:493` — changing `getLanguage(filePath)` to `getLanguageForPath(filePath)`.

- [ ] **Step 7: Verify no stale references remain**

```bash
grep -n "getLanguage\b\|EXT_TO_LANGUAGE" "app/api/files/[...path]/route.ts"
```

Expected: only the `getLanguageForPath` import and its two call sites. No local definition.

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: no new errors. If `path` is now unused in `route.ts`, remove the import.

- [ ] **Step 9: Commit**

```bash
git add lib/file-types.ts lib/file-types.test.mjs "app/api/files/[...path]/route.ts"
git commit -m "refactor: share previewable extension whitelist in file-types"
```

---

### Task 2: Path scanner

A pure, dependency-free function that finds absolute file paths in a string. This is where every false-positive decision lives, so it gets thorough tests.

**Files:**
- Create: `lib/file-path-scan.ts`
- Test: `lib/file-path-scan.test.mjs`

**Interfaces:**
- Consumes: `isPreviewableExtension(filePath: string): boolean` from Task 1
- Produces: `scanFilePaths(text: string): FilePathMatch[]` where `FilePathMatch` is `{ start: number; end: number; path: string }`. `start` is inclusive, `end` exclusive, both indices into the input string. `path` is the matched text with trailing punctuation removed and any `:line[:col]` suffix retained.

- [ ] **Step 1: Write the failing test**

Create `lib/file-path-scan.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { scanFilePaths } = await jiti.import("./file-path-scan.ts");

function paths(text) {
  return scanFilePaths(text).map((match) => match.path);
}

test("finds a unix absolute path", () => {
  assert.deepEqual(paths("Generated /Users/me/out/report.html for you"), [
    "/Users/me/out/report.html",
  ]);
});

test("finds windows drive paths in both slash styles", () => {
  assert.deepEqual(paths("see C:/Users/me/a.html"), ["C:/Users/me/a.html"]);
  assert.deepEqual(paths("see C:\\Users\\me\\a.md"), ["C:\\Users\\me\\a.md"]);
});

test("ignores paths without a previewable extension", () => {
  assert.deepEqual(paths("installed to /usr/bin and /opt/local"), []);
  assert.deepEqual(paths("wrote /tmp/data.xyz"), []);
});

test("ignores non-path slash usage", () => {
  assert.deepEqual(paths("and/or, n/a, 24/7"), []);
});

test("strips trailing ascii punctuation", () => {
  assert.deepEqual(paths("see /tmp/a.html."), ["/tmp/a.html"]);
  assert.deepEqual(paths("see (/tmp/a.html)"), ["/tmp/a.html"]);
});

test("strips trailing chinese punctuation", () => {
  assert.deepEqual(paths("已生成：/tmp/a.html。"), ["/tmp/a.html"]);
  assert.deepEqual(paths("文件在 /tmp/a.md，请查看"), ["/tmp/a.md"]);
});

test("keeps line and column suffixes", () => {
  assert.deepEqual(paths("at /tmp/a.ts:42"), ["/tmp/a.ts:42"]);
  assert.deepEqual(paths("at /tmp/a.ts:42:8"), ["/tmp/a.ts:42:8"]);
  assert.deepEqual(paths("at /tmp/a.ts:42."), ["/tmp/a.ts:42"]);
});

test("finds several paths on one line", () => {
  assert.deepEqual(paths("wrote /tmp/a.html and /tmp/b.md"), [
    "/tmp/a.html",
    "/tmp/b.md",
  ]);
});

test("ignores urls and protocol-relative paths", () => {
  assert.deepEqual(paths("see https://example.com/a.html"), []);
  assert.deepEqual(paths("see //example.com/a.html"), []);
});

test("ignores a path glued to a preceding word", () => {
  assert.deepEqual(paths("see/tmp/a.html"), []);
});

test("reports offsets that slice back to the path", () => {
  const text = "已生成：/tmp/a.html。";
  const [match] = scanFilePaths(text);
  assert.equal(text.slice(match.start, match.end), "/tmp/a.html");
});

test("returns an empty array when nothing matches", () => {
  assert.deepEqual(scanFilePaths(""), []);
  assert.deepEqual(scanFilePaths("no paths here"), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/file-path-scan.test.mjs`
Expected: FAIL — cannot resolve `./file-path-scan.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/file-path-scan.ts`:

```ts
import { isPreviewableExtension } from "./file-types";

export interface FilePathMatch {
  start: number;
  end: number;
  path: string;
}

const CANDIDATE_PATTERN = /(?:[A-Za-z]:[\\/]|\/)[^\s"'`<>|*?]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"。，、；：！？）】》」』…]+$/;

function stripLineSuffix(value: string): string {
  return value.replace(/:\d+(?::\d+)?$/, "");
}

export function scanFilePaths(text: string): FilePathMatch[] {
  const matches: FilePathMatch[] = [];
  CANDIDATE_PATTERN.lastIndex = 0;

  let candidate: RegExpExecArray | null;
  while ((candidate = CANDIDATE_PATTERN.exec(text)) !== null) {
    const start = candidate.index;

    // Protocol-relative and UNC-style prefixes are rejected downstream anyway.
    if (candidate[0].startsWith("//")) continue;
    // A path glued to a preceding word is almost always not a path.
    if (start > 0 && /[A-Za-z0-9]/.test(text[start - 1])) continue;

    const trimmed = candidate[0].replace(TRAILING_PUNCTUATION, "");
    if (!trimmed) continue;
    if (!isPreviewableExtension(stripLineSuffix(trimmed))) continue;

    matches.push({ start, end: start + trimmed.length, path: trimmed });
  }

  return matches;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/file-path-scan.test.mjs`
Expected: PASS — 12 tests

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add lib/file-path-scan.ts lib/file-path-scan.test.mjs
git commit -m "feat: add absolute file path scanner"
```

---

### Task 3: Remark plugin

Walks the mdast tree and rewrites `text` nodes containing paths into `text`/`link` sequences. Skips `code`, `inlineCode`, and `link` subtrees so code content is untouched and links never nest.

**Files:**
- Create: `lib/remark-file-paths.ts`
- Test: `lib/remark-file-paths.test.mjs`

**Interfaces:**
- Consumes: `scanFilePaths(text: string): FilePathMatch[]` from Task 2
- Produces: `remarkFilePaths(): (tree: MdastNode) => void` — a remark plugin factory. Called with no arguments; returns a transformer that mutates the tree in place.

Tests build mdast by hand rather than parsing markdown, so no `unified`/`remark` runtime is needed and the transform is tested in isolation. End-to-end coverage through the real parser comes in Task 4.

- [ ] **Step 1: Write the failing test**

Create `lib/remark-file-paths.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { remarkFilePaths } = await jiti.import("./remark-file-paths.ts");

function runTransform(tree) {
  remarkFilePaths()(tree);
  return tree;
}

function paragraph(...children) {
  return { type: "root", children: [{ type: "paragraph", children }] };
}

function text(value) {
  return { type: "text", value };
}

test("splits a text node around a file path", () => {
  const tree = runTransform(paragraph(text("Generated /tmp/a.html now")));

  assert.deepEqual(tree.children[0].children, [
    { type: "text", value: "Generated " },
    {
      type: "link",
      url: "/tmp/a.html",
      children: [{ type: "text", value: "/tmp/a.html" }],
    },
    { type: "text", value: " now" },
  ]);
});

test("does not descend into code blocks", () => {
  const tree = runTransform({
    type: "root",
    children: [{ type: "code", lang: "bash", value: "cat /tmp/a.html" }],
  });

  assert.deepEqual(tree.children, [
    { type: "code", lang: "bash", value: "cat /tmp/a.html" },
  ]);
});

test("does not descend into inline code", () => {
  const tree = runTransform(
    paragraph({ type: "inlineCode", value: "/tmp/a.html" }),
  );

  assert.deepEqual(tree.children[0].children, [
    { type: "inlineCode", value: "/tmp/a.html" },
  ]);
});

test("does not nest a link inside an existing link", () => {
  const tree = runTransform(
    paragraph({
      type: "link",
      url: "/tmp/a.html",
      children: [text("/tmp/a.html")],
    }),
  );

  assert.deepEqual(tree.children[0].children, [
    { type: "link", url: "/tmp/a.html", children: [{ type: "text", value: "/tmp/a.html" }] },
  ]);
});

test("splits several paths in one text node", () => {
  const tree = runTransform(paragraph(text("/tmp/a.html and /tmp/b.md")));
  const types = tree.children[0].children.map((node) => node.type);

  assert.deepEqual(types, ["link", "text", "link"]);
});

test("transforms text nested in emphasis and list items", () => {
  const tree = runTransform({
    type: "root",
    children: [
      {
        type: "list",
        children: [
          {
            type: "listItem",
            children: [
              { type: "paragraph", children: [
                { type: "strong", children: [text("see /tmp/a.html")] },
              ] },
            ],
          },
        ],
      },
    ],
  });

  const strong = tree.children[0].children[0].children[0].children[0];
  assert.deepEqual(strong.children.map((node) => node.type), ["text", "link"]);
});

test("leaves a tree without paths unchanged", () => {
  const tree = runTransform(paragraph(text("nothing to see")));

  assert.deepEqual(tree.children[0].children, [
    { type: "text", value: "nothing to see" },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/remark-file-paths.test.mjs`
Expected: FAIL — cannot resolve `./remark-file-paths.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/remark-file-paths.ts`:

```ts
import { scanFilePaths } from "./file-path-scan";

interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
}

const SKIPPED_TYPES = new Set([
  "code",
  "inlineCode",
  "link",
  "linkReference",
  "definition",
  "image",
  "imageReference",
  "html",
]);

function splitTextNode(value: string): MdastNode[] | null {
  const matches = scanFilePaths(value);
  if (matches.length === 0) return null;

  const parts: MdastNode[] = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.start > cursor) {
      parts.push({ type: "text", value: value.slice(cursor, match.start) });
    }
    parts.push({
      type: "link",
      url: match.path,
      children: [{ type: "text", value: match.path }],
    });
    cursor = match.end;
  }

  if (cursor < value.length) {
    parts.push({ type: "text", value: value.slice(cursor) });
  }

  return parts;
}

function transform(node: MdastNode): void {
  const children = node.children;
  if (!children) return;

  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (SKIPPED_TYPES.has(child.type)) continue;

    if (child.type === "text" && typeof child.value === "string") {
      const parts = splitTextNode(child.value);
      if (parts) {
        children.splice(index, 1, ...parts);
        index += parts.length - 1;
      }
      continue;
    }

    transform(child);
  }
}

export function remarkFilePaths() {
  return (tree: MdastNode): void => {
    transform(tree);
  };
}
```

The local `MdastNode` interface exists because `@types/mdast` is not a dependency. It is structural and covers only the fields this transform reads.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/remark-file-paths.test.mjs`
Expected: PASS — 7 tests

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add lib/remark-file-paths.ts lib/remark-file-paths.test.mjs
git commit -m "feat: add remark plugin linking bare file paths"
```

---

### Task 4: Register the plugin and verify end to end

Wire the plugin into both plugin arrays and confirm a bare path renders as an in-app link through the real markdown pipeline, including `rehype-sanitize`.

**Files:**
- Modify: `lib/markdown.ts:163-164`
- Test: `components/MarkdownBody.test.mjs` (append)

**Interfaces:**
- Consumes: `remarkFilePaths()` from Task 3
- Produces: no new exports. `markdownRemarkPlugins` and `markdownPreviewRemarkPlugins` gain a third entry.

- [ ] **Step 1: Write the failing test**

Append to `components/MarkdownBody.test.mjs`:

```js
test("turns a bare absolute path into an in-app link", () => {
  const html = renderMarkdown("Generated /home/me/project/out/report.html for you");

  assert.match(
    html,
    /<a href="\/home\/me\/project\/out\/report\.html">\/home\/me\/project\/out\/report\.html<\/a>/,
  );
  assert.doesNotMatch(html, /target=|rel=/);
});

test("leaves bare paths inside code untouched", () => {
  const fenced = renderMarkdown("```bash\ncat /tmp/a.html\n```");
  const inline = renderMarkdown("run `/tmp/a.html` now");

  assert.doesNotMatch(fenced, /<a /);
  assert.doesNotMatch(inline, /<a /);
});

test("leaves non-previewable bare paths as plain text", () => {
  const html = renderMarkdown("installed to /usr/bin today");

  assert.doesNotMatch(html, /<a /);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test components/MarkdownBody.test.mjs`
Expected: FAIL — the first test finds no `<a>` element

- [ ] **Step 3: Register the plugin**

In `lib/markdown.ts`, add the import next to the other plugin imports at the top:

```ts
import { remarkFilePaths } from "./remark-file-paths";
```

Then replace lines 163-164:

```ts
export const markdownRemarkPlugins: ReactMarkdownOptions["remarkPlugins"] = [remarkGfm, remarkMath, remarkFilePaths];
export const markdownPreviewRemarkPlugins: ReactMarkdownOptions["remarkPlugins"] = [remarkGfm, remarkMath, remarkFilePaths];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test components/MarkdownBody.test.mjs`
Expected: PASS — all tests, including the four pre-existing ones

- [ ] **Step 5: Verify Windows drive paths survive sanitization**

`rehype-sanitize` restricts `href` protocols. A path like `C:/Users/me/a.html` can look like a `c:` protocol scheme and may be stripped. Check it explicitly:

```bash
node --test components/MarkdownBody.test.mjs 2>&1 | tail -20
```

Then add this test to `components/MarkdownBody.test.mjs` and run again:

```js
test("keeps windows drive paths as links", () => {
  const html = renderMarkdown("Generated C:/Users/me/out/report.html for you");

  assert.match(html, /<a href="C:\/Users\/me\/out\/report\.html">/);
});
```

Expected: PASS.

**If it FAILS** because sanitize dropped the `href`, add `"c"` through `"z"` drive schemes is *not* the fix — instead extend the sanitize schema in `lib/markdown.ts` by adding a `protocols` override that permits relative and drive-style hrefs:

```ts
const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
  },
  strip: [...(defaultSchema.strip || []), "iframe", "object", "style", "form"],
};
```

If that still does not work, mark the Windows case as a known limitation, delete this test, and note it in the commit message. Do not weaken sanitization further — Unix paths are the primary target and must keep working.

- [ ] **Step 6: Run the full test suite**

```bash
node --test components/*.test.mjs
node --test lib/file-path-scan.test.mjs lib/remark-file-paths.test.mjs
node --experimental-strip-types --test lib/*.test.mjs
```

Expected: no failures. The third command covers the older plain-import test files; the flag is needed on Node below 23.6.

- [ ] **Step 7: Lint and build**

```bash
npm run lint
npm run build
```

Expected: both succeed.

- [ ] **Step 8: Verify in the running app**

```bash
npm run dev
```

Open `http://127.0.0.1:30141`, then in a session ask the agent to write an HTML file and confirm:

1. The absolute path in the reply body renders as a link.
2. Clicking it opens the right-hand panel with a preview tab.
3. An HTML file shows the rendered iframe preview, not just source.
4. A path inside a fenced code block is still plain text.

- [ ] **Step 9: Commit**

```bash
git add lib/markdown.ts components/MarkdownBody.test.mjs
git commit -m "feat: link bare file paths in chat replies to the file preview"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Extract whitelist to shared location | Task 1 |
| `lib/file-path-scan.ts` + tests | Task 2 |
| `lib/remark-file-paths.ts` + tests | Task 3 |
| Register in `lib/markdown.ts` | Task 4 |
| `MarkdownBody.test.mjs` end-to-end cases | Task 4 |
| Lint + full suite | Task 4 |
| No new dependency | Global Constraints; Task 3 uses a local `MdastNode` interface |
| Both plugin arrays registered | Task 4 Step 3 |

All spec test cases are present: absolute paths, Windows drives, whitelist filtering, CN/EN trailing punctuation, line suffixes, multiple paths per line, non-path strings, empty input, code-block and inline-code exclusion, link non-nesting, tree-unchanged.

**Type consistency:** `FilePathMatch` (`start`/`end`/`path`) is defined in Task 2 and consumed in Task 3's `splitTextNode`. `isPreviewableExtension` is defined in Task 1 and consumed in Task 2. `remarkFilePaths` is defined in Task 3 and consumed in Task 4. `getLanguageForPath` replaces `getLanguage` consistently in Task 1 Steps 4, 6, and 7.

**Deviation from spec worth noting:** the spec listed `image`/`imageReference`/`html` as implicit; the plugin skips them explicitly so image alt text and raw HTML are never rewritten.
