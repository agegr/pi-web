import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("running route aggregates navigation metadata and live state in one response", () => {
  assert.match(source, /getRunningRpcSessionSnapshots/);
  assert.match(source, /listAllSessions/);
  assert.match(source, /buildRunningSessionSnapshot\(/);
  assert.match(source, /runningSessions/);
  assert.match(source, /runningSessionIds/);
  assert.match(source, /historyError/);
  assert.match(source, /Cache-Control.*no-store/);
});

test("running route keeps live sessions visible when history metadata fails", () => {
  assert.match(source, /let historyError/);
  assert.match(source, /try \{\s*sessions = await listAllSessions\(\);/);
  assert.match(source, /catch \(error\)/);
  assert.match(source, /historyError/);
});
