import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SideChatPanel.tsx", import.meta.url), "utf8");

test("opens the fork through the idempotent route so a reclaim is recoverable", () => {
  assert.match(source, /fetch\(`\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/side-chat`, \{ method: "POST" \}\)/);
  assert.match(source, /sideChatRef\.current = opened;/);
  assert.match(source, /connection\.maintain\(opened\.sessionId\)/);
});

test("resends the prompt in a fresh fork when the runtime was reclaimed", () => {
  assert.match(source, /isSideChatReclaimError\(err as AgentCommandError\)/);
  assert.match(source, /const revived = await openFork\(\)/);
  assert.match(source, /await prompt\(revived\.sessionId\)/);
  // Exactly one retry: the revive path returns instead of falling through.
  const reviveBlock = source.slice(source.indexOf("const revived = await openFork()"));
  assert.match(reviveBlock.slice(0, 400), /return;/);
  assert.match(source, /setNotice\("revived"\)/);
});

test("stops the event stream from retrying a reclaimed runtime forever", () => {
  assert.match(source, /source\.readyState === EventSource\.CLOSED/);
  assert.match(source, /runtimeGoneRef\.current = true/);
  assert.match(source, /shouldMaintain: \(\) => mountedRef\.current && !runtimeGoneRef\.current/);
  // Opening a fork clears the flag, otherwise the revived stream never starts.
  assert.match(source, /runtimeGoneRef\.current = false/);
});

test("unlocks the composer on abort so recovery is still possible", () => {
  const abortBlock = source.slice(source.indexOf("const abort = useCallback"));
  assert.ok(abortBlock.length > 0);
  assert.ok(
    abortBlock.indexOf("setRunning(false)") < abortBlock.indexOf("sendAgentCommand"),
    "running must be cleared before the abort request",
  );
});

test("breaks the import chain that would pull server-only modules into the client bundle", () => {
  // The panel is a client component: importing lib/side-chat (which reads the
  // session reader, and through it node:fs) fails the browser build.
  assert.equal(source.includes("@/lib/side-chat"), false);
  assert.match(source, /from "@\/lib\/agent-client"/);
});

test("never drops the last transcript resync of a turn", () => {
  // A turn emits message_end, agent_settled and agent_end back to back. An
  // in-flight dedup used to swallow the final fetch, leaving the panel a turn
  // behind with no later event to correct it.
  assert.equal(source.includes("resyncRef"), false);
  assert.match(source, /const seq = \+\+loadSeqRef\.current/);
  assert.match(source, /seq !== loadSeqRef\.current\) return;/);
  assert.match(source, /scheduleReload/);
  assert.match(source, /}, RELOAD_COALESCE_MS\);/);
});

test("closing discards the fork so nothing outlives the panel", () => {
  assert.match(source, /method: "DELETE"/);
  assert.match(source, /onClose\(\)/);
});
