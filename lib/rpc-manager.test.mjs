import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /createAgentSessionServices\(/);
  assert.match(startupSource, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(startupSource, /await createAgentSession\(/);
});

test("RPC session startup injects the hidden inline extensions and passes the subagent capture to the wrapper", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /createSubagentRpcCapture\(\)/);
  assert.match(startupSource, /createReasoningRouterExtension\(\)/);
  assert.match(startupSource, /createProjectCommandBashExtension/);
  assert.match(startupSource, /extensionsOverride: preferUserBashExtension/);
  assert.match(startupSource, /subagentRpc\.extension/);
  assert.match(startupSource, /new AgentSessionWrapper\(inner, subagentRpc\.capture\)/);
  assert.doesNotMatch(startupSource, /resourceLoaderOptions: \{[^}]*eventBus/);
});

test("wrapper resets the subagent rpc client before extension reload and disposes it on destroy", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const reloadSource = source.slice(source.indexOf('case "reload"'), source.indexOf('case "abort_compaction"'));
  const destroySource = source.slice(source.indexOf("  destroy(): void {"), source.indexOf("  async shutdown(): Promise<void> {"));

  assert.match(reloadSource, /subagentRpcClient\.resetForReload\(\)/);
  assert.ok(
    reloadSource.indexOf("subagentRpcClient.resetForReload()") < reloadSource.indexOf("await this.inner.reload()"),
    "the rpc client must reset before extensions reload",
  );
  assert.match(destroySource, /subagentRpcClient\.dispose\(\)/);
  assert.match(source, /async getSubagentRpcClient\(\): Promise<SubagentRpcClient>/);
});

test("RPC session startup resolves and passes the SDK-native enabled model scope", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const resolveIndex = startupSource.indexOf("resolveVisibleModels(");
  const createIndex = startupSource.indexOf("createAgentSessionFromServices(");

  assert.ok(resolveIndex >= 0);
  assert.ok(createIndex > resolveIndex);
  assert.match(startupSource, /selectInitialModelScope\(/);
  assert.match(startupSource, /scopedModels: initial\.scopedModels/);
  assert.match(startupSource, /model: initial\.model/);
  assert.match(startupSource, /thinkingLevel: initial\.thinkingLevel/);
});

test("RPC session startup treats only sessions with messages as continuing", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(
    startupSource,
    /const hasExistingMessages = sessionManager\.getBranch\(\)\.some\(\(entry\) => entry\.type === "message"\)/,
  );
  assert.match(startupSource, /const initial = hasExistingMessages/);
  assert.doesNotMatch(startupSource, /const initial = sessionFile/);
  assert.doesNotMatch(startupSource, /sessionManager\.buildSessionContext\(\)/);
});

