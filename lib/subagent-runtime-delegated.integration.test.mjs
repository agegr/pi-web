import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(), "pi-runtime-delegated-"));
const previous = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
process.env.HOME = join(root, "home");
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
await mkdir(process.env.HOME);
await mkdir(process.env.PI_CODING_AGENT_DIR);
const keepAlive = setInterval(() => {}, 1000);
after(async () => {
  clearInterval(keepAlive);
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(root, { recursive: true, force: true });
});
const sdk = await import("@earendil-works/pi-coding-agent");
const { fauxProvider } = await import("@earendil-works/pi-ai");
const jiti = createJiti(import.meta.url);
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { createSubagentController } = await jiti.import("./subagent-runtime.ts");
const { readSubagentSessionResources } = await jiti.import("./subagents.ts");

async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await delay(5);
  }
  throw Error("fixture timed out");
}

// Generic delegated lifecycle fixture: no optional host capabilities or transport harness.
async function fixture(t) {
  const dir = await mkdtemp(join(root, "case-"));
  const cwd = join(dir, "cwd"), agentDir = join(dir, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ cacheWarming: "off" }));
  const faux = fauxProvider({ models: [{ id: "child-faux" }] });
  const runtime = await sdk.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  t.after(() => runtime.dispose?.());
  return { cwd, agentDir, faux, runtime };
}

test("controller Stop then delegated resume issues a fresh real extension UI confirmation without rebinding", async (t) => {
  const f = await fixture(t), parentManager = sdk.SessionManager.inMemory(f.cwd);
  const extension = join(f.agentDir, "choose.ts");
  globalThis.__childUiConfirmed = 0;
  t.after(() => { delete globalThis.__childUiConfirmed; });
  await writeFile(extension, `export default function(pi) { pi.registerCommand('choose', { description:'Fixture', handler:async(_args,ctx)=>{ if(await ctx.ui.confirm('Choose','Continue?')) globalThis.__childUiConfirmed++; } }); }`);
  await mkdir(join(f.cwd, ".pi", "agents"), { recursive: true });
  await writeFile(join(f.cwd, ".pi", "agents", "ui-child.md"), `---\ntools: none\nextensions: [${JSON.stringify(extension)}]\n---\nFixture`);
  const parent = {
    cwd: f.cwd, sessionFile: join(f.cwd, "parent.jsonl"), isAlive: () => true,
    isRunning: () => false, waitUntilReady: async () => {},
    inner: { sessionManager: parentManager, modelRuntime: f.runtime, model: f.faux.getModel("child-faux"), agent: { state: {} } },
  };
  const wrappers = new Map([[parentManager.getSessionId(), parent]]), events = [];
  let binds = 0;
  const controller = createSubagentController({
    getSession: (id) => wrappers.get(id),
    registerSession(inner, options) {
      const bind = inner.bindExtensions.bind(inner);
      inner.bindExtensions = (...args) => { binds++; return bind(...args); };
      const wrapper = new AgentSessionWrapper(inner, {
        ...options, subagentResources: readSubagentSessionResources(inner.sessionManager.getEntries()),
      });
      wrappers.set(inner.sessionId, wrapper);
      wrapper.onEvent((event) => events.push(event));
      wrapper.beginExtensionBinding();
      t.after(() => wrapper.destroy());
      return wrapper.waitUntilReady();
    },
    reopenSession: async (id) => wrappers.get(id), resolveSessionPath: async () => null,
    invalidateSessionList: () => {}, isBuiltInSubagentsEnabled: () => true,
  });
  const request = { parentContext: parent.inner, parentToolCallId: "ui", profile: "ui-child", description: "UI", task: "/choose" };
  const first = await controller.extensionRuntime.start(request);
  await until(() => events.some((event) => event.method === "confirm"));
  let firstSettled = false;
  void first.completion.then(() => { firstSettled = true; });
  await delay(10);
  assert.equal(firstSettled, false, "delegated completion must await the outstanding UI response");
  const firstConfirmation = events.find((event) => event.method === "confirm");
  await controller.abort(first.run.sessionId);
  assert.equal((await first.completion).status, "aborted");
  const errorsBefore = events.filter((event) => event.type === "extension_error").length;
  const resumed = await controller.extensionRuntime.resume({ ...request, sessionId: first.run.sessionId });
  await until(() => events.filter((event) => event.method === "confirm").length === 2);
  const nextConfirmation = events.findLast((event) => event.method === "confirm");
  assert.notEqual(nextConfirmation.id, firstConfirmation.id);
  await wrappers.get(first.run.sessionId).send({ type: "extension_ui_response", id: nextConfirmation.id, confirmed: true });
  assert.equal((await resumed.completion).status, "completed");
  assert.equal(globalThis.__childUiConfirmed, 1);
  assert.equal(binds, 1);
  assert.equal(events.filter((event) => event.type === "extension_error").length, errorsBefore);
  assert.equal(f.faux.state.callCount, 0);
  t.diagnostic(JSON.stringify({ confirmationRequests: 2, confirmedResumed: 1, initialBinds: binds, resumeBinds: 0, providerRequests: 0 }));
});
