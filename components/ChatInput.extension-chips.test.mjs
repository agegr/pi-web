import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("ChatInput accepts extension chips and wires them to an activate callback", () => {
  assert.match(chatInput, /extensionChips\?: \{ command: string; text: string \}\[\]/);
  assert.match(chatInput, /onExtensionChipActivate\?: \(command: string\) => void/);
  assert.match(chatInput, /onExtensionChipActivate\?\.\(chip\.command\)/);
});

test("extension chips render left of the reasoning-level control in the composer footer", () => {
  // chip group is rendered inside the right-hand controls container, before the
  // mobile "more controls" button and the thinking-level dropdown
  const controlsIndex = chatInput.indexOf("{/* RIGHT: extension chips");
  const chipsIndex = chatInput.indexOf("extensionChips!.map");
  const mobileButtonIndex = chatInput.indexOf('title={controlsMenuOpen ? undefined : t("chat.moreControls")}');
  const thinkingIndex = chatInput.indexOf("onThinkingLevelChange && (", chipsIndex);
  assert.ok(controlsIndex !== -1 && chipsIndex !== -1 && mobileButtonIndex !== -1 && thinkingIndex !== -1);
  assert.ok(chipsIndex > controlsIndex && chipsIndex < mobileButtonIndex && chipsIndex < thinkingIndex);
});

test("chips are disabled while streaming and stay touch-friendly on mobile", () => {
  assert.match(chatInput, /disabled=\{isStreaming\}[\s\S]*?title=\{\`\$\{chip\.text\} · \$\{chip\.command\}\`\}/);
  assert.match(chatInput, /padding: isMobile \? "0 8px" : "8px 12px"/);
});

test("ChatWindow derives chips from chip: statuses and hides them from the status shelf", () => {
  assert.match(chatWindow, /item\.key\.startsWith\("chip:"\)/);
  assert.match(chatWindow, /command: item\.key\.slice\(5\)/);
  assert.match(chatWindow, /extensionChips=\{extensionChips\}/);
  assert.match(chatWindow, /onExtensionChipActivate=\{handleSend\}/);
  assert.match(chatWindow, /<ExtensionStatusBar statuses=\{shelfStatuses\}/);
});
