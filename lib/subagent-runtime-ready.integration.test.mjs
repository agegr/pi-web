import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const dir = await mkdtemp(join(tmpdir(), "pi-runtime-ready-"));
const oldHome = process.env.HOME, oldAgent = process.env.PI_CODING_AGENT_DIR;
process.env.HOME = join(dir, "home"); process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
await mkdir(process.env.HOME); await mkdir(process.env.PI_CODING_AGENT_DIR);
await mkdir(join(process.env.PI_CODING_AGENT_DIR, "agents"));
await writeFile(join(process.env.PI_CODING_AGENT_DIR, "agents", "settings.json"), JSON.stringify({ maxConcurrent: 1 }));
after(async () => {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgent;
  delete globalThis.__piRuntimeReadyFixture;
  await rm(dir, { recursive: true, force: true });
});
const { ModelRuntime, SessionManager } = await import("@earendil-works/pi-coding-agent");
const { fauxProvider, fauxAssistantMessage, fauxText, fauxToolCall } = await import("@earendil-works/pi-ai");
const jiti = createJiti(import.meta.url);
const { createSubagentController } = await jiti.import("./subagent-runtime.ts");
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { readSubagentSessionResources } = await jiti.import("./subagents.ts");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

async function fixture(t) {
  const cwd = await mkdtemp(join(dir, "cwd-"));
  const hooks = { gates: new Map(), prompts: 0, providers: 0, tools: 0, binds: 0 };
  globalThis.__piRuntimeReadyFixture = hooks;
  const extension = join(await mkdtemp(join(process.env.PI_CODING_AGENT_DIR, "extension-")), "fixture.ts");
  await writeFile(extension, `export default function(pi) {
    pi.registerTool({name:'mock_probe',label:'Probe',description:'Fixture only',parameters:{type:'object',properties:{}},execute:async()=>{
      globalThis.__piRuntimeReadyFixture.tools++; return {content:[],details:undefined};
    }});
    pi.on('session_start',async (_event,ctx)=>{
      const gate=globalThis.__piRuntimeReadyFixture.gates.get(ctx.sessionManager.getSessionId());
      if(gate) { gate.entered.resolve(); await gate.promise; }
    });
  }`);
  await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
  await writeFile(join(cwd, ".pi", "agents", "ready.md"), `---\ntools: read, ext:fixture\nextensions: [${JSON.stringify(extension)}]\n---\nFixture.`);
  const faux = fauxProvider({ models: [{ id: "ready-faux" }] });
  const runtime = await ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  const response = () => { hooks.providers++; return fauxAssistantMessage([fauxText("fixture done")]); };
  faux.setResponses(Array.from({ length: 20 }, () => response));
  const manager = SessionManager.inMemory(cwd);
  const parent = {
    cwd, sessionFile: join(cwd, "parent.jsonl"), isAlive: () => true, isRunning: () => false,
    waitUntilReady: async () => {},
    inner: { sessionManager: manager, modelRuntime: runtime, model: faux.getModel("ready-faux"), agent: { state: {} } },
  };
  const wrappers = new Map([[manager.getSessionId(), parent]]);
  const plans = [];
  const controller = createSubagentController({
    getSession: (id) => wrappers.get(id),
    registerSession(inner) {
      const plan = plans.shift() ?? {};
      if (plan.binding) hooks.gates.set(inner.sessionId, plan.binding);
      const originalPrompt = inner.prompt.bind(inner), originalBind = inner.bindExtensions.bind(inner);
      inner.prompt = async (...args) => {
        hooks.prompts++;
        await originalPrompt(...args);
        if (plan.rejectAfterPrompt) throw Error("fixture prompt rejected after turn-limit abort");
      };
      inner.bindExtensions = (...args) => { hooks.binds++; return originalBind(...args); };
      const wrapper = new AgentSessionWrapper(inner, { subagentResources: readSubagentSessionResources(inner.sessionManager.getEntries()) });
      wrappers.set(inner.sessionId, wrapper);
      wrapper.beginExtensionBinding();
      // One registration boundary and the same wrapper's bind boundary, never a second bind.
      return plan.voidRegistration ? undefined : plan.registration ?? Promise.resolve();
    },
    reopenSession: async (id) => wrappers.get(id), resolveSessionPath: async () => null,
    invalidateSessionList: () => {}, isBuiltInSubagentsEnabled: () => true,
  });
  t.after(async () => {
    for (const [id, wrapper] of wrappers) if (id !== manager.getSessionId()) await wrapper.destroy();
    runtime.dispose?.();
  });
  const request = { parentContext: parent.inner, parentToolCallId: "call", profile: "ready", task: "Fixture", description: "Fixture" };
  return { controller, hooks, plans, request, wrappers, faux };
}

