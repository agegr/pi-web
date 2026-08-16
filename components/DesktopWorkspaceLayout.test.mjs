import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("desktop workspace exposes a transcript and a bounded context gutter", () => {
  assert.match(shell, /className="app-center-column"/);
  assert.match(shell, /<DesktopConversationContext/);
  assert.match(chat, /className="desktop-workspace-context"/);
  assert.match(chat, /DESKTOP_TRANSCRIPT_WIDTH = 760/);
  assert.match(css, /@media \(min-width: 1280px\)[\s\S]*?@container chat-center \(min-width: 760px\)[\s\S]*?\.desktop-workspace-context/);
});

test("context gutter is a sibling of the chat column, not stacked under the composer", () => {
  const main = chat.indexOf('className="chat-workspace-main"');
  const aside = chat.indexOf("className=\"desktop-workspace-context\"");
  assert.ok(main >= 0 && aside > main);
  assert.match(chat, /desktopAside \|\| subagentWidgets\.length > 0/);
});

test("context card is absent until the center column has enough real width", () => {
  assert.match(css, /\.app-center-column \{[\s\S]*?container-name: chat-center/);
  assert.match(css, /\.desktop-workspace-context \{[\s\S]*?display: none/);
  assert.match(css, /@media \(min-width: 1280px\)[\s\S]*?@container chat-center \(min-width: 760px\)[\s\S]*?display: flex/);
});
