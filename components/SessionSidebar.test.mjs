import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionActionsSource = source.slice(source.indexOf("function useSessionActions"), source.indexOf("function GlobalHistoryItem"));
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionActionsSource,
    /const handleDeleteClick[\s\S]*?if \(event\.shiftKey\) void performDelete\(\);\s*else setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("exposes the polled running-session set to the shell", () => {
  assert.match(source, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
test("defaults to workspace and exposes a non-URL scope tablist", () => {
  assert.match(source, /useState<"workspace" \\| "global">\("workspace"\)/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /data-navigation-scope="global"/);
  assert.match(source, /globalPlaceholder/);
});

test("global scope renders an independently scrollable running section", () => {
  assert.match(source, /function GlobalRunningSessions\(/);
  assert.match(source, /data-global-running-section="true"/);
  assert.match(source, /data-global-running-list="true"/);
  assert.match(source, /maxHeight: "min\(38vh, 360px\)"/);
  assert.match(source, /sessions=\{runningSessions\}/);
  assert.match(source, /onSelect=\{handleSelectRunningSession\}/);
});

test("global history is a separate recent, scrollable section", () => {
  assert.match(source, /function GlobalHistorySessions\(/);
  assert.match(source, /buildGlobalHistorySessions\(allSessions, runningSessionIds\)/);
  assert.match(source, /data-global-history-section="true"/);
  assert.match(source, /data-global-history-list="true"/);
  assert.match(source, /data-history-session-id=\{session\.id\}/);
  assert.match(source, /session\.projectRoot/);
  assert.match(source, /session\.modified/);
  assert.match(source, /sidebar\.messagesCount/);
  assert.match(source, /onRenamed=\{\(\) => void loadSessions\(false\)\}/);
  assert.match(source, /onDeleted=\{\(id\) =>/);
});

test("running snapshots retain the last known rows when polling fails", () => {
  assert.match(source, /setRunningSessions\(snapshot\)/);
  assert.match(source, /Keep the last known snapshot/);
  assert.match(source, /setRunningError\(/);
  assert.match(source, /runningRetryKey/);
});

test("keeps new-session creation lazy and scoped to workspace", async () => {
  assert.doesNotMatch(source, /crypto\.randomUUID\(\)/);
  const workspaceSource = source.slice(
    source.indexOf('{navigationScope === "workspace" ?'),
    source.indexOf('{navigationScope === "global" &&'),
  );
  assert.match(workspaceSource, /onClick=\{handleNewSession\}/);
  const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(chatWindowSource, /draftKey=\{session\?\.id \?\? \(newSessionCwd \? `new:\$\{newSessionCwd\}` : undefined\)\}/);
});
