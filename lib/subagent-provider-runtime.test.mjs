import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url);
const { createSubagentController } = await jiti.import("./subagent-runtime.ts");
const { captureProviderExtensions, trackProviderExtensions, requiredProviderExtensions } = await jiti.import("./subagent-provider-runtime.ts");
const { readSubagentSessionResources } = await jiti.import("./subagents.ts");

test("native children keep provider state and session settings in their own sessions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-provider-isolation-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const sessions = new Map();
  const children = [];
  let parent;
  try {
    await mkdir(join(dir, "agents"));
    await writeFile(join(dir, "agents", "delegate.md"), "---\ndescription: Test delegation\ntools: read\nload_extensions: false\n---\nReply ok.\n");
    const extension = join(dir, "stateful-provider.ts");
    await writeFile(extension, `
      import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
      export default function(pi) {
        pi.on("session_start", (_event, ctx) => {
          const base = ctx.modelRegistry.getRegisteredNativeProvider("openai-codex") ?? ctx.modelRegistry.getProvider("openai-codex");
          function stream(model, _context, options) {
            const owner = ctx.sessionManager.getSessionId();
            pi.appendEntry("provider-response", { owner, requestSessionId: options.sessionId });
            const output = createAssistantMessageEventStream();
            output.push({ type: "done", reason: "stop", message: {
              role: "assistant", content: [{ type: "text", text: "ok" }], api: model.api,
              provider: model.provider, model: model.id, stopReason: "stop", timestamp: Date.now(),
              usage: { input: 0, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 1,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            } }); output.end(); return output;
          }
          pi.registerProvider({ ...base, stream, streamSimple: stream });
        });
        pi.registerTool({ name: "provider_extra", label: "Provider extra", description: "Unselected extension tool",
          parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "extra" }] }) });
      }
    `);
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("openai-codex", () => ({ type: "oauth", access: "test-access", refresh: "test-refresh", expires: Date.now() + 86400000 }));
    const runtime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
    const defaults = { compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", extensions: [extension] };
    await writeFile(join(dir, "settings.json"), JSON.stringify(defaults));
    const settings = SettingsManager.create(dir, dir);
    const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings,
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionsOverride: captureProviderExtensions });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const manager = SessionManager.create(dir, dir);
    manager.appendCustomEntry("example:settings", { version: 1, sessionId: manager.getSessionId(), values: { detail: "high" } });
    const model = runtime.getModels("openai-codex")[0];
    ({ session: parent } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model,
      settingsManager: settings, resourceLoader: loader, sessionManager: manager, thinkingLevel: "off", tools: ["read"] }));
    trackProviderExtensions(parent);
    await parent.bindExtensions({ onError: (error) => { throw new Error(JSON.stringify(error)); } });
    await parent.prompt("parent ready");
    const provider = runtime.getRegisteredNativeProvider("openai-codex");
    const count = manager.getEntries().length;
    function wrap(inner) {
      const wrapper = { inner, cwd: dir, sessionFile: inner.sessionFile, isAlive: () => true, isRunning: () => inner.isStreaming,
        waitUntilReady: () => wrapper.ready ?? Promise.resolve() };
      return wrapper;
    }
    sessions.set(parent.sessionId, wrap(parent));
    const controller = createSubagentController({
      getSession: id => sessions.get(id),
      registerSession(inner) {
        const wrapper = wrap(inner); sessions.set(inner.sessionId, wrapper); children.push(inner);
        trackProviderExtensions(inner); wrapper.ready = inner.bindExtensions({});
      },
      reopenSession: async id => sessions.get(id), resolveSessionPath: async id => sessions.get(id)?.sessionFile,
      invalidateSessionList() {}, isBuiltInSubagentsEnabled: () => true,
    });
    const executions = await Promise.all(["first", "second"].map(description => controller.extensionRuntime.start({
      parentContext: parent.extensionRunner.createContext(), parentToolCallId: description, profile: "delegate",
      task: "Reply ok.", description, runInBackground: false,
    })));
    const results = await Promise.all(executions.map(execution => execution.completion));
    assert.ok(results.every(result => result.status === "completed"));
    assert.notEqual(children[0].modelRuntime, runtime);
    assert.notEqual(children[0].modelRuntime, children[1].modelRuntime);
    assert.equal(runtime.getRegisteredNativeProvider("openai-codex"), provider);
    assert.equal(manager.getEntries().length, count);
    for (const child of children) {
      const entries = child.sessionManager.getEntries();
      assert.deepEqual(child.getActiveToolNames(), ["read"]);
      assert.deepEqual(readSubagentSessionResources(entries).providerExtensions, [extension]);
      const record = entries.find(entry => entry.type === "custom" && entry.customType === "provider-response");
      assert.equal(record.data.owner, child.sessionId);
      assert.equal(record.data.requestSessionId, child.sessionId);
      const settings = entries.find(entry => entry.type === "custom" && entry.customType === "example:settings");
      assert.deepEqual(settings.data, { version: 1, sessionId: child.sessionId, values: { detail: "high" } });
    }
    children[0].dispose();
    await parent.prompt("parent continues");
    assert.equal(manager.getEntries().at(-1).message.stopReason, "stop");
    const replacement = join(dir, "replacement-provider.ts");
    const { readFile } = await import("node:fs/promises");
    await writeFile(replacement, await readFile(extension, "utf8"));
    await writeFile(join(dir, "settings.json"), JSON.stringify({ ...defaults, extensions: [replacement] }));
    await parent.reload({ beforeSessionStart: () => trackProviderExtensions(parent) });
    assert.deepEqual(requiredProviderExtensions(parent), [replacement]);
  } finally {
    for (const child of children) child.dispose(); parent?.dispose();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    assert.ok(dir.startsWith(join(tmpdir(), "pi-web-provider-isolation-")));
    await rm(dir, { recursive: true, force: true });
  }
});