for (const phase of ["registration", "binding", "resume"]) {
  for (const cancel of ["parent", "Stop"]) {
    test(`${phase}: ${cancel} while waiting ready prevents every prompt/provider/tool; next run works`, async (t) => {
      const f = await fixture(t), gate = deferred(), signal = new AbortController();
      let execution;
      if (phase === "resume") {
        const first = await f.controller.extensionRuntime.start(f.request);
        assert.equal((await first.completion).status, "completed");
        f.hooks.prompts = 0; f.hooks.providers = 0;
        const wrapper = f.wrappers.get(first.run.sessionId);
        const ready = wrapper.waitUntilReady.bind(wrapper);
        const entered = deferred();
        wrapper.waitUntilReady = async () => { await ready(); entered.resolve(); await gate.promise; };
        execution = await f.controller.extensionRuntime.resume({ ...f.request, sessionId: first.run.sessionId, signal: signal.signal });
        await entered.promise;
      } else {
        if (phase === "registration") f.plans.push({ registration: gate.promise });
        else { gate.entered = deferred(); f.plans.push({ binding: gate }); }
        execution = await f.controller.extensionRuntime.start({ ...f.request, signal: signal.signal });
        if (phase === "binding") await gate.entered.promise;
      }
      assert.equal((await f.controller.get(execution.run.sessionId)).status, "running");
      assert.equal(f.wrappers.get(execution.run.sessionId).isRunning(), false, "SDK remains idle during ready");
      if (cancel === "parent") signal.abort(); else await f.controller.abort(execution.run.sessionId);
      gate.resolve();
      const result = await execution.completion;
      assert.equal(result.status, "aborted"); assert.equal(result.error, undefined);
      assert.equal(f.hooks.prompts, 0); assert.equal(f.hooks.providers, 0); assert.equal(f.hooks.tools, 0);
      const entries = f.wrappers.get(result.sessionId).inner.sessionManager.getEntries();
      assert.equal(entries.at(-1).data.status, "aborted");
      assert.equal((await f.controller.get(result.sessionId)).status, "aborted");
      const next = await f.controller.extensionRuntime.start(f.request);
      assert.equal((await next.completion).status, "completed");
      assert.equal(f.hooks.prompts, 1); assert.equal(f.hooks.providers, 1);
      assert.equal(f.hooks.binds, 2, "one bind per created child, resume does not bind again");
    });
  }
}

test("queued registration rejects immediately without unhandled rejection, fails on dequeue; cancelled rejection and next run are safe", async (t) => {
  const f = await fixture(t), firstGate = deferred(), unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  t.after(() => process.removeListener("unhandledRejection", onUnhandled));
  f.plans.push({ registration: firstGate.promise });
  const first = await f.controller.extensionRuntime.start(f.request);
  const states = [];
  // The rejection originates at registration, not after the job is dequeued.
  // Produce it inside registerSession so no fixture-owned naked rejection exists.
  f.plans.push({ get registration() { return Promise.reject(Error("registration failed")); } });
  const failed = await f.controller.extensionRuntime.start({ ...f.request, onUpdate: (run) => states.push(run.status) });
  assert.equal(failed.run.status, "queued");
  f.plans.push({ get registration() { return Promise.reject(Error("cancelled registration failed")); } });
  const cancelled = await f.controller.extensionRuntime.start(f.request);
  await f.controller.abort(cancelled.run.sessionId);
  assert.equal((await cancelled.completion).status, "aborted");
  const next = await f.controller.extensionRuntime.start(f.request);
  await tick(); assert.deepEqual(unhandled, []); assert.equal(f.hooks.prompts, 0);
  firstGate.resolve(); assert.equal((await first.completion).status, "completed");
  const failure = await failed.completion;
  assert.equal(failure.status, "failed"); assert.match(failure.error, /registration failed/);
  assert.ok(states.includes("queued")); assert.ok(states.includes("failed"));
  assert.equal((await f.controller.get(failure.sessionId)).status, "failed");
  assert.equal(f.wrappers.get(failure.sessionId).inner.sessionManager.getEntries().at(-1).data.status, "failed");
  assert.equal((await next.completion).status, "completed");
  await tick(); assert.deepEqual(unhandled, []);
  assert.equal(f.hooks.prompts, 2); assert.equal(f.hooks.providers, 2); assert.equal(f.hooks.tools, 0); assert.equal(f.hooks.binds, 4);
  t.diagnostic(JSON.stringify({ unhandledRejection: 0, failedAndCancelledPrompts: 0, nextWorks: true, externalProviderRequests: 0, browserStarts: 0, mcpStarts: 0 }));
});