test("RPC session startup opens an existing session file only once and trusts its cwd", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const routeSource = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const eventRouteSource = await readFile(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8");
  const autoNameRouteSource = await readFile(new URL("../app/api/sessions/[id]/auto-name/route.ts", import.meta.url), "utf8");

  assert.equal((startupSource.match(/SessionManager\.open\(/g) ?? []).length, 1);
  assert.match(startupSource, /const sessionCwd = sessionManager\.getCwd\(\)/);
  assert.match(startupSource, /projectTrustReloadOptions\(sessionCwd, agentDir\)/);
  assert.match(startupSource, /cwd: sessionCwd/);
  for (const route of [routeSource, eventRouteSource, autoNameRouteSource]) {
    assert.doesNotMatch(route, /SessionManager\.open\(/);
  }
});

test("RPC wrapper avoids per-chunk idle and running-state maintenance", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startSource = source.slice(
    source.indexOf("  start("),
    source.indexOf("  setForceEmptySystemPrompt"),
  );
  const notifySource = source.slice(
    source.indexOf("export function notifyRunningChange"),
    source.indexOf("export async function startRpcSession"),
  );

  assert.match(startSource, /IDLE_RESET_EVENT_TYPES\.has\(event\.type\)/);
  assert.match(startSource, /RUNNING_STATE_EVENT_TYPES\.has\(event\.type\)/);
  assert.doesNotMatch(startSource, /subscribe\(\(event: AgentEvent\) => \{\s*this\.resetIdleTimer\(\)/);
  assert.match(notifySource, /if \(listeners\.size === 0\)/);
  assert.match(notifySource, /lastRunningSnapshot = ""/);
});

test("normal session teardown paths use graceful extension shutdown", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const deleteRouteSource = await readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");
  const trustRouteSource = await readFile(new URL("../app/api/project-trust/route.ts", import.meta.url), "utf8");
  const idleSource = source.slice(
    source.indexOf("  private resetIdleTimer"),
    source.indexOf("  private persistBashOnlySession"),
  );
  const forkSource = source.slice(
    source.indexOf('case "fork"'),
    source.indexOf('case "navigate_tree"'),
  );

  assert.match(idleSource, /this\.shutdown\(\)/);
  assert.match(forkSource, /await this\.shutdown\(\)/);
  assert.match(deleteRouteSource, /await getRpcSession\(id\)\?\.shutdown\(\)/);
  assert.match(trustRouteSource, /await destroyRpcSessionsForCwd\(result\.cwd\)/);
});

test("new-session route applies model scope during construction instead of follow-up commands", async () => {
  const source = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  assert.match(source, /initialModel: \{ provider, modelId \}/);
  assert.match(source, /thinkingLevel: explicitThinkingLevel/);
  assert.doesNotMatch(source, /session\.send\(\{ type: "set_model"/);
  assert.doesNotMatch(source, /session\.send\(\{ type: "set_thinking_level"/);
  assert.match(source, /model: state\.model/);
  assert.match(source, /thinkingLevel: state\.thinkingLevel/);
});

test("prompt routes mark only preflight failures as rejected", async () => {
  const existingRoute = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const newRoute = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  for (const source of [existingRoute, newRoute]) {
    assert.match(source, /let promptAccepted = false/);
    assert.match(source, /await .*\.send\(/);
    assert.match(source, /promptAccepted = .*\.type === "prompt"/);
    assert.match(source, /commandType === "prompt" && !promptAccepted/);
  }
});

test("RPC session startup persists explicit preferences without replaying setters", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /persistExplicitStartupPreferences\(/);
  assert.match(startupSource, /modelDefaultChanged\) invalidateModelsCache\(\)/);
});

test("custom extension UI receives the fixed headless terminal facade", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const customUiSource = source.slice(
    source.indexOf("private requestExtensionCustomUi"),
    source.indexOf("private requestExtensionUi"),
  );

  assert.match(customUiSource, /createHeadlessCustomUiTui\(/);
  assert.match(customUiSource, /width,/);
});

test("reloading a session invalidates the models cache", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const reloadSource = source.slice(
    source.indexOf('case "reload"'),
    source.indexOf('case "abort_compaction"'),
  );

  assert.match(reloadSource, /await this\.inner\.reload\(\)/);
  assert.match(reloadSource, /this\.applyForcedEmptySystemPrompt\(\);\s*invalidateModelsCache\(\)/);
});

test("saving model config refreshes only existing live sessions without creating a registry", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const routeSource = await readFile(new URL("../app/api/models-config/route.ts", import.meta.url), "utf8");
  const refreshSource = source.slice(
    source.indexOf("export async function refreshRpcSessionModelConfigs"),
    source.indexOf("function runtimeMessageText"),
  );

  assert.match(refreshSource, /globalThis\.__piSessions/);
  assert.doesNotMatch(refreshSource, /getRegistry\(\)/);
  assert.match(refreshSource, /if \(!registry\) return 0/);
  assert.match(refreshSource, /wrapper\.isAlive\(\)/);
  assert.match(refreshSource, /await wrapper\.inner\.modelRuntime\.refresh\(\{ allowNetwork: false \}\)/);
  assert.match(refreshSource, /catch \(error\)/);
  assert.ok(
    routeSource.indexOf("await refreshRpcSessionModelConfigs()")
      > routeSource.indexOf("writeModelsConfig(body)"),
    "live sessions must refresh after the config is written",
  );
});

test("model config refresh tolerates failures and leaves a missing registry uninitialized", async () => {
  const { refreshRpcSessionModelConfigs } = await jiti.import("./rpc-manager.ts");
  const originalRegistry = globalThis.__piSessions;
  const originalConsoleError = console.error;
  const calls = [];

  try {
    delete globalThis.__piSessions;
    assert.equal(await refreshRpcSessionModelConfigs(), 0);
    assert.equal(globalThis.__piSessions, undefined);

    globalThis.__piSessions = new Map([
      ["live", {
        sessionId: "live",
        isAlive: () => true,
        inner: { modelRuntime: { refresh: async (options) => calls.push(options) } },
      }],
      ["dead", {
        sessionId: "dead",
        isAlive: () => false,
        inner: { modelRuntime: { refresh: async () => calls.push("dead") } },
      }],
      ["failed", {
        sessionId: "failed",
        isAlive: () => true,
        inner: { modelRuntime: { refresh: async () => { throw new Error("refresh failed"); } } },
      }],
    ]);
    console.error = () => {};

    assert.equal(await refreshRpcSessionModelConfigs(), 1);
    assert.deepEqual(calls, [{ allowNetwork: false }]);
  } finally {
    console.error = originalConsoleError;
    if (originalRegistry) globalThis.__piSessions = originalRegistry;
    else delete globalThis.__piSessions;
  }
});

test("shutdown flushes a running turn before disposing", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const shutdownSource = source.slice(source.indexOf("  async shutdown(): Promise<void>"));
  const destroySource = source.slice(source.indexOf("  destroy(): void"), source.indexOf("  async shutdown(): Promise<void>"));

  assert.match(shutdownSource, /if \(this\.shutdownPromise\) return this\.shutdownPromise/);
  assert.match(shutdownSource, /await this\.inner\.abort\(\)/);
  assert.match(shutdownSource, /if \(this\.isRunning\(\)\)/);
  assert.ok(
    shutdownSource.indexOf("await this.inner.abort()") < shutdownSource.indexOf("this.destroy()"),
    "abort must flush the turn before dispose",
  );
  assert.doesNotMatch(destroySource, /await this\.inner\.abort/);
});

test("mutating commands refuse while a session is shutting down", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const sendSource = source.slice(source.indexOf("  async send(command: Record<string, unknown>): Promise<unknown> {"), source.indexOf("  private resolveExtensionUiResponse"));

  assert.match(sendSource, /if \(this\.shutdownPromise\) \{/);
  assert.match(sendSource, /Session is shutting down/);
  assert.match(sendSource, /get_state|get_session_stats/);
});

test("startRpcSession disposes the inner session when startup fails after creation", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /catch \(error\) \{[\s\S]*?inner\.dispose\(\)[\s\S]*?throw error/);
});

test("queue mutations rebuild the queue through clearQueue + per-kind requeue", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const helperSource = source.slice(source.indexOf("  private async mutateQueue("), source.indexOf("  private async steerAllQueued("));

  assert.match(helperSource, /this\.inner\.clearQueue\(\)/);
  // DSH/Codex 引导: inject into the current turn. Never abort+new-prompt.
  assert.match(helperSource, /await this\.inner\.steer\(target\)/);
  assert.doesNotMatch(helperSource, /this\.inner\.abort\(/);
  assert.match(helperSource, /await this\.requeueAll\(/);
  assert.match(helperSource, /catch \(error\) \{[\s\S]*?await this\.requeueAll\(steering, followUp\)/);
});

test("steer while streaming does not abort the in-flight run", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const sendSource = source.slice(source.indexOf("  async send(command: Record<string, unknown>): Promise<unknown> {"), source.indexOf("  private resolveExtensionUiResponse"));
  const promptCase = sendSource.slice(sendSource.indexOf('case "prompt":'), sendSource.indexOf('case "abort":'));
  assert.doesNotMatch(promptCase, /streamingBehavior === "steer" && this\.inner\.isStreaming/);
  assert.doesNotMatch(promptCase, /this\.inner\.abort\(\)/);
});

test("queue-wide interject steers every pending item FIFO per kind", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const start = source.indexOf("  private async steerAllQueued(");
  const end = source.indexOf("  private applyForcedEmptySystemPrompt(", start);
  const steerAllSource = source.slice(start, end);

  assert.match(steerAllSource, /this\.inner\.clearQueue\(\)/);
  assert.match(steerAllSource, /for \(const text of steering\)/);
  assert.match(steerAllSource, /for \(const text of followUp\)/);
  assert.match(steerAllSource, /this\.inner\.steer\(text\)/);
  assert.doesNotMatch(steerAllSource, /this\.inner\.abort\(/);
});

test("queue mutation commands are wired into the send switch and wait for extensions", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const sendSource = source.slice(source.indexOf("  async send(command: Record<string, unknown>): Promise<unknown> {"), source.indexOf("  private resolveExtensionUiResponse"));

  assert.match(sendSource, /case "queue_remove":/);
  assert.match(sendSource, /case "queue_edit":/);
  assert.match(sendSource, /case "queue_steer_item":/);
  assert.match(sendSource, /case "queue_steer_all":/);
  assert.match(source, /type === "queue_remove" \|\| type === "queue_edit"\s*\|\| type === "queue_steer_item" \|\| type === "queue_steer_all"/);
});
