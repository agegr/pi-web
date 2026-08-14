import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const { shouldPollSubagents, hasActiveDescendant, nextTranscriptGeneration, SUBAGENT_POLL_INTERVAL_MS } =
  await jiti.import("./useSubagentTree.ts");

function node(state, children = []) {
  return { sessionId: "x", parentSessionId: "root", runId: "r", agent: "a", task: "t", state, canSteer: false, canInterrupt: false, canResume: false, children };
}

test("polling is enabled for each approved condition and disabled only when all are false", () => {
  assert.equal(shouldPollSubagents({ treeOpen: true, childSelected: false, hasActiveDescendant: false }), true);
  assert.equal(shouldPollSubagents({ treeOpen: false, childSelected: true, hasActiveDescendant: false }), true);
  assert.equal(shouldPollSubagents({ treeOpen: false, childSelected: false, hasActiveDescendant: true }), true);
  assert.equal(shouldPollSubagents({ treeOpen: true, childSelected: true, hasActiveDescendant: true }), true);
  assert.equal(shouldPollSubagents({ treeOpen: false, childSelected: false, hasActiveDescendant: false }), false);
});

test("active descendants are starting, queued, running, or needs_attention only", () => {
  for (const state of ["starting", "queued", "running", "needs_attention"]) {
    assert.equal(hasActiveDescendant([node(state)]), true, state);
  }
  for (const state of ["paused", "complete", "stopped", "failed", "rejected", "inactive"]) {
    assert.equal(hasActiveDescendant([node(state)]), false, state);
  }
  assert.equal(hasActiveDescendant([node("complete", [node("running")])]), true, "nested active child");
  assert.equal(hasActiveDescendant([]), false);
  assert.equal(hasActiveDescendant(undefined), false);
});

test("terminal discovery increments one final transcript refresh generation", () => {
  const previous = { nodes: [node("running")] };
  const settled = { nodes: [node("complete")] };
  // Every successful snapshot advances the generation...
  assert.equal(nextTranscriptGeneration(previous, previous, 3), 4);
  // ...and settlement adds one more final refresh.
  assert.equal(nextTranscriptGeneration(previous, settled, 3), 5);
  assert.equal(nextTranscriptGeneration(null, settled, 3), 4);
  assert.equal(nextTranscriptGeneration(previous, null, 3), 4);
  // Multiple active children settling at once still adds a single extra.
  const multiActive = { nodes: [node("running", [node("queued")])] };
  assert.equal(nextTranscriptGeneration(multiActive, settled, 5), 7);
});

test("poll interval is 1500ms and the hook wires a single interval guarded by the policy", async () => {
  assert.equal(SUBAGENT_POLL_INTERVAL_MS, 1_500);
  const source = await readFile(new URL("./useSubagentTree.ts", import.meta.url), "utf8");
  assert.match(source, /setInterval\(\(\) => \{\s*void refresh\(\);\s*\}, SUBAGENT_POLL_INTERVAL_MS\)/);
  assert.match(source, /if \(!pollEligible\) return;/);
  assert.match(source, /clearInterval\(timer\)/);
});

test("concurrent refreshes coalesce into one in-flight fetch", async () => {
  const source = await readFile(new URL("./useSubagentTree.ts", import.meta.url), "utf8");
  assert.match(source, /if \(inFlightRef\.current\) return inFlightRef\.current;/);
  assert.match(source, /inFlightRef\.current = null/);
});

test("refresh uses a monotonic request generation and ignores stale responses", async () => {
  const source = await readFile(new URL("./useSubagentTree.ts", import.meta.url), "utf8");
  assert.match(source, /\+\+generationRef\.current/);
  assert.match(source, /if \(generation !== generationRef\.current\) return;/);
  assert.ok(
    source.indexOf("++generationRef.current") < source.indexOf("fetch("),
    "the generation must be claimed before the fetch starts",
  );
});

test("a 504 keeps the last live snapshot and adopts the durable fallback only once", async () => {
  const source = await readFile(new URL("./useSubagentTree.ts", import.meta.url), "utf8");
  assert.match(source, /if \(response\.status === 504\)/);
  assert.match(source, /if \(previous\) return previous;/);
  assert.match(source, /return fallback;/);
  assert.match(source, /setStale\(true\)/);
});

test("control posts only action, childSessionId, and optional message", async () => {
  const source = await readFile(new URL("./useSubagentTree.ts", import.meta.url), "utf8");
  assert.match(source, /JSON\.stringify\(\{\s*childSessionId,\s*action,\s*\.\.\.\(message !== undefined \? \{ message \} : \{\}\),\s*\}\)/);
  assert.doesNotMatch(source, /setData\(.*action/);
  assert.match(source, /await refresh\(\);\s*$/m);
});

test("control errors surface without optimistic lifecycle mutation", async () => {
  const source = await readFile(new URL("./useSubagentTree.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!response\.ok \|\| body\.error\) \{\s*throw new Error/);
  const controlSource = source.slice(source.indexOf("const control = useCallback"), source.indexOf("return {\n    data,"));
  assert.doesNotMatch(controlSource, /setData\(/);
});

test("transcript refresh generation only bumps on successful snapshots plus the terminal transition", async () => {
  const source = await readFile(new URL("./useSubagentTree.ts", import.meta.url), "utf8");
  const successPath = source.slice(source.indexOf("if (!response.ok) throw new Error"), source.indexOf("setStale(false)"));
  assert.match(successPath, /nextTranscriptGeneration\(dataRef\.current, tree, current\)/);
  assert.match(successPath, /setTranscriptRefreshGeneration/);
  const errorPath = source.slice(source.indexOf("catch (refreshError)"), source.indexOf("finally {"));
  assert.doesNotMatch(errorPath, /setTranscriptRefreshGeneration/);
});
