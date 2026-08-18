import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/sessions/search/route.ts", import.meta.url), "utf8");

test("current-session search is wired to matching, navigation, and Ctrl/Cmd+F", () => {
  assert.match(chatWindow, /createSessionSearchDocuments\(messages, entryIds\)/);
  assert.match(chatWindow, /searchSessionDocuments\(sessionSearchDocuments, sessionSearchQuery\)/);
  assert.match(chatWindow, /event\.key\.toLowerCase\(\) !== "f"/);
  assert.match(chatWindow, /moveSessionSearch\(event\.shiftKey \? -1 : 1\)/);
  assert.match(chatWindow, /data-session-search-active/);
  assert.match(appShell, /sessionSearchOpen=\{sessionSearchOpen\}/);
});

test("all-session search is wired through the sidebar and guarded route", () => {
  assert.match(sidebar, /\/api\/sessions\/search\?/);
  assert.match(sidebar, /onSelectSessionMatch\(session, hit\.entryId, sessionSearchQuery\.trim\(\)\)/);
  assert.match(appShell, /onSelectSessionMatch=\{handleSelectSessionMatch\}/);
  assert.match(route, /isApiRequestAllowed\(req\)/);
  assert.match(route, /searchAllSessions\(query, limit\)/);
});
