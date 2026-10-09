import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const viewer = await readFile(new URL("./SubagentViewer.tsx", import.meta.url), "utf8");
const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const messageView = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");

test("buildToolResultsMap pairs tool results by tool call id", () => {
  assert.match(viewer, /export function buildToolResultsMap\(messages: readonly AgentMessage\[\]\)/);
  assert.match(viewer, /if \(message\.role === "toolResult"\) map\.set\(message\.toolCallId, message\)/);
});

test("live updates poll the context endpoint only while running, without spawning wrappers", () => {
  // The viewer must use the read-only sessions context route, never the agent
  // command/event routes that would start an AgentSession for the subagent.
  assert.match(viewer, /\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/context/);
  assert.doesNotMatch(viewer, /\/api\/agent\//);
  assert.match(viewer, /if \(!running\) \{[\s\S]*?return \(\) => \{[\s\S]*?controller\.abort\(\);[\s\S]*?\};[\s\S]*?\}/);
  assert.match(viewer, /setInterval\(\(\) => \{[\s\S]*?document\.visibilityState === "visible"[\s\S]*?\}, POLL_MS\)/);
  // A 404 while the run has not written its file yet reads as "starting".
  assert.match(viewer, /if \(res\.status === 404\) \{[\s\S]*?setNotFound\(true\)/);
});

test("status prefers the live running flag and falls back to the persisted relation", () => {
  assert.match(viewer, /const status = running \? "running" as const : relation\?\.status \?\? "completed" as const/);
  assert.match(viewer, /info\?\.relation\?\.kind === "subagent" \? info\.relation : null/);
});

test("renders messages read-only through MessageView with the subagent's own cwd", () => {
  assert.match(viewer, /<MessageView[\s\S]*?cwd=\{info\?\.cwd\}[\s\S]*?onOpenFile=\{onOpenFile\}/);
  // No fork/edit affordances: the subagent chat is a viewer, not an editor.
  assert.doesNotMatch(viewer, /onFork=|onEditContent=/);
  // Older pages load through the same context route, prepended upward.
  assert.match(viewer, /before: oldestEntryId/);
  assert.match(viewer, /setMessages\(\(prev\) => \[\.\.\.data\.context\.messages, \.\.\.prev\]\)/);
});

test("AppShell hosts subagent tabs in the right panel next to file and terminal tabs", () => {
  assert.match(appShell, /const \[agentTabs, setAgentTabs\] = useState<\{ sessionId: string; label: string \}\[\]>\(\[\]\)/);
  assert.match(appShell, /const handleOpenSubagentTab = useCallback\(\(sessionId: string, label: string\) => \{/);
  assert.match(appShell, /setActiveFileTabId\(`agent:\$\{sessionId\}`\)/);
  assert.match(appShell, /kind: "agent" as const/);
  assert.match(appShell, /<SubagentViewer[\s\S]*?sessionId=\{activeAgentTab\.sessionId\}[\s\S]*?running=\{runningSessionIds\.has\(activeAgentTab\.sessionId\)\}/);
  // Closing the last tab of any kind folds the panel.
  assert.match(appShell, /if \(fileTabs\.length === 0 && terminalTabs\.length === 0 && remainingAgents\.length === 0\) setRightPanelOpen\(false\)/);
  // Project switches drop subagent tabs together with file tabs.
  const drops = appShell.match(/setAgentTabs\(\[\]\);/g) ?? [];
  assert.equal(drops.length, 2);
  // The "no files open" placeholder must not show behind an active agent tab.
  assert.match(appShell, /!terminalTabs\.some\(\(tab\) => tab\.id === activeFileTabId\) && !activeAgentTab \? \(/);
});

test("the subagent card in a tool call opens the side tab with a label", () => {
  assert.match(messageView, /onOpenSubagent\?: \(sessionId: string, label: string\) => void/);
  assert.match(messageView, /onClick=\{\(\) => onOpenSubagent\(subagent\.sessionId, subagent\.description \|\| subagent\.profile\)\}/);
  assert.doesNotMatch(messageView, /onOpenSession/);
});
