import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { DiscussionThreadPanel } = await jiti.import("./DiscussionThreadPanel.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const source = {
  role: "assistant",
  provider: "test",
  model: "test",
  content: [{ type: "text", text: "Source answer" }],
};
const question = { role: "user", content: "> Selected point\n\nWhy?" };
const process = { role: "assistant", provider: "test", model: "test", content: [{ type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: "README.md" } }] };
const answer = { role: "assistant", provider: "test", model: "test", content: [{ type: "text", text: "Because tokens expire." }] };

const thread = {
  id: "thread-entry",
  sourceEntryId: "source-entry",
  hostLeafId: "main-leaf",
  selectedMarkdown: "Selected point",
  title: "Selected point",
  latestLeafId: "question-entry",
  metadata: {
    version: 1,
    sourceEntryId: "source-entry",
    hostLeafId: "main-leaf",
    selectedMarkdown: "Selected point",
    title: "Selected point",
    status: "open",
  },
  node: {
    entry: { type: "custom", id: "thread-entry", parentId: "source-entry", timestamp: "2026-01-01T00:00:00.000Z", customType: "pi-web.thread" },
    children: [],
  },
};

test("renders active thread messages after the source and exposes the single-composer return action", () => {
  const html = renderToStaticMarkup(React.createElement(
    I18nProvider,
    null,
    React.createElement(DiscussionThreadPanel, {
      sessionId: "session",
      thread,
      active: true,
      activeContext: {
        messages: [source, question, process, answer],
        entryIds: ["source-entry", "question-entry", "process-entry", "answer-entry"],
      },
      onContinue() {},
      onReturnToMain() {},
    }),
  ));

  assert.match(html, /Selected point/);
  assert.match(html, /Why\?/);
  assert.match(html, /Process details/);
  assert.match(html, /Because tokens expire/);
  assert.match(html, /Return to main/);
  assert.doesNotMatch(html, /Source answer/);
});
