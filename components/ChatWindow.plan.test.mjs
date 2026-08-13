import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chat = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("renders recognized todos in the conversation tail instead of the footer shelf", () => {
  assert.match(chat, /const conversationPlanWidget = getConversationPlanWidget\(visibleWidgets\)/);
  assert.match(chat, /const footerWidgets = conversationPlanWidget[\s\S]*?visibleWidgets\.filter/);
  assert.match(chat, /<ConversationPlan[\s\S]*?widget=\{conversationPlanWidget\}/);
  assert.match(chat, /<ExtensionStatusBar[^>]*widgets=\{footerWidgets\}/);
});

test("keeps the plan inside the transcript and visually unframed", () => {
  const planIndex = chat.indexOf("<ConversationPlan");
  const messageEndIndex = chat.indexOf('<div ref={messagesEndRef}');
  const composerIndex = chat.indexOf("{chatInputElement}", planIndex);

  assert.ok(planIndex > 0 && planIndex < messageEndIndex);
  assert.ok(messageEndIndex < composerIndex);
  assert.match(css, /\.conversation-plan-summary\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
  assert.doesNotMatch(css, /\.codex-todo-panel/);
});
