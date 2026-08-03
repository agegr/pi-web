import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("keeps the session running while an asynchronous extension can resume it", () => {
  const graceSource = source.slice(
    source.lastIndexOf("const scheduleEventStreamClose"),
    source.indexOf("const waitForPromptSettlement", source.lastIndexOf("const scheduleEventStreamClose")),
  );
  const eventSource = source.slice(
    source.lastIndexOf("const handleAgentEvent = useCallback"),
    source.indexOf("handleAgentEventRef.current = handleAgentEvent"),
  );

  assert.match(source, /const EVENT_STREAM_IDLE_GRACE_MS = 30_000/);
  assert.match(graceSource, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}`\)/);
  assert.match(graceSource, /setTimeout\(\(\) => void checkServerIdle\(\), EVENT_STREAM_IDLE_GRACE_MS\)/);
  assert.match(graceSource, /finishPromptWithoutStream\(sid, runId\)/);
  assert.match(eventSource, /case "agent_start":[\s\S]*?cancelEventStreamGrace\(\)/);
  assert.match(eventSource, /case "agent_settled":[\s\S]*?scheduleEventStreamClose\(sessionIdRef\.current, promptRunIdRef\.current\)/);
  assert.match(eventSource, /case "prompt_done":[\s\S]*?scheduleEventStreamClose\(sessionIdRef\.current, promptRunIdRef\.current\)/);
});

test("does not finish a prompt immediately when reconciliation sees the parent turn idle", () => {
  const settlementSource = source.slice(
    source.indexOf("const waitForPromptSettlement = useCallback"),
    source.indexOf("const waitForBashSettlement"),
  );
  const reconcileSource = source.slice(
    source.indexOf("const reconcileAgentState"),
    source.indexOf("// Recovery net for missed SSE events"),
  );

  assert.match(settlementSource, /scheduleEventStreamClose\(sid, runId\)/);
  assert.doesNotMatch(settlementSource, /finishPromptWithoutStream\(sid, runId\)/);
  assert.match(reconcileSource, /scheduleEventStreamClose\(sid, runId\)/);
  assert.doesNotMatch(reconcileSource, /finishPromptWithoutStream\(sid, runId\)/);
});

test("refuses a normal send while the hook knows an asynchronous run is active", () => {
  const sendSource = source.slice(
    source.indexOf("  const handleSend = useCallback"),
    source.indexOf("  const executeBash = useCallback"),
  );

  assert.match(sendSource, /if \(agentRunningRef\.current \|\| bashRunningRef\.current\) return false;/);
  assert.match(sendSource, /return Boolean\(sentSessionId\);/);
});
