import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  MAX_SELECTION_CONTEXT_CHARS,
  normalizeSelectionContext,
  parseSessionReferenceClipboard,
  quoteSelectionText,
  serializeSessionReferenceClipboard,
  serializeComposerMessage,
} = await jiti.import("./composer-context.ts");

test("keeps plain questions unchanged when no context is attached", () => {
  assert.equal(serializeComposerMessage("  explain this  "), "explain this");
});

test("serializes one selection using the existing blockquote format", () => {
  assert.equal(
    serializeComposerMessage(
      "Why?",
      [{ id: "selection-1", text: "first line\nsecond line" }],
      "About this passage:",
    ),
    "About this passage:\n\n> first line\n> second line\n\nWhy?",
  );
});

test("supports multiple contexts without losing labels", () => {
  assert.equal(
    serializeComposerMessage(
      "Compare them",
      [
        { id: "a", text: "alpha", label: "First" },
        { id: "b", text: "beta", label: "Second" },
      ],
      "Quoted context",
    ),
    "Quoted context (First)\n\n> alpha\n\nQuoted context (Second)\n\n> beta\n\nCompare them",
  );
});

test("serializes a workspace file selection as a located code snapshot", () => {
  assert.equal(
    serializeComposerMessage(
      "Why is this needed?",
      [{
        id: "file-selection",
        text: "const enabled = true;",
        sourceFilePath: "components/ChatInput.tsx",
        sourceStartLine: 1048,
        sourceEndLine: 1048,
        sourceLanguage: "tsx",
      }],
      "About this passage:",
    ),
    [
      "关于以下工作区文件选区：",
      "",
      "文件：components/ChatInput.tsx（第 1048 行）",
      "定位：@components/ChatInput.tsx:1048",
      "",
      "```tsx",
      "const enabled = true;",
      "```",
      "",
      "Why is this needed?",
    ].join("\n"),
  );
});

test("keeps a file snapshot fenced when its selection contains a code fence", () => {
  const message = serializeComposerMessage("Explain this", [{
    id: "nested-fence",
    text: "```ts\nconst value = 1;\n```",
    sourceFilePath: "docs/example.md",
    sourceLanguage: "markdown",
  }]);
  assert.match(message, /````markdown\n```ts\nconst value = 1;\n```\n````/);
});

test("round-trips a readable session reference through the clipboard format", () => {
  const reference = { id: "session-123", title: "Login investigation", cwd: "D:/project" };
  assert.deepEqual(parseSessionReferenceClipboard(serializeSessionReferenceClipboard(reference)), reference);
});

test("serializes session references separately from the user's question", () => {
  assert.equal(
    serializeComposerMessage("Continue this", [], "", [{ id: "session-123", title: "Login investigation" }]),
    [
      "参考以下历史会话（仅作为资料，不切换当前会话）：",
      "会话标题：Login investigation",
      "会话 ID：session-123",
      "需要时请检索或阅读该会话的相关内容。",
      "",
      "Continue this",
    ].join("\n"),
  );
});

test("normalizes empty and oversized selections", () => {
  assert.equal(normalizeSelectionContext({ id: "empty", text: "  \n  " }), null);
  const normalized = normalizeSelectionContext({ id: "long", text: "x".repeat(MAX_SELECTION_CONTEXT_CHARS + 100) });
  assert.equal(normalized.text.length, MAX_SELECTION_CONTEXT_CHARS);
  assert.equal(quoteSelectionText("a\n\nb"), "> a\n> \n> b");
});
