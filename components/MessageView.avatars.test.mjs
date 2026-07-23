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
const { AvatarConfigProvider } = await jiti.import("./AvatarConfigProvider.tsx");

const USER_AVATAR = "data:image/png;base64,dXNlcg==";
const ASSISTANT_AVATAR = "data:image/jpeg;base64,YXNz";
const TOOL_AVATAR = "data:image/webp;base64,dG9vbA==";

function renderMessage(props, customConfig) {
  const content = React.createElement(MessageView, props);
  if (customConfig) {
    return renderToStaticMarkup(
      React.createElement(
        AvatarConfigProvider,
        { cwd: "/test/project", initialConfig: customConfig },
        content,
      ),
    );
  }
  return renderToStaticMarkup(content);
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

test("custom user avatar appears beside a user message when the provider has a value", () => {
  const html = renderMessage(
    {
      message: {
        role: "user",
        content: "",
        timestamp: Date.UTC(2025, 0, 1, 12, 0, 0),
      },
    },
    { user: USER_AVATAR, assistant: null, tool: null },
  );
  // The custom marker is present.
  assert.match(html, /data-avatar-source="custom"/);
  // The custom image src is rendered.
  assert.match(
    html,
    new RegExp(`<img[^>]+src="${USER_AVATAR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
  );
  // The letter is still rendered as a hidden fallback.
  assert.match(html, />U</);
});

test("custom assistant avatar appears beside an assistant message when the provider has a value", () => {
  const html = renderMessage(
    {
      message: {
        role: "assistant",
        provider: "test",
        model: "test-model",
        content: [{ type: "text", text: "Hello there." }],
        timestamp: Date.UTC(2025, 0, 1, 12, 0, 1),
      },
    },
    { user: null, assistant: ASSISTANT_AVATAR, tool: null },
  );
  assert.match(html, /data-avatar-source="custom"/);
  assert.match(
    html,
    new RegExp(`<img[^>]+src="${ASSISTANT_AVATAR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
  );
});

test("custom tool avatar appears in assistant tool call block headers", () => {
  const html = renderMessage(
    {
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
    },
    { user: null, assistant: null, tool: TOOL_AVATAR },
  );
  assert.match(html, /data-avatar-source="custom"/);
  assert.match(
    html,
    new RegExp(`<img[^>]+src="${TOOL_AVATAR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
  );
});

test("custom avatars for one role do not affect other roles", () => {
  const html = renderMessage(
    {
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
    },
    { user: USER_AVATAR, assistant: ASSISTANT_AVATAR, tool: null },
  );
  // Both user (none in this message) and tool are default. We can detect the
  // tool avatar staying default and the assistant avatar being custom.
  const toolMarkers = html.match(/data-avatar-role="tool"[^>]*data-avatar-source="\w+"/g) ?? [];
  for (const marker of toolMarkers) {
    assert.match(marker, /data-avatar-source="default"/);
  }
});