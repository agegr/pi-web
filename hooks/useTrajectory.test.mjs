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

test("useTrajectory reports locale-neutral error codes", () => {
  assert.match(hookSource, /"no_sidecar"/);
  assert.match(hookSource, /"unavailable"/);
  assert.match(hookSource, /"load_failed"/);
  assert.doesNotMatch(hookSource, /Trajectory is not available/);
});

test("useTrajectory keeps only remote trajectory state", () => {
  assert.doesNotMatch(hookSource, /const \[query, setQuery\]/);
  assert.doesNotMatch(hookSource, /const refresh/);
});

test("useTrajectory does not open a second SSE connection", () => {
  assert.doesNotMatch(hookSource, /new EventSource/);
  assert.doesNotMatch(hookSource, /events/);
});

test("expandSubagent toggles collapse and keeps child errors off the parent view", () => {
  assert.match(hookSource, /next\.delete\(childSessionId\)/);
  assert.doesNotMatch(hookSource, /setError\(`Failed to load child trajectory/);
  assert.doesNotMatch(hookSource, /void \(async \(\) => \{/);
});

test("useAgentSession exposes trajectory version changes", () => {
  assert.match(agentSessionSource, /onTrajectoryVersionChange/);
  assert.match(agentSessionSource, /trajectory_update/);
  assert.match(agentSessionSource, /activeLeafId/);
});
