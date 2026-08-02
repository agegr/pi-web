import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 源码随上游重构会调整排版（多行/缩进），断言时对源码与模式统一去空白，
// 只对"是否包含某段逻辑"做语义校验，避免脆性排版匹配。
// 模式均为字面代码片段，用 includes 做子串校验，避免正则元字符歧义。
function flat(s) {
  return s.replace(/\s+/g, "");
}
function contains(source, snippet) {
  assert.ok(flat(source).includes(flat(snippet)), `expected source to contain:\n  ${snippet}`);
}
function excludes(source, snippet) {
  assert.ok(!flat(source).includes(flat(snippet)), `expected source NOT to contain:\n  ${snippet}`);
}
function sliceAfter(source, marker) {
  return source.slice(source.indexOf(marker));
}
function sliceBetween(source, from, to) {
  return source.slice(source.indexOf(from), source.indexOf(to));
}

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = sliceAfter(source, "export async function startRpcSession");

  contains(startupSource, "createAgentSessionServices(");
  contains(startupSource, "createAgentSessionFromServices(");
  excludes(startupSource, "await createAgentSession(");
});

test("RPC session startup resolves and passes the SDK-native enabled model scope", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = sliceAfter(source, "export async function startRpcSession");
  const resolveIndex = startupSource.indexOf("resolveVisibleModels(");
  const createIndex = startupSource.indexOf("createAgentSessionFromServices(");

  assert.ok(resolveIndex >= 0);
  assert.ok(createIndex > resolveIndex);
  contains(startupSource, "selectInitialModelScope(");
  contains(startupSource, "scopedModels: initial.scopedModels");
  contains(startupSource, "model: initial.model");
  contains(startupSource, "thinkingLevel: initial.thinkingLevel");
});

test("RPC session startup treats only sessions with messages as continuing", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = sliceAfter(source, "export async function startRpcSession");

  contains(
    startupSource,
    'const hasExistingMessages = sessionManager.getBranch().some((entry) => entry.type === "message")',
  );
  contains(startupSource, "const initial = hasExistingMessages");
  excludes(startupSource, "const initial = sessionFile");
  excludes(startupSource, "sessionManager.buildSessionContext()");
});

test("RPC session startup opens an existing session file only once and trusts its cwd", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = sliceAfter(source, "export async function startRpcSession");
  const routeSource = await readFile(
    new URL("../app/api/agent/[id]/route.ts", import.meta.url),
    "utf8",
  );
  const eventRouteSource = await readFile(
    new URL("../app/api/agent/[id]/events/route.ts", import.meta.url),
    "utf8",
  );
  const autoNameRouteSource = await readFile(
    new URL("../app/api/sessions/[id]/auto-name/route.ts", import.meta.url),
    "utf8",
  );

  assert.equal((startupSource.match(/SessionManager\.open\(/g) ?? []).length, 1);
  contains(startupSource, "const sessionCwd = sessionManager.getCwd()");
  contains(startupSource, "projectTrustReloadOptions(sessionCwd, agentDir)");
  contains(startupSource, "cwd: sessionCwd");
  for (const route of [routeSource, eventRouteSource, autoNameRouteSource]) {
    excludes(route, "SessionManager.open(");
  }
});

test("RPC wrapper avoids per-chunk idle and running-state maintenance", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startSource = sliceBetween(source, "  start(): void", "  setForceEmptySystemPrompt");
  const notifySource = sliceBetween(
    source,
    "export function notifyRunningChange",
    "export async function startRpcSession",
  );

  contains(startSource, "IDLE_RESET_EVENT_TYPES.has(event.type)");
  contains(startSource, "RUNNING_STATE_EVENT_TYPES.has(event.type)");
  excludes(startSource, "subscribe((event: AgentEvent) => { this.resetIdleTimer()");
  contains(notifySource, "if (listeners.size === 0)");
  contains(notifySource, 'lastRunningSnapshot = ""');
});

test("normal session teardown paths use graceful extension shutdown", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const deleteRouteSource = await readFile(
    new URL("../app/api/sessions/[id]/route.ts", import.meta.url),
    "utf8",
  );
  const trustRouteSource = await readFile(
    new URL("../app/api/project-trust/route.ts", import.meta.url),
    "utf8",
  );
  const idleSource = sliceBetween(
    source,
    "  private resetIdleTimer",
    "  private persistBashOnlySession",
  );
  const forkSource = sliceBetween(source, 'case "fork"', 'case "navigate_tree"');

  contains(idleSource, "this.shutdown()");
  contains(forkSource, "await this.shutdown()");
  contains(deleteRouteSource, "await getRpcSession(id)?.shutdown()");
  contains(trustRouteSource, "await destroyRpcSessionsForCwd(result.cwd)");
});

test("new-session route applies model scope during construction instead of follow-up commands", async () => {
  const source = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  contains(source, "initialModel: { provider, modelId }");
  contains(source, "thinkingLevel: explicitThinkingLevel");
  excludes(source, 'session.send({ type: "set_model"');
  excludes(source, 'session.send({ type: "set_thinking_level"');
  contains(source, "model: state.model");
  contains(source, "thinkingLevel: state.thinkingLevel");
});

test("RPC session startup persists explicit preferences without replaying setters", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = sliceAfter(source, "export async function startRpcSession");

  contains(startupSource, "persistExplicitStartupPreferences(");
  contains(startupSource, "modelDefaultChanged) invalidateModelsCache()");
});

test("custom extension UI receives the fixed headless terminal facade", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const customUiSource = sliceBetween(
    source,
    "private requestExtensionCustomUi",
    "private requestExtensionUi",
  );

  contains(customUiSource, "createHeadlessCustomUiTui(");
  contains(customUiSource, "width,");
});

test("reloading a session invalidates the models cache", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const reloadSource = sliceBetween(source, 'case "reload"', 'case "abort_compaction"');

  contains(reloadSource, "await this.inner.reload()");
  contains(reloadSource, "this.applyForcedEmptySystemPrompt(); invalidateModelsCache()");
});
