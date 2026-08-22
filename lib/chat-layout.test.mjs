import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the chat content width is full width and shared, not a fixed column", async () => {
  const layout = await readFile(new URL("./chat-layout.ts", import.meta.url), "utf8");
  assert.match(layout, /CHAT_CONTENT_MAX_WIDTH: string = "100%"/);
});

test("message list, welcome card and composer all use the shared width", async () => {
  const chatWindow = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  const chatInput = await readFile(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");

  // No place may pin the old fixed 820px column any more; the three surfaces
  // must resize with the panel together.
  assert.doesNotMatch(chatWindow, /maxWidth: 820/);
  assert.doesNotMatch(chatWindow, /max-w-\[820px\]/);
  assert.doesNotMatch(chatInput, /maxWidth: 820/);

  const messageList = chatWindow.match(/ref=\{messageContentRef\}[^>]*maxWidth: CHAT_CONTENT_MAX_WIDTH/);
  assert.ok(messageList, "message list must use CHAT_CONTENT_MAX_WIDTH");
  assert.match(chatWindow, /import \{ CHAT_CONTENT_MAX_WIDTH \} from "@\/lib\/chat-layout"/);
  assert.match(chatInput, /maxWidth: CHAT_CONTENT_MAX_WIDTH, margin: "0 auto"/);
  assert.match(chatInput, /import \{ CHAT_CONTENT_MAX_WIDTH \} from "@\/lib\/chat-layout"/);
});
