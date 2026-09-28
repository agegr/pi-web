import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("gates the subagent run lift on every field the progress line renders", () => {
  const keySource = source.slice(
    source.indexOf("const subagentRunsKey"),
    source.indexOf("const subagentRunsRef"),
  );
  // label, currentTool, toolCount, turnCount and the run's timestamps must all
  // contribute, or the progress line freezes while the run is unchanged in id/state.
  assert.match(keySource, /run\.label/);
  assert.match(keySource, /run\.activity\?\.currentTool/);
  assert.match(keySource, /run\.activity\?\.toolCount/);
  assert.match(keySource, /run\.activity\?\.turnCount/);
  assert.match(keySource, /run\.startedAt/);
  assert.match(keySource, /run\.endedAt/);
});

test("polls wrapper state while a detached run is live and stops once it is terminal", () => {
  const pollSource = source.slice(
    source.indexOf("const hasLiveSubagentRun"),
    source.indexOf("Push context usage up to AppShell"),
  );
  // Only poll when the parent prompt is not already driving the refresh.
  assert.match(pollSource, /if \(!hasLiveSubagentRun \|\| agentRunning\) return;/);
  assert.match(pollSource, /setInterval\(poll, SUBAGENT_RUN_POLL_MS\)/);
  assert.match(pollSource, /\/api\/agent\/\$\{encodeURIComponent\(sid\)\}/);
  assert.match(pollSource, /setExtensionWidgets\(data\.state\.extensionWidgets \?\? \[\]\)/);
  assert.match(pollSource, /document\.removeEventListener\("visibilitychange", poll\)/);
  // Background tabs stop re-reading wrapper state; the visibilitychange nudge
  // only fetches once the tab is visible again (sidebar's convention).
  assert.match(pollSource, /document\.visibilityState !== "visible"/);
  // A stale in-flight response must not apply widgets after cleanup or a newer poll.
  assert.match(pollSource, /new AbortController\(\)/);
  assert.match(pollSource, /signal: current\.signal/);
  assert.match(pollSource, /if \(controller !== current\) return;/);
  assert.match(pollSource, /controller\?\.abort\(\)/);
  // A dead wrapper can never refresh the widget again; the poll stops itself.
  assert.match(pollSource, /data\.state === undefined && interval[\s\S]*?clearInterval\(interval\)/);
  // Liveness comes from the shared snapshot helper; a child session has no
  // widget of its own, so its persisted relation status is not polled here.
  assert.match(pollSource, /hasLivePiSubagentRun\(snapshot\)/);
});
