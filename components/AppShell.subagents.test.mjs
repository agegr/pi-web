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
  assert.match(source, /useSubagentTree\(\{\s*rootId: selectedRootId,\s*treeOpen: activeTopPanel === "subagents",\s*childSelected,\s*\}\)/);
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
  const items = buildBreadcrumbItems(tree, "c", "Main task");
  assert.deepEqual(items.map((item) => item.label), ["Main task", "A", "B", "C"]);
  assert.deepEqual(items.map((item) => item.id), ["", "a", "b", "c"]);
  assert.deepEqual(buildBreadcrumbItems(tree, "missing", "Main task"), []);
});

test("tree and breadcrumb selection resolve durable sessions before switching", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /resolveSessionById/);
  assert.match(source, /void resolveSessionById\(node\.sessionId\)\.then\(\(session\) => \{\s*if \(session\) handleSelectSession\(session\);/) ;
  assert.match(source, /handleBreadcrumbSelect/);
});

test("missing selected child recovers to the nearest surviving durable ancestor", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /findSubagentNode\(subagents\.data\.nodes, selectedSession\.id\)/);
  assert.match(source, /recoveredRef\.current === selectedSession\.id/);
  assert.match(source, /handleSelectSession\(root\)/);
  assert.match(source, /handleSelectSession\(cursor\)/);
});

test("the subagent popover anchors to its trigger and clamps to the viewport", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /subagentsAnchorRef\.current/);
  assert.match(source, /Math\.min\(440, window\.innerWidth - 24\)/);
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
