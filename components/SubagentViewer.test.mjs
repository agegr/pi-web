import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildToolResultsMap, EMPTY_TRANSCRIPT, mergeTailPage, prependOlderPage } from "./subagent-viewer-state.ts";

const viewer = await readFile(new URL("./SubagentViewer.tsx", import.meta.url), "utf8");
const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const messageView = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");

const message = (id) => ({ role: "user", content: id });
const page = (ids, { hasMore = false, oldest = ids[0] ?? null } = {}) => ({
  messages: ids.map(message),
  entryIds: ids,
  oldestEntryId: oldest,
  hasMore,
});

test("buildToolResultsMap pairs tool results by tool call id", () => {
  const result = { role: "toolResult", toolCallId: "call-1", content: [] };
  assert.equal(buildToolResultsMap([message("a"), result]).get("call-1"), result);
});

test("a poll keeps the older pages loaded above the newest page", () => {
  // The user paged up to a1; the run then appended e5 and e6.
  const shown = page(["a1", "a2", "e1", "e2", "e3", "e4"], { hasMore: true, oldest: "a0" });
  const merged = mergeTailPage(shown, page(["e3", "e4", "e5", "e6"], { hasMore: true }));
  assert.deepEqual(merged.entryIds, ["a1", "a2", "e1", "e2", "e3", "e4", "e5", "e6"]);
  assert.equal(merged.oldestEntryId, "a0");
  assert.equal(merged.hasMore, true);
  // Messages already shown keep their objects, so MessageView's memo holds.
  assert.equal(merged.messages[4], shown.messages[4]);
  assert.equal(merged.messages.length, merged.entryIds.length);
});

test("a poll that no longer overlaps, or covers the whole branch, replaces the transcript", () => {
  const shown = page(["a1", "a2"], { hasMore: true });
  assert.deepEqual(mergeTailPage(shown, page(["z1", "z2"], { hasMore: true })).entryIds, ["z1", "z2"]);
  assert.deepEqual(mergeTailPage(shown, page(["a2", "a3"])).entryIds, ["a2", "a3"]);
  assert.deepEqual(mergeTailPage(EMPTY_TRANSCRIPT, page(["a1"])).entryIds, ["a1"]);
});

test("an older page is prepended once, and only onto the cursor it was asked for", () => {
  const shown = page(["e1", "e2"], { hasMore: true, oldest: "e1" });
  const older = page(["a1", "a2"], { hasMore: false, oldest: "a1" });
  const prepended = prependOlderPage(shown, "e1", older);
  assert.deepEqual(prepended.entryIds, ["a1", "a2", "e1", "e2"]);
  assert.equal(prepended.oldestEntryId, "a1");
  assert.equal(prepended.hasMore, false);
  // The same answer arriving again, or after a poll moved the cursor, is dropped.
  assert.equal(prependOlderPage(prepended, "e1", older), prepended);
});

test("live updates poll the context endpoint only while running, without spawning wrappers", () => {
  // The viewer must use the read-only sessions routes, never the agent
  // command/event routes that would start an AgentSession for the subagent.
  assert.match(viewer, /\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/context/);
  assert.doesNotMatch(viewer, /\/api\/agent\//);
  assert.match(viewer, /if \(!running\) \{[\s\S]*?return \(\) => \{[\s\S]*?controller\.abort\(\);[\s\S]*?\};[\s\S]*?\}/);
  assert.match(viewer, /setInterval\(\(\) => \{[\s\S]*?document\.visibilityState === "visible"[\s\S]*?\}, POLL_MS\)/);
  assert.match(viewer, /setTranscript\(\(current\) => mergeTailPage\(current, /);
  // A 404 while the run has not written its file yet reads as "starting".
  assert.match(viewer, /if \(res\.status === 404\) \{[\s\S]*?setNotFound\(true\)/);
});

test("status prefers the live running flag and refetches the persisted one when it changes", () => {
  assert.match(viewer, /const status = running \? "running" as const : relation\?\.status \?\? "completed" as const/);
  assert.match(viewer, /info\?\.relation\?\.kind === "subagent" \? info\.relation : null/);
  assert.match(viewer, /\}, \[sessionId, running, refreshKey, fallbackLabel\]\);/);
});

test("renders messages read-only through MessageView with the subagent's own cwd and session", () => {
  assert.match(viewer, /<MessageView[\s\S]*?cwd=\{info\?\.cwd\}[\s\S]*?onOpenFile=\{onOpenFile\}[\s\S]*?sessionId=\{sessionId\}/);
  // No fork/edit affordances: the subagent chat is a viewer, not an editor.
  assert.doesNotMatch(viewer, /onFork=|onEditContent=/);
  assert.match(viewer, /prependOlderPage\(current, cursor, /);
});

test("AppShell hosts subagent tabs in the right panel next to file and terminal tabs", () => {
  assert.match(appShell, /const \[agentTabs, setAgentTabs\] = useState<\{ sessionId: string; label: string \}\[\]>\(\[\]\)/);
  assert.match(appShell, /const handleOpenSubagentTab = useCallback\(\(sessionId: string, label: string\) => \{/);
  assert.match(appShell, /setActiveFileTabId\(`agent:\$\{sessionId\}`\)/);
  assert.match(appShell, /kind: "agent" as const/);
  assert.match(appShell, /<SubagentViewer[\s\S]*?sessionId=\{activeAgentTab\.sessionId\}[\s\S]*?running=\{runningSessionIds\.has\(activeAgentTab\.sessionId\)\}/);
  // Closing the last tab of any kind folds the panel.
  assert.match(appShell, /if \(fileTabs\.length === 0 && terminalTabs\.length === 0 && remainingAgents\.length === 0\) setRightPanelOpen\(false\)/);
  // Every project switch (cwd change, session pick, new session) drops them with the file tabs.
  const drops = appShell.match(/setFileTabs\(\[\]\);\s*setAgentTabs\(\[\]\);/g) ?? [];
  assert.equal(drops.length, 3);
  // The "no files open" placeholder must not show behind an active agent tab.
  assert.match(appShell, /!terminalTabs\.some\(\(tab\) => tab\.id === activeFileTabId\) && !activeAgentTab \? \(/);
});

test("closing a tab falls back without a ?? chain swallowed by a ternary", () => {
  // `a ?? b ?? c ? x : null` parses as `(a ?? b ?? c) ? x : null`: closing a
  // file tab with another one open read `.sessionId` of a missing agent tab.
  assert.doesNotMatch(appShell, /\?\? \w+\.at\(-1\) \?/);
  assert.equal((appShell.match(/lastAgentTabId\(/g) ?? []).length, 4);
});

test("the subagent card in a tool call opens the side tab with a label", () => {
  assert.match(messageView, /onOpenSubagent\?: \(sessionId: string, label: string\) => void/);
  assert.match(messageView, /onClick=\{\(\) => onOpenSubagent\(subagent\.sessionId, subagent\.description \|\| subagent\.profile\)\}/);
  assert.doesNotMatch(messageView, /onOpenSession/);
});
