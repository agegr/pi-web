import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

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
