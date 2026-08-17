import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chat = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("keeps recognized todos in the transcript after the agent settles", () => {
  assert.match(chat, /const conversationPlanWidget = getConversationPlanWidget\(visibleWidgets\)/);
  assert.match(chat, /const activeConversationPlanWidget = conversationPlanWidget \?\? planCacheRef.current.widget/);
  assert.doesNotMatch(chat, /activeConversationPlanWidget = agentRunning \? conversationPlanWidget/);
  assert.match(chat, /filterSubagentWidgets\(planFooterWidgets\)/);
  assert.match(chat, /visibleWidgets\.filter/);
  assert.match(chat, /subagentTreeVisible/);
  assert.match(chat, /DesktopSubagentWidgetCard/);
  assert.match(chat, /isPiSubagentWidgetKey/);
  assert.match(chat, /<ConversationPlan[\s\S]*?widget=\{activeConversationPlanWidget\}/);
  assert.match(chat, /activeConversationPlanWidget \? \(/);
  assert.match(chat, /<ExtensionStatusBar[^>]*widgets=\{footerWidgets\}/);
});

test("keeps the plan inside the transcript and visually unframed", () => {
  const planIndex = chat.indexOf("<ConversationPlan");
  const messageEndIndex = chat.indexOf('<div ref={messagesEndRef}');
  const composerIndex = chat.indexOf("subagentMode !== undefined ? subagentMode.composer : chatInputElement", planIndex);

  assert.ok(planIndex > 0 && planIndex < messageEndIndex);
  assert.ok(messageEndIndex < composerIndex);
  assert.match(css, /\.conversation-plan-summary\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
  assert.doesNotMatch(css, /\.codex-todo-panel/);
});

test("animates active todo state without looking frozen in reduced motion", () => {
  assert.match(css, /\.conversation-plan-spinner\s*\{[^}]*transform-box:\s*fill-box;[^}]*transform-origin:\s*center;[^}]*animation:\s*spin 1\.1s linear infinite;/s);
  assert.match(css, /\.conversation-plan-active-static\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.conversation-plan-spinner\s*\{[^}]*display:\s*none;[^}]*animation:\s*none;/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.conversation-plan-active-static\s*\{[^}]*display:\s*block;/s);
  assert.doesNotMatch(css, /@keyframes conversation-plan-active-pulse/);
});

test("transitions plan expansion and keeps coarse-pointer summary targets usable", () => {
  assert.match(css, /\.conversation-plan-items\s*\{[^}]*grid-template-rows:\s*0fr;[^}]*transition:/s);
  assert.match(css, /\.conversation-plan-items\[data-expanded="true"\]\s*\{[^}]*grid-template-rows:\s*1fr;/s);
  assert.match(css, /\.conversation-plan-items-inner\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.conversation-plan-items-content\s*\{[^}]*padding:\s*3px 0 2px 24px;/s);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?\.conversation-plan-summary\s*\{[^}]*min-height:\s*44px;/s);
});
