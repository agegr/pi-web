import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { trackPiSubagentSessionRefetches } = await jiti.import("../lib/pi-subagents-snapshot.ts");

const source = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

/** A run node. `kind` is overridable so placeholder children can be exercised. */
function run(id, state, kind = "subagent") {
  return { id, kind, label: id, state };
}

test("re-renders the Agents panel from every subagent run update", () => {
  const handlerSource = source.slice(
    source.indexOf("const handleSubagentRunsChange"),
    source.indexOf("const handleRunningSessionIdsChange"),
  );
  assert.match(handlerSource, /setSubagentRuns\(runs\)/);
  // A guard that only compares id/state drops label, activity and timestamps,
  // which freezes the progress line mid-run; ChatWindow's key already gates
  // identity churn, so no equality check belongs here.
  assert.doesNotMatch(handlerSource, /previous\.every/);
});

test("refetches the sessions list through refreshKey from the shared decision", () => {
  const effectSource = source.slice(
    source.indexOf("const refreshedSubagentRunIdsRef"),
    source.indexOf("const [sessionKey, setSessionKey]"),
  );
  // The panel reads its family from the sessions list, so the live widget drives
  // the refetch; the decision itself is the shared, unit-tested helper.
  assert.match(effectSource, /trackPiSubagentSessionRefetches\(\s*subagentRuns,/);
  assert.match(effectSource, /if \(trackPiSubagentSessionRefetches\([\s\S]*?\)\) setRefreshKey\(\(k\) => k \+ 1\)/);
  // The record of handled ids must survive the widget's unmount reset, so it
  // lives in refs, not state.
  assert.match(effectSource, /const refreshedSubagentRunIdsRef = useRef<Set<string>>\(new Set\(\)\)/);
  assert.match(effectSource, /const terminalSubagentRunIdsRef = useRef<Set<string>>\(new Set\(\)\)/);
  // One bump per render, never a timer or a per-tick loop.
  assert.doesNotMatch(effectSource, /setInterval|setTimeout/);
});

test("bumps once for a run start and once more when that run reaches terminal", () => {
  const started = new Set();
  const terminal = new Set();
  const bump = (runs) => trackPiSubagentSessionRefetches(runs, started, terminal);

  assert.equal(bump([run("r", "running")]), true, "the first live sighting refetches");
  assert.equal(bump([run("r", "running")]), false, "a later live publish does not");
  assert.equal(bump([run("r", "complete")]), true, "the terminal transition refetches");
  assert.equal(bump([run("r", "complete")]), false, "a repeated terminal publish does not");
});

test("does not bump for a run first seen already terminal", () => {
  const started = new Set();
  const terminal = new Set();
  // A row that appears already finished was persisted that way: there is no
  // stale Running badge to replace, so no forced sessions scan is owed.
  assert.equal(trackPiSubagentSessionRefetches([run("done", "complete")], started, terminal), false);
  assert.equal(trackPiSubagentSessionRefetches([run("done", "failed")], started, terminal), false);
});

test("ignores placeholder children for the refetch decision", () => {
  const started = new Set();
  const terminal = new Set();
  assert.equal(trackPiSubagentSessionRefetches([run("step:0", "running", "step")], started, terminal), false);
  assert.equal(trackPiSubagentSessionRefetches([run("build", "running", "host-step")], started, terminal), false);
  // A workflow run is a real run node and still counts.
  assert.equal(trackPiSubagentSessionRefetches([run("wf", "running", "workflow")], started, terminal), true);
});
