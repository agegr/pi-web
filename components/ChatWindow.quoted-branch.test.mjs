import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("offers compact quoting controls and sends branch questions through the main chat", async () => {
  const chatSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

  assert.match(chatSource, /onPointerUp=\{captureQuotedSelection\}/);
  assert.match(chatSource, /closest<HTMLElement>\("\[data-message-role=/);
  assert.match(chatSource, /chatInputRef\?\.current\?\.insertText\(buildQuotedSelection/);
  assert.match(chatSource, /onAskInNewChat\([\s\S]*?sourceSessionId,[\s\S]*?quotedSelection\.sourceEntryId/);
  assert.match(shellSource, /type: "fork_branch"/);
  assert.match(shellSource, /initialPrompt=\{pendingQuotePrompt\?\.sessionId === selectedSession\?\.id/);
  assert.equal((shellSource.match(/<ChatWindow\b/g) ?? []).length, 1);
  assert.match(chatSource, /onInitialPromptConsumed\?\.\(\);\s*void handleSend\(initialPrompt\)/);
  assert.match(chatSource, /role=\{quoteInputOpen \? "dialog" : "toolbar"\}/);
});
