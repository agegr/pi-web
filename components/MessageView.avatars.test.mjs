import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MessageView } = await jiti.import("./MessageView.tsx");

function renderMessage(props) {
  return renderToStaticMarkup(React.createElement(MessageView, props));
}

test("user messages render a blue U avatar beside the bubble", () => {
  const html = renderMessage({
    message: {
      role: "user",
      content: "",
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 0),
    },
  });
  assert.match(html, /data-avatar-role="user"/);
  assert.match(html, />U</);
  assert.match(html, /background:#3b82f6/);
});

test("assistant messages render a purple A avatar beside the content", () => {
  const html = renderMessage({
    message: {
      role: "assistant",
      provider: "test",
      model: "test-model",
      content: [{ type: "text", text: "Hello there." }],
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 1),
    },
  });
  assert.match(html, /data-avatar-role="assistant"/);
  assert.match(html, />A</);
  assert.match(html, /background:#a855f7/);
});

test("assistant tool call blocks render a small gray T avatar in the header", () => {
  const html = renderMessage({
    message: {
      role: "assistant",
      provider: "test",
      model: "test-model",
      content: [
        {
          type: "toolCall",
          toolCallId: "call-1",
          toolName: "bash",
          input: { command: "ls -la" },
        },
      ],
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 2),
    },
  });
  assert.match(html, /data-avatar-role="tool"/);
  assert.match(html, />T</);
  assert.match(html, /background:#9ca3af/);
  // The tool avatar must use the smaller default size, not the message size.
  assert.match(html, /data-avatar-role="tool"[^>]*style="[^"]*width:16/);
});

test("toolResult messages do not render standalone avatar rows", () => {
  const html = renderMessage({
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      content: [{ type: "text", text: "ok" }],
    },
  });
  // Paired toolResults return null; no avatar markup should leak through.
  assert.doesNotMatch(html, /data-avatar-role/);
});

test("bashExecution messages reuse ToolCallBlock and pick up the tool avatar", () => {
  const html = renderMessage({
    message: {
      role: "bashExecution",
      command: "echo hi",
      output: "hi\n",
      exitCode: 0,
      timestamp: Date.UTC(2025, 0, 1, 12, 0, 3),
    },
    sessionId: "session-1",
  });
  assert.match(html, /data-avatar-role="tool"/);
  assert.match(html, />T</);
});