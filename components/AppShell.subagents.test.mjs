import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true, moduleCache: false });
const { countSubagentNodes, findSubagentNode, buildBreadcrumbItems } = await jiti.import("./SubagentSessions.tsx");

function node(sessionId, task, children = [], parentSessionId = "") {
  return { sessionId, parentSessionId, runId: "r", index: 1, agent: "a", task, state: "running", canSteer: false, canInterrupt: false, canResume: false, children };
}

test("root identity uses rootSessionId and falls back to the selected session", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /const selectedRootId = selectedSession\s*\?\s*selectedSession\.rootSessionId \?\? selectedSession\.id\s*:\s*null/);
  assert.match(source, /const childSelected = selectedSession\?\.sessionRole === "subagent"/);
  assert.match(source, /useSubagentTree\(\{\s*rootId: selectedRootId,\s*treeOpen: activeTopPanel === "subagents" \|\| desktopSubagentCardVisible,\s*childSelected,\s*\}\)/);
});

test("sidebar stays on the root while a child transcript is shown", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /selectedSessionId=\{selectedRootId \?\? selectedSession\?\.id \?\? null\}/);
});

test("tree node count and lookup helpers work recursively", () => {
  const tree = [
    node("a", "A", [node("b", "B", [node("c", "C")])]),
    node("d", "D"),
  ];
  assert.equal(countSubagentNodes(tree), 4);
  assert.equal(findSubagentNode(tree, "c")?.task, "C");
  assert.equal(findSubagentNode(tree, "missing"), null);
  assert.equal(findSubagentNode(tree, "a")?.task, "A");
});

test("breadcrumb builds the root-to-selected chain from the tree", () => {
  const tree = [node("a", "A", [node("b", "B", [node("c", "C", [], "b")], "a")])];
  const items = buildBreadcrumbItems(tree, "c", "root-session", "Main task");
  assert.deepEqual(items.map((item) => item.label), ["Main task", "A", "B", "C"]);
  assert.deepEqual(items.map((item) => item.id), ["root-session", "a", "b", "c"]);
  assert.deepEqual(buildBreadcrumbItems(tree, "missing", "root-session", "Main task"), []);
});

test("selecting a subagent or breadcrumb closes the top panel on desktop and mobile", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  // handleSubagentSelect closes the panel unconditionally, not only on mobile.
  assert.match(source, /const handleSubagentSelect = useCallback\(\(node: SubagentTreeNode\) => \{\s*if \(!node\.sessionId\) return;\s*void resolveSessionById\(node\.sessionId\)\.then\(\(session\) => \{\s*if \(session\) handleSelectSession\(session\);/);
  assert.doesNotMatch(source, /if \(isMobile\) setActiveTopPanel\(null\)/);
  // handleBreadcrumbSelect also closes the panel after selecting a session.
  assert.match(source, /const handleBreadcrumbSelect = useCallback\(\(sessionId: string\) => \{\s*void resolveSessionById\(sessionId\)\.then\(\(session\) => \{\s*if \(session\) handleSelectSession\(session\);/);
  assert.match(source, /closeTopPanel\(\);\s*\}, \[handleSelectSession, resolveSessionById, closeTopPanel\]\)/);
});

test("the breadcrumb call site seeds the chain with the real root session id", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /items=\{buildBreadcrumbItems\(\s*subagents\.data\.nodes,\s*selectedSession\.id,\s*selectedRootId \?\? "",/);
});

test("live markers derive from active descendants, not RPC availability", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  // Wide desktop has no header badge (the card owns the count); the compact
  // top bar's subagent button still derives its live dot from active descendants.
  assert.doesNotMatch(source, /subagentsLive=\{hasActiveDescendant\(subagents\.data\?\.nodes\)\}/);
  assert.match(source, /hasActiveDescendant\(subagents\.data\?\.nodes\) \? \(/);
  assert.doesNotMatch(source, /subagents\.data\?\.rpcAvailable === true \? \(/);
});

test("missing selected child recovers to the nearest surviving durable ancestor", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /findSubagentNode\(subagents\.data\.nodes, selectedSession\.id\)/);
  assert.match(source, /recoveredRef\.current === selectedSession\.id/);
  assert.match(source, /handleSelectSession\(root\)/);
  assert.match(source, /handleSelectSession\(cursor\)/);
});

test("wide desktop keeps subagent polling eligible for the right card", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /const desktopSubagentCardVisible = isWideDesktop;/);
  assert.match(source, /treeOpen: activeTopPanel === "subagents" \|\| desktopSubagentCardVisible/);
  assert.match(source, /desktop-workspace-context-stack/);
  assert.match(source, /<DesktopSubagentCard/);
  assert.match(source, /<DesktopConversationContext/);
});

test("desktop aside orders conversation context before subagents", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  const contextIndex = source.indexOf("<DesktopConversationContext");
  const subagentIndex = source.indexOf("<DesktopSubagentCard");
  assert.ok(contextIndex >= 0 && subagentIndex > contextIndex);
});

test("the subagent popover anchors to its trigger and clamps to the viewport", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /subagentsAnchorRef\.current/);
  assert.match(source, /Math\.min\(360, window\.innerWidth - 24\)/);
  assert.match(source, /Math\.max\(8, Math\.min\(rect\.left, Math\.max\(8, window\.innerWidth - width - 8\)\)\)/);
  assert.match(source, /setActiveTopPanel\(\(current\) => current === "subagents" \? null : "subagents"\)/);
});

test("opening another top panel closes the subagent popover and vice versa", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  // The single active panel union includes subagents; existing close paths use it.
  assert.match(source, /useState<"branches" \| "system" \| "session" \| "subagents" \| null>/);
  assert.match(source, /closeTopPanel/);
});

test("new durable children bump the sidebar refresh key", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /knownDurableIdsRef/);
  assert.match(source, /setRefreshKey\(\(key\) => key \+ 1\)/);
});

test("subagent transcripts never expose fork, continue, or branch navigation to a child runtime", async () => {
  const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(chat, /onFork=\{subagentMode !== undefined \|\| sessionBusy \|\| isNew/);
  assert.match(chat, /onNavigate=\{subagentMode !== undefined \|\| sessionBusy \? undefined : handleNavigate\}/);
  const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /childSelected \? null : \(/);
  assert.doesNotMatch(shell, /childSelected[^]*navigate_tree/);
});

test("child ChatWindow gets read-only subagent mode with composer and no runtime", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /sessionRunning=\{childSelected \? false : Boolean\(selectedSession && runningSessionIds\.has\(selectedSession\.id\)\)\}/);
  assert.match(source, /subagentMode=\{childSelected && selectedSession \? \{/);
  assert.match(source, /transcriptRefreshGeneration: subagents\.transcriptRefreshGeneration/);
  assert.match(source, /<SubagentComposer/);
  assert.match(source, /onInterrupt=\{async \(\) => \{\s*await subagents\.control\("interrupt", selectedSession\.id\);/);
  assert.match(source, /await subagents\.control\(action, selectedSession\.id, message\)/);
  assert.doesNotMatch(source, /startRpcSession\(selectedSession/);
});
