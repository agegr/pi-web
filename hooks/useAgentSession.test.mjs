import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("waits for auto-resume only after a detached subagent starts successfully", () => {
  const eventSource = source.slice(
    source.lastIndexOf("const handleAgentEvent = useCallback"),
    source.indexOf("handleAgentEventRef.current = handleAgentEvent"),
  );
  const settleSource = source.slice(
    source.indexOf("const settleIdleSession"),
    source.indexOf("const waitForPromptSettlement = useCallback"),
  );

  assert.match(eventSource, /event\.toolName === "subagent_spawn" && event\.isError !== true/);
  assert.match(eventSource, /resultText\.includes\("auto-resume will request synthesis"\)/);
  assert.match(eventSource, /case "agent_start":[\s\S]*?detachedSubagentResumePendingRef\.current = false/);
  assert.match(settleSource, /if \(detachedSubagentResumePendingRef\.current\) \{[\s\S]*?scheduleEventStreamClose\(sid, runId\)/);
  assert.match(settleSource, /void finishPromptWithoutStream\(sid, runId\)/);
});

test("finishes ordinary prompts immediately instead of entering the subagent grace window", () => {
  const eventSource = source.slice(
    source.lastIndexOf("const handleAgentEvent = useCallback"),
    source.indexOf("handleAgentEventRef.current = handleAgentEvent"),
  );
  const settlementSource = source.slice(
    source.indexOf("const waitForPromptSettlement = useCallback"),
    source.indexOf("const waitForBashSettlement"),
  );
  const reconcileSource = source.slice(
    source.indexOf("const reconcileAgentState"),
    source.indexOf("// Recovery net for missed SSE events"),
  );

  assert.match(eventSource, /case "agent_settled":\s*case "prompt_done":[\s\S]*?settleIdleSession\(sessionIdRef\.current, promptRunIdRef\.current\)/);
  assert.match(settlementSource, /settleIdleSession\(sid, runId\)/);
  assert.match(reconcileSource, /settleIdleSession\(sid, runId\)/);
});

test("keeps the event stream alive while auto-resume is pending", () => {
  const graceSource = source.slice(
    source.lastIndexOf("const scheduleEventStreamClose"),
    source.indexOf("const settleIdleSession", source.lastIndexOf("const scheduleEventStreamClose")),
  );

  assert.match(source, /const EVENT_STREAM_IDLE_GRACE_MS = 30_000/);
  assert.match(graceSource, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}`\)/);
  assert.match(graceSource, /setTimeout\(\(\) => void checkServerIdle\(\), EVENT_STREAM_IDLE_GRACE_MS\)/);
  assert.match(graceSource, /finishPromptWithoutStream\(sid, runId\)/);
});

test("refuses a normal send while the hook knows an asynchronous run is active", () => {
  const sendSource = source.slice(
    source.indexOf("  const handleSend = useCallback"),
    source.indexOf("  const executeBash = useCallback"),
  );

  assert.match(sendSource, /if \(agentRunningRef\.current \|\| bashRunningRef\.current\) return false;/);
  assert.match(sendSource, /return Boolean\(sentSessionId\);/);
});