for (const mode of ["create", "resume"]) {
  for (const runInBackground of [false, true]) {
    test(`${mode}: pre-listener onUpdate abort ${runInBackground ? "preserves background queue" : "settles queued foreground before first ready"}`, async (t) => {
      const f = await fixture(t), signal = new AbortController(), gate = deferred();
      let resumedId;
      if (mode === "resume") {
        const seed = await f.controller.extensionRuntime.start(f.request);
        assert.equal((await seed.completion).status, "completed");
        resumedId = seed.run.sessionId;
        f.hooks.prompts = 0; f.hooks.providers = 0;
      }
      gate.entered = deferred(); f.plans.push({ binding: gate });
      const first = await f.controller.extensionRuntime.start(f.request);
      let firstSettled = false;
      void first.completion.then(() => { firstSettled = true; });
      try {
        await gate.entered.promise;
        const firstBefore = await f.controller.get(first.run.sessionId);
        const states = [];
        const request = {
          ...f.request, signal: signal.signal, runInBackground,
          onUpdate(run) {
            states.push(run.status);
            // Only the initial queued update: abort before listener installation.
            if (states.length === 1) { assert.equal(run.status, "queued"); signal.abort(); }
          },
        };
        const second = mode === "create"
          ? await f.controller.extensionRuntime.start(request)
          : await f.controller.extensionRuntime.resume({ ...request, sessionId: resumedId });
        let secondSettled = false;
        void second.completion.then(() => { secondSettled = true; });
        assert.equal(signal.signal.aborted, true);
        if (runInBackground) {
          await tick();
          assert.equal(secondSettled, false);
          assert.equal((await f.controller.get(second.run.sessionId)).status, "queued");
        } else {
          let timeout;
          const result = await Promise.race([
            second.completion,
            new Promise((_, reject) => { timeout = setTimeout(() => reject(Error("queued cancellation waited for first ready")), 500); }),
          ]).finally(() => clearTimeout(timeout));
          assert.equal(result.status, "aborted"); assert.equal(result.error, undefined);
          assert.equal((await f.controller.get(result.sessionId)).status, "aborted");
          assert.equal(f.wrappers.get(result.sessionId).inner.sessionManager.getEntries().at(-1).data.status, "aborted");
          assert.ok(!states.includes("running")); assert.equal(states.at(-1), "aborted");
        }
        // The cancellation must not release, finish or alter the earlier running slot.
        assert.equal(firstSettled, false);
        assert.deepEqual(await f.controller.get(first.run.sessionId), firstBefore);
        assert.equal(f.hooks.prompts, 0); assert.equal(f.hooks.providers, 0); assert.equal(f.hooks.tools, 0);
        gate.resolve(); assert.equal((await first.completion).status, "completed");
        assert.equal((await second.completion).status, runInBackground ? "completed" : "aborted");
        assert.equal(f.hooks.prompts, runInBackground ? 2 : 1);
        assert.equal(f.hooks.providers, runInBackground ? 2 : 1);
        t.diagnostic(JSON.stringify({ mode, runInBackground, foregroundCancelledBeforeFirstReady: !runInBackground, promptsBeforeFirstReady: 0, externalProviderRequests: 0 }));
      } finally {
        // Release the real binding before fixture wrapper cleanup, even on regression failure.
        gate.resolve(); await first.completion;
      }
    });
  }
}

test("an already cancelled foreground request cannot prompt", async (t) => {
  const f = await fixture(t), signal = new AbortController(); signal.abort();
  const execution = await f.controller.extensionRuntime.start({ ...f.request, signal: signal.signal });
  assert.equal((await execution.completion).status, "aborted"); assert.equal(f.hooks.prompts, 0); assert.equal(f.hooks.providers, 0);
});

test("background ready wait ignores parent cancellation and supports void registration", async (t) => {
  const f = await fixture(t), signal = new AbortController(), gate = deferred();
  gate.entered = deferred(); f.plans.push({ binding: gate, voidRegistration: true });
  const execution = await f.controller.extensionRuntime.start({ ...f.request, runInBackground: true, signal: signal.signal });
  await gate.entered.promise; signal.abort(); gate.resolve();
  assert.equal((await execution.completion).status, "completed");
  assert.equal(f.hooks.prompts, 1); assert.equal(f.hooks.providers, 1); assert.equal(f.hooks.binds, 1);
});

test("maxTurnsReached prompt rejection still completes rather than becoming a cancellation", async (t) => {
  const f = await fixture(t);
  f.plans.push({ rejectAfterPrompt: true });
  f.faux.setResponses(Array.from({ length: 4 }, () => () => fauxAssistantMessage([fauxToolCall("mock_probe", {})], { stopReason: "toolUse" })));
  const execution = await f.controller.extensionRuntime.start({ ...f.request, maxTurns: 1 });
  const result = await execution.completion;
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(f.hooks.prompts, 1); assert.equal(f.hooks.tools, 2);
});
