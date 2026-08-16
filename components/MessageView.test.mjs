import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MessageView, formatToolInput, replaceUserMessageText } = await jiti.import("./MessageView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("./MessageView.tsx", import.meta.url), "utf8"));

function renderMessage(message, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, { message, ...props }),
    ),
  );
}

const COMPLETE_SKILL_EXPANSION = `<skill name="review" location="/skills/review/SKILL.md">
References are relative to /skills/review.

Review the supplied files.
</skill>

src/main.ts`;

test("renders user prompts as right-aligned compact bubbles without role labels", () => {
  const html = renderMessage({ role: "user", content: "build a game to play", timestamp: Date.now() });
  assert.match(html, /class="chat-user-row"/);
  assert.match(html, /class="chat-user-bubble"/);
  assert.doesNotMatch(html, />USER</);
});

test("does not print an ASSISTANT role label", () => {
  const html = renderMessage({ role: "assistant", content: [{ type: "text", text: "Done" }] });
  assert.doesNotMatch(html, />ASSISTANT</);
});

test("token speed pill stays on one line while the model row can wrap", () => {
  // The t/s pill must never break internally (149.3 / t/s); the model row
  // wraps the whole ↓tokens + pill cluster instead on narrow screens.
  assert.match(source, /whiteSpace: "nowrap"/);
  assert.match(source, /flexWrap: "wrap"/);
});

test("renders a provider error when the assistant message has no content", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [],
    stopReason: "error",
    errorMessage: "OpenAI API error (403): <html>request forbidden</html>",
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /Error: OpenAI API error \(403\)/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
});

test("renders partial assistant content before the provider error", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Partial response" }],
    stopReason: "error",
    errorMessage: "Connection closed",
  });

  assert.match(html, /Partial response/);
  assert.match(html, /Error: Connection closed/);
});

test("renders a stopped status for an empty aborted turn", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [],
    stopReason: "aborted",
  });

  assert.match(html, /role="status"/);
  assert.match(html, /Stopped/);
  assert.doesNotMatch(html, /Error:/);
});

test("keeps partial aborted content and a stopped status", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Halfway there" }],
    stopReason: "aborted",
  });

  assert.match(html, /Halfway there/);
  assert.match(html, /Stopped/);
});

test("formats tool string inputs without JSON escape characters", () => {
  const formatted = formatToolInput({
    command: 'printf "hello"\nnext line',
    options: { force: true, label: 'say "yes"' },
    paths: ["a", "b"],
  });

  assert.equal(formatted, `command: printf "hello"
next line
options:
  force: true
  label: say "yes"
paths:
  - a
  - b`);
  assert.doesNotMatch(formatted, /\\n|\\"/);
});

test("renders thinking content through the shared Markdown renderer", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("./MessageView.tsx", import.meta.url), "utf8"));

  assert.match(source, /<SafeMarkdownBody className="markdown-thinking"/);
  assert.match(source, /isStreaming=\{isStreaming\} cwd=\{cwd\} onOpenFile=\{onOpenFile\}/);
  assert.doesNotMatch(source, /whiteSpace: "pre-wrap",\s*background: "var\(--bg-panel\)"/);
});

function assistantWithThinkingAndTool() {
  return {
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [
      { type: "thinking", thinking: "## Plan\n\n- inspect\n- fix" },
      {
        type: "toolCall",
        toolCallId: "tool-1",
        toolName: "bash",
        input: { command: 'printf "hello"\nnext line' },
      },
    ],
    stopReason: "toolUse",
  };
}

test("collapses historical thinking and tool inputs by default", () => {
  const html = renderMessage(assistantWithThinkingAndTool());

  assert.doesNotMatch(html, /<h2>Plan<\/h2>/);
  assert.doesNotMatch(html, /<li>inspect<\/li>/);
  assert.doesNotMatch(html, /command: printf/);
});

test("expands thinking and tool inputs for a live message", () => {
  const html = renderMessage(assistantWithThinkingAndTool(), { defaultDetailsExpanded: true });

  assert.match(html, /<h2>Plan<\/h2>/);
  assert.match(html, /<li>inspect<\/li>/);
  assert.match(html, /command: printf &quot;hello&quot;\nnext line/);
});

test("keeps streaming thinking and tool inputs collapsed by default", () => {
  const html = renderMessage(assistantWithThinkingAndTool(), { isStreaming: true });

  assert.doesNotMatch(html, /<h2>Plan<\/h2>/);
  assert.doesNotMatch(html, /<li>inspect<\/li>/);
  assert.doesNotMatch(html, /command: printf/);
});

test("renders a complete SDK skill expansion as a compact command", () => {
  const html = renderMessage({
    role: "user",
    content: COMPLETE_SKILL_EXPANSION,
  });

  assert.match(html, /\/skill:review/);
  assert.match(html, /src\/main\.ts/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Review the supplied files/);
});

test("does not collapse incomplete skill-looking user text", () => {
  const html = renderMessage({
    role: "user",
    content: '<skill name="review" location="/skills/review/SKILL.md">\nordinary user text',
  });

  assert.match(html, /ordinary user text/);
  assert.doesNotMatch(html, /aria-expanded/);
});

test("keeps attached images when restoring a compact command for editing", () => {
  const image = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "QUJDRA==" },
  };
  const restored = replaceUserMessageText({
    role: "user",
    content: [{ type: "text", text: COMPLETE_SKILL_EXPANSION }, image],
  }, "/skill:review src/main.ts");

  assert.deepEqual(restored.content, [
    { type: "text", text: "/skill:review src/main.ts" },
    image,
  ]);
});

test("renders user-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "user",
    content: [
      { type: "text", text: "inspect this" },
      { type: "image", data: "YWJj", mimeType: "image/png" },
    ],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});

test("keeps a streaming write collapsed until the user expands it", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "qwen",
    content: [{
      type: "toolCall",
      toolCallId: "call-1",
      toolName: "write",
      input: { path: "/tmp/a.md", content: "# Hello" },
    }],
  }, { isStreaming: true });

  assert.match(html, />write</);
  assert.match(html, /\/tmp\/a\.md/);
  assert.doesNotMatch(html, /# Hello/);
});

test("renders custom-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "custom",
    customType: "extension",
    content: [{ type: "image", data: "YWJj", mimeType: "image/png" }],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});

test("keeps the assistant usage line on a single row with ellipsis", () => {
  const html = renderMessage({
    role: "assistant",
    content: [{ type: "text", text: "Done" }],
    usage: { input: 3196, output: 314, cacheRead: 220288, cacheWrite: 0, cost: { total: 0 } },
    timestamp: Date.now(),
  });

  assert.match(html, /font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0/);
});
