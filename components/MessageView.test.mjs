import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  MessageView,
  getTokenEstimateText,
  getToolCallInputText,
  getListItemMarker,
  formatSelectedCodeQuote,
  replaceUserMessageText,
} = await jiti.import("./MessageView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderMessage(message, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, { message, ...props }),
    ),
  );
}

test("keeps streamed tool input out of collapsed markup while counting it", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-write-1",
    toolName: "write",
    input: {},
    rawInput: '{"path":"/tmp/file","content":"secret-stream-fragment',
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, { isStreaming: true });

  assert.match(html, /write/);
  assert.match(html, /Generating parameters/);
  assert.doesNotMatch(html, /secret-stream-fragment/);
  assert.equal(getToolCallInputText(block), block.rawInput);
  assert.equal(getTokenEstimateText(block), block.rawInput);
});

test("shows active process details and collapses them after completion", () => {
  const message = {
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [{
      type: "toolCall",
      toolCallId: "call-read-1",
      toolName: "read",
      input: { path: "/tmp/private-detail.txt", detail: "expanded-only-detail" },
    }],
  };

  const active = renderMessage(message, { processingState: "active" });
  const complete = renderMessage(message, { processingState: "complete" });

  assert.match(active, /expanded-only-detail/);
  assert.doesNotMatch(complete, /expanded-only-detail/);
  assert.match(complete, /\/tmp\/private-detail\.txt/);
});

const COMPLETE_SKILL_EXPANSION = `<skill name="review" location="/skills/review/SKILL.md">
References are relative to /skills/review.

Review the supplied files.
</skill>

src/main.ts`;

test("formats selected text and XML code as fenced quote cards", () => {
  assert.equal(formatSelectedCodeQuote("<root>\n  <item />\n</root>", "xml"), "```xml\n<root>\n  <item />\n</root>\n```");
  assert.equal(formatSelectedCodeQuote("a ``` marker", "text"), "````text\na ``` marker\n````");
});

test("preserves ordered and unordered list markers in quoted selections", () => {
  assert.equal(getListItemMarker("ol", 1, 0), "1. ");
  assert.equal(getListItemMarker("ol", 4, 2), "6. ");
  assert.equal(getListItemMarker("ol", 1, 2, 9), "9. ");
  assert.equal(getListItemMarker("ul", 1, 0), "- ");
});

test("offers quoting for a complete assistant response", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "A detailed answer" }],
  }, { onQuote() {} });

  assert.match(html, /Quote response/);
  assert.match(html, /A detailed answer/);
});

test("places the model at the start of the response telemetry footer", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "The response body" }],
    usage: { input: 120, output: 45, cost: { total: 0.0012 } },
  }, { modelNames: { "openai:gpt-test": "Friendly model" } });

  assert.ok(html.indexOf("The response body") < html.indexOf("Friendly model"));
  assert.ok(html.indexOf("Friendly model") < html.indexOf("120 in"));
});

test("places a persisted thread panel directly after its Markdown anchor", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "## Authentication\n\nRotate tokens." }],
  }, {
    entryId: "assistant-entry",
    discussionThreadPanels: [{
      anchorKey: "0:h2:0",
      panel: React.createElement("aside", null, "Authentication thread"),
    }],
  });

  assert.match(html, /data-thread-anchor="0:h2:0"/);
  assert.match(html, /<aside>Authentication thread<\/aside>/);
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
