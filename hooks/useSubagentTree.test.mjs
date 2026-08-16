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

test("transcript refreshes only while active and once when work settles", () => {
  const running = { nodes: [node("running")] };
  const complete = { nodes: [node("complete")] };

  assert.equal(nextTranscriptGeneration(null, running, 3), 4);
  assert.equal(nextTranscriptGeneration(running, running, 3), 4);
  assert.equal(nextTranscriptGeneration(running, complete, 3), 4);
  assert.equal(nextTranscriptGeneration(complete, complete, 3), 3);
  assert.equal(nextTranscriptGeneration(null, complete, 3), 3);
  assert.equal(nextTranscriptGeneration(running, null, 3), 3);
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
  assert.match(source, /const busy = body\.busy === true;/);
  assert.match(source, /setStale\(!busy\)/);
  assert.match(source, /setError\(busy \? null : "subagent status timeout"\)/);
});

test("control posts only action, childSessionId, and optional message", async () => {
  const source = await readFile(new URL("./useSubagentTree.ts", import.meta.url), "utf8");
  assert.match(source, /JSON\.stringify\(\{\s*childSessionId,\s*action,\s*\.\.\.\(message !== undefined \? \{ message \} : \{\}\),\s*\}\)/);
  assert.doesNotMatch(source, /setData\(.*action/);
  assert.match(source, /await refresh\(\);\s*$/m);
  assert.match(
    source,
    /(?:adoptSnapshot\([^)]*\.data\.tree\)|await refresh\(\));\s*\}/,
    "the control path must end by adopting the POST tree or falling back to a refresh",
  );
});

test("control errors surface without optimistic lifecycle mutation", async () => {
  const source = await readFile(new URL("./useSubagentTree.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!response\.ok \|\| body\.error\) \{\s*throw new Error/);
  const controlSource = source.slice(source.indexOf("const control = useCallback"), source.indexOf("return {\n    data,"));
  assert.doesNotMatch(controlSource, /setData\(/);
});

test("control parses the response body and never reads the raw rpc control result", async () => {
  const source = await readFile(new URL("./useSubagentTree.ts", import.meta.url), "utf8");
  const controlSource = source.slice(source.indexOf("const control = useCallback"), source.indexOf("return {\n    data,"));
  assert.match(controlSource, /response\.json\(\)/);
  assert.doesNotMatch(controlSource, /data\.control/);
});

test("transcript refresh generation only bumps on active snapshots plus the terminal transition", async () => {
  const source = await readFile(new URL("./useSubagentTree.ts", import.meta.url), "utf8");
  const successPath = source.slice(source.indexOf("if (!response.ok) throw new Error"), source.indexOf("setStale(false)"));
  assert.match(successPath, /nextTranscriptGeneration\(dataRef\.current, tree, current\)/);
  assert.match(successPath, /setTranscriptRefreshGeneration/);
  const errorPath = source.slice(source.indexOf("catch (refreshError)"), source.indexOf("finally {"));
  assert.doesNotMatch(errorPath, /setTranscriptRefreshGeneration/);
});

test("a root change invalidates the previous root before the next refresh", async () => {
  const source = await readFile(new URL("./useSubagentTree.ts", import.meta.url), "utf8");
  const invalidate = source.indexOf("generationRef.current += 1;");
  const immediateRefresh = source.indexOf("// Immediate refresh on root change");
  assert.ok(invalidate !== -1, "a root-change effect must bump the generation");
  assert.ok(
    invalidate < immediateRefresh,
    "root-change invalidation must be declared before the immediate-refresh effect",
  );
  const effectStart = source.lastIndexOf("useEffect(() => {", invalidate);
  const effectEnd = source.indexOf("}, [rootId]);", invalidate) + "}, [rootId]);".length;
  const effect = source.slice(effectStart, effectEnd);
  assert.match(effect, /inFlightRef\.current = null;/);
  assert.match(effect, /dataRef\.current = null;/);
  assert.match(effect, /setData\(null\);/);
  assert.match(effect, /setStale\(false\);/);
  assert.match(effect, /setError\(null\);/);
  assert.match(effect, /}, \[rootId\]\);/);
});

test("adoptSnapshot advances the transcript generation exactly like a successful refresh", async () => {
  const source = await readFile(new URL("./useSubagentTree.ts", import.meta.url), "utf8");
  const adoptSource = source.slice(source.indexOf("const adoptSnapshot"), source.indexOf("const control = useCallback"));
  assert.match(adoptSource, /useCallback\(/);
  assert.match(adoptSource, /nextTranscriptGeneration\(dataRef\.current, tree, current\)/);
  assert.match(adoptSource, /setTranscriptRefreshGeneration/);
  assert.match(adoptSource, /setData\(tree\)/);
  assert.match(adoptSource, /setStale\(false\)/);
  assert.match(adoptSource, /setError\(null\)/);
});

test("control adopts the POST tree snapshot and refreshes only when it is absent", async () => {
  const source = await readFile(new URL("./useSubagentTree.ts", import.meta.url), "utf8");
  const controlSource = source.slice(source.indexOf("const control = useCallback"), source.indexOf("return {\n    data,"));
  assert.match(controlSource, /SubagentControlResponse/);
  assert.match(controlSource, /\.data\.tree/);
  assert.match(
    controlSource,
    /if \([^)]*\.data\.tree\) \{\s*adoptSnapshot\([^)]*\.data\.tree\);/,
    "a tree-bearing response must be adopted without a follow-up GET",
  );
  assert.match(
    controlSource,
    /} else \{\s*await refresh\(\);/,
    "refresh() must run only when the response carries no tree",
  );
  assert.doesNotMatch(controlSource, /setData\(/);
});
