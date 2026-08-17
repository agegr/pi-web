import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("terminal opens as a closable right-panel tab bound to the selected session", () => {
  assert.match(source, /fetch\(`\/api\/sessions\/\$\{encodeURIComponent\(selectedSession\.id\)\}\/terminal`/);
  assert.match(source, /kind: "terminal"/);
  assert.match(source, /const \{ terminalId, cwd \} = data/);
  assert.match(source, /<TabBar[\s\S]*?onCloseTab=\{handleCloseFileTab\}/);
});

test("closing a terminal tab terminates its server PTY", () => {
  assert.match(source, /closingTab\?\.kind === "terminal"/);
  assert.match(source, /method: "DELETE", keepalive: true/);
});

test("terminal tabs stay mounted while file viewers remain active-only", () => {
  assert.match(source, /terminalTabs\.map\(\(tab\) =>/);
  assert.match(source, /active=\{rightPanelOpen && activeFileTabId === tab\.id\}/);
  assert.equal(source.match(/<TerminalPanel/g)?.length, 1);
});

test("an exited terminal is retired so the next toggle opens a fresh one", () => {
  assert.match(source, /onExit=\{\(\) => handleTerminalExit\(tab\.id\)\}/);
  assert.match(source, /tab\.id === tabId \? \{ \.\.\.tab, terminalExited: true \} : tab/);
  assert.match(source, /if \(existing && !existing\.terminalExited\) \{/);
  // The dead tab is dropped as the replacement is added, rather than left for
  // the user to close by hand.
  assert.match(source, /prev\.filter\(\(tab\) => tab\.id !== existing\?\.id\)/);
});

test("a policy refusal disables the button instead of repeating a popup", () => {
  assert.doesNotMatch(source, /window\.alert/);
  assert.match(source, /if \(data\.blocked\) setTerminalBlockedReason\(message\);/);
  assert.match(source, /Boolean\(terminalOpeningSessionId\) \|\| Boolean\(terminalBlockedReason\)/);
  assert.match(source, /setTerminalNotice\(\s*`\$\{translate\("terminal\.unavailable"\)\}/);
});
