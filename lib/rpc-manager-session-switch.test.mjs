import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rpcManagerSource = () => readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

test("extension command actions implement session replacement instead of always cancelling", async () => {
  const source = await rpcManagerSource();
  const actionsSource = source.slice(source.indexOf("createExtensionCommandContextActions()"));

  assert.match(actionsSource, /newSession: async \(options\) => this\.replaceWithNewSession\(options\)/);
  assert.match(
    actionsSource,
    /switchSession: async \(sessionPath, options\) =>\s*this\.replaceWithExistingSession\(sessionPath, options\?\.withSession\)/,
  );
});

test("session replacement honours session_before_switch cancellation", async () => {
  const source = await rpcManagerSource();

  assert.match(source, /type: "session_before_switch",\s*reason,/);
  assert.match(source, /return result\?\.cancel === true;/);
  assert.match(source, /if \(await this\.emitBeforeSwitch\("new"\)\) return \{ cancelled: true \};/);
  assert.match(
    source,
    /if \(await this\.emitBeforeSwitch\("resume", sessionPath\)\) return \{ cancelled: true \};/,
  );
});

test("session replacement notifies browsers before tearing the old session down", async () => {
  const source = await rpcManagerSource();
  const finishSource = source.slice(source.indexOf("private async finishSessionReplacement("));
  const emitIndex = finishSource.indexOf('type: "session_switch"');
  const teardownIndex = finishSource.indexOf("this.teardownForReplacement(");

  assert.ok(emitIndex >= 0);
  assert.ok(teardownIndex > emitIndex, "session_switch must be emitted before teardown");
  assert.match(finishSource, /startRpcSession\(sessionId, sessionFile \?\? "", cwd, \{/);
  assert.match(finishSource, /sessionStartEvent: \{\s*type: "session_start",\s*reason,/);
  assert.match(finishSource, /await next\.waitUntilReady\(\);/);
  assert.match(finishSource, /next\.inner\.createReplacedSessionContext\?\.\(\)/);
});

test("startRpcSession can adopt an already-open SessionManager and a session_start reason", async () => {
  const source = await rpcManagerSource();
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /if \(options\.sessionManager\) \{\s*sessionManager = options\.sessionManager;/);
  assert.match(startupSource, /\.\.\.\(sessionStartEvent \? \{ sessionStartEvent \} : \{\}\)/);
});

test("extension-created sessions are flushed to disk so the browser can read them", async () => {
  const source = await rpcManagerSource();

  assert.match(source, /function persistSessionFileIfMissing\(manager: SessionManager\): void/);
  assert.match(source, /persistSessionFileIfMissing\(sessionManager\);/);
});

test("the chat hook follows a server-side session switch", async () => {
  const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");

  assert.match(hookSource, /case "session_switch": \{/);
  assert.match(hookSource, /onSessionSwitched\?\.\(targetSessionId\)/);
  assert.match(hookSource, /targetSessionId !== sessionIdRef\.current/);
});
