import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("read-only child mount loads history without the live state endpoint", async () => {
  const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const mountLoad = hookSource.slice(
    hookSource.indexOf("loadSession(session.id, true,"),
    hookSource.indexOf("loadSession(session.id, true,") + 80,
  );
  assert.match(mountLoad, /loadSession\(session\.id, true, !opts\.readOnlyHistory\)/);
});

test("read-only refresh reloads persisted context with includeState false only", async () => {
  const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const refreshEffect = hookSource.slice(
    hookSource.indexOf("Read-only history mode: reload the persisted"),
    hookSource.indexOf("// Load model list"),
  );
  assert.match(refreshEffect, /loadSession\(session\.id, false, false\)/);
  assert.match(refreshEffect, /if \(!opts\.readOnlyHistory \|\| !session\?\.id \|\| opts\.historyRefreshGeneration === undefined\) return;/);
  assert.doesNotMatch(refreshEffect, /\/state/);
  assert.doesNotMatch(refreshEffect, /api\/agent\/\$\{/);
});

test("read-only mode never connects child SSE or starts a child runtime", async () => {
  const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const refreshEffect = hookSource.slice(
    hookSource.indexOf("Read-only history mode: reload the persisted"),
    hookSource.indexOf("// Load model list"),
  );
  assert.doesNotMatch(refreshEffect, /EventSource/);
  assert.doesNotMatch(refreshEffect, /maintainEventsConnected/);
  assert.doesNotMatch(refreshEffect, /startRpcSession/);
  const stateRoute = await readFile(new URL("../app/api/sessions/[id]/state/route.ts", import.meta.url), "utf8");
  // The read-only path must not reach the state route that starts wrappers.
  assert.match(stateRoute, /startRpcSession/);
});

test("ChatWindow accepts an external composer that replaces the normal input", async () => {
  const source = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(source, /subagentMode\?: \{\s*transcriptRefreshGeneration: number;\s*composer: ReactNode;\s*\}/);
  assert.match(source, /subagentMode !== undefined \? subagentMode\.composer : chatInputElement/);
  assert.match(source, /readOnlyHistory: Boolean\(subagentMode\)/);
  assert.match(source, /historyRefreshGeneration: subagentMode\?\.transcriptRefreshGeneration/);
});

test("read-only mode hides editable user-message callbacks", async () => {
  const source = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(source, /onEditContent=\{subagentMode === undefined \? handleEditContent : undefined\}/);
});
