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
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderMessage(message) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, { message }),
    ),
  );
}

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

test("collapses expanded skill blocks in user messages", () => {
  const html = renderMessage({
    role: "user",
    content: '<skill name="git" location="/home/me/.pi/skills/git/SKILL.md">\nReferences are relative to /home/me/.pi/skills/git.\n\nRun the standard git workflow.\n</skill>',
  });

  // Header is visible with the skill name and location
  assert.match(html, /skill: git/);
  assert.match(html, /\/home\/me\/\.pi\/skills\/git\/SKILL\.md/);
  // The verbose body is collapsed by default
  assert.doesNotMatch(html, /Run the standard git workflow/);
});

test("keeps user messages without skill blocks intact", () => {
  const html = renderMessage({
    role: "user",
    content: "Please run the git workflow",
  });

  assert.match(html, /Please run the git workflow/);
});

test("keeps text around collapsed skill blocks", () => {
  const html = renderMessage({
    role: "user",
    content: 'intro\n\n<skill name="git" location="/x/SKILL.md">\nSecret body text.\n</skill>\n\noutro',
  });

  assert.match(html, /intro/);
  assert.match(html, /outro/);
  assert.doesNotMatch(html, /Secret body text/);
});
