import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hookSource = readFileSync(new URL("./useTrajectory.ts", import.meta.url), "utf8");
const agentSessionSource = readFileSync(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("useTrajectory fetches summary by session id and leaf id", () => {
  assert.match(hookSource, /detailLevel=summary/);
  assert.match(hookSource, /leafId/);
  assert.match(hookSource, /trajectoryVersion/);
  assert.match(hookSource, /expandSubagent/);
});

test("useTrajectory keeps only remote trajectory state", () => {
  assert.doesNotMatch(hookSource, /const \[query, setQuery\]/);
  assert.doesNotMatch(hookSource, /const refresh/);
});

test("useTrajectory does not open a second SSE connection", () => {
  assert.doesNotMatch(hookSource, /new EventSource/);
  assert.doesNotMatch(hookSource, /events/);
});

test("useAgentSession exposes trajectory version changes", () => {
  assert.match(agentSessionSource, /onTrajectoryVersionChange/);
  assert.match(agentSessionSource, /trajectory_update/);
  assert.match(agentSessionSource, /activeLeafId/);
});
