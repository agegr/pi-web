import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const { createSubagentController, hasUnsettledSubagentRun } = await createJiti(import.meta.url).import("./subagent-runtime.ts");
const answer = (text) => fauxAssistantMessage([fauxText(text)]);
const terminal = (run) => ["completed", "aborted", "failed"].includes(run.status);

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-runtime-settlement-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const keys = ["__piSubagentRuns", "__piSubagentQueue", "__piSubagentConsumedResults", "__piSubagentFamilyTracking"];
  const previous = keys.map((key) => globalThis[key]);
  for (const key of keys) delete globalThis[key];
  const sessions = new Map();
  const completions = [];
  const gates = [];
  const logs = [];
  const rechecks = [];
  t.mock.method(console, "error", (...args) => logs.push(args.join(" ")));
  const gate = () => { const value = Promise.withResolvers(); gates.push(value); return value; };
  t.after(async () => {
    for (const value of gates) value.resolve();
    await Promise.allSettled(completions);
    for (const wrapper of sessions.values()) wrapper.inner.dispose();
    for (let i = 0; i < keys.length; i++) {
      if (previous[i] === undefined) delete globalThis[keys[i]];
      else globalThis[keys[i]] = previous[i];
    }
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(join(dir, "agents"));
  await writeFile(join(dir, "agents", "settings.json"), JSON.stringify({ maxConcurrent: 1 }));
  await writeFile(join(dir, "agents", "fixture.md"), [
    "---", "description: Synthetic settlement fixture.", "tools: none", "load_skills: false", "load_extensions: false",
    "codemode: off", "mcp: off", "---", "Return a synthetic result.",
  ].join("\n"));
  const faux = fauxProvider({ models: [{ id: "settlement-fixture" }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const services = await createAgentSessionServices({
    cwd: dir, agentDir: dir, modelRuntime, settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true },
  });
  const { session: parent } = await createAgentSessionFromServices({
    services, sessionManager: SessionManager.create(dir, join(dir, "sessions")), model: faux.getModel("settlement-fixture"),
  });
  let nextFault;
  function registerSession(inner) {
    const wrapper = {
      inner, cwd: dir, sessionFile: inner.sessionFile, isAlive: () => true,
      isRunning: () => inner.isStreaming, waitUntilReady: async () => {}, fault: nextFault,
    };
    const append = inner.sessionManager.appendCustomEntry.bind(inner.sessionManager);
    inner.sessionManager.appendCustomEntry = (type, data) => {
      if (wrapper.fault === "persistence" && type === "pi-web:subagent-result") throw new Error("injected result persistence failure");
      if (wrapper.fault === "execute" && type === "pi-web:subagent-status" && data.status === "running") throw new Error("injected execute rejection");
      if (wrapper.fault === "queued" && type === "pi-web:subagent-status" && data.status === "queued") throw new Error("injected queued status failure");
      return append(type, data);
    };
    sessions.set(inner.sessionId, wrapper);
    return wrapper;
  }
  const root = registerSession(parent);
  root.inner.sendCustomMessage = async () => {};
  const controller = createSubagentController({
    getSession: (id) => sessions.get(id), registerSession,
    reopenSession: async () => { throw new Error("fixture never reopens a production session"); },
    resolveSessionPath: async (id) => sessions.get(id)?.sessionFile ?? null,
    invalidateSessionList() { if (nextFault === "dispatch") throw new Error("injected dispatch failure"); },
    isBuiltInSubagentsEnabled: () => true,
    onFamilySettled: (id, options) => rechecks.push({ id, options, unsettled: hasUnsettledSubagentRun(id) }),
  });
  async function launch(mode, { background = false, target, fault, onUpdate, signal } = {}) {
    nextFault = fault;
    if (target) sessions.get(target).fault = fault;
    const request = {
      parentContext: parent, parentToolCallId: `call-${completions.length}`, task: "synthetic work", description: "fixture",
      runInBackground: background, onUpdate, signal,
    };
    const execution = mode === "start"
      ? await controller.extensionRuntime.start({ ...request, profile: "fixture" })
      : await controller.extensionRuntime.resume({ ...request, sessionId: target });
    nextFault = undefined;
    completions.push(execution.completion);
    return execution;
  }
  async function bootstrap(mode) {
    if (mode === "start") return undefined;
    faux.setResponses([answer("bootstrap")]);
    const execution = await launch("start");
    await execution.completion;
    return execution.run.sessionId;
  }
  function holdModel() {
    const entered = gate();
    const release = gate();
    faux.setResponses([async () => { entered.resolve(); await release.promise; return answer("partial result"); }]);
    return { entered, release };
  }
  return { root, sessions, controller, launch, bootstrap, holdModel, gate, logs, rechecks };
}

async function assertReleased(h, execution, token, background) {
  const result = await execution.completion;
  const state = globalThis.__piSubagentFamilyTracking;
  assert.equal(globalThis.__piSubagentRuns.has(result.sessionId), false);
  assert.equal(state.results.get(result), token, "the actual result must be associated with the original dispatch token");
  if (background) {
    assert.equal(state.active.has(token), true);
    assert.equal(state.active.size, 1, "no replacement token may be created");
    const entered = h.gate();
    const finalReply = h.gate();
    h.root.inner.sendCustomMessage = async () => { entered.resolve(); await finalReply.promise; };
    const notifying = h.controller.extensionRuntime.notifyParent(result);
    await entered.promise;
    assert.equal(state.active.size, 1);
    assert.equal(state.active.has(token), true);
    assert.equal(hasUnsettledSubagentRun(h.root.inner.sessionId), true);
    finalReply.resolve();
    await notifying;
  }
  assert.equal(state.active.has(token), false);
  assert.equal(state.active.size, 0);
  assert.equal(hasUnsettledSubagentRun(h.root.inner.sessionId), false);
  assert.equal(h.rechecks.at(-1).unsettled, false);
  return result;
}

for (const mode of ["start", "resume"]) {
  for (const queuedAbort of [false, true]) {
    for (const background of [false, true]) {
      for (const fault of ["persistence", "terminal observer"]) {
        test(`${mode}: ${queuedAbort ? "queued abort" : "normal end"}, ${background ? "background" : "foreground"}, ${fault}`, { timeout: 10_000 }, async (t) => {
          const h = await fixture(t);
          const target = await h.bootstrap(mode);
          const model = h.holdModel();
          const blocker = queuedAbort ? await h.launch("start") : undefined;
          if (blocker) await model.entered.promise;
          const execution = await h.launch(mode, {
            background, target, fault: fault === "persistence" ? "persistence" : undefined,
            onUpdate: (run) => { if (fault === "terminal observer" && terminal(run)) throw new Error("injected terminal observer failure"); },
          });
          const state = globalThis.__piSubagentFamilyTracking;
          const token = [...state.active].find((item) => item.relation.sessionId === execution.run.sessionId);
          if (queuedAbort) {
            assert.equal(execution.run.status, "queued");
            await h.controller.abort(execution.run.sessionId);
          } else {
            await model.entered.promise;
          }
          model.release.resolve();
          if (blocker) await blocker.completion;
          const result = await assertReleased(h, execution, token, background);
          assert.equal(result.status, fault === "persistence" ? "failed" : queuedAbort ? "aborted" : "completed");
          if (fault === "persistence") assert.match(result.error, /injected result persistence failure/);
          assert.ok(h.logs.some((line) => line.includes(fault === "persistence" ? "injected result persistence failure" : "injected terminal observer failure")));
        });
      }
    }
  }

  test(`${mode}: abort before execute still finalizes a persistence failure on the original token`, { timeout: 10_000 }, async (t) => {
    const h = await fixture(t);
    const target = await h.bootstrap(mode);
    const stop = new AbortController();
    let token;
    const execution = await h.launch(mode, { target, fault: "persistence", signal: stop.signal, onUpdate: (run) => {
      token ??= globalThis.__piSubagentFamilyTracking.results.get(run);
      if (run.status === "running") stop.abort();
      if (terminal(run)) throw new Error("injected terminal observer after persistence failure");
    } });
    const result = await assertReleased(h, execution, token, false);
    assert.equal(result.status, "failed");
    assert.match(result.error, /injected result persistence failure/);
    assert.ok(h.logs.some((line) => line.includes("injected terminal observer after persistence failure")));
  });

  for (const phase of ["initial", "queued", "running"]) {
    test(`${mode}: ${phase} onUpdate exceptions do not prevent dispatch or completion handoff`, { timeout: 10_000 }, async (t) => {
      const h = await fixture(t);
      const target = await h.bootstrap(mode);
      const model = h.holdModel();
      let queuedUpdates = 0;
      let injected = 0;
      const execution = await h.launch(mode, { background: true, target, onUpdate: (run) => {
        if (run.status === "queued") queuedUpdates++;
        if ((phase === "initial" && run.status === "queued" && queuedUpdates === 1)
          || (phase === "queued" && run.status === "queued" && queuedUpdates === 2)
          || (phase === "running" && run.status === "running")) {
          injected++;
          throw new Error(`injected ${phase} observer failure`);
        }
      } });
      await model.entered.promise;
      const token = [...globalThis.__piSubagentFamilyTracking.active][0];
      model.release.resolve();
      const result = await assertReleased(h, execution, token, true);
      assert.equal(result.status, "completed");
      assert.ok(injected > 0);
      assert.ok(h.logs.some((line) => line.includes(`injected ${phase} observer failure`)));
    });
  }

  test(`${mode}: queue execute rejection settles the original token with the failed result`, { timeout: 10_000 }, async (t) => {
    const h = await fixture(t);
    const target = await h.bootstrap(mode);
    let token;
    const execution = await h.launch(mode, { background: true, target, fault: "execute", onUpdate: (run) => {
      token ??= globalThis.__piSubagentFamilyTracking.results.get(run);
    } });
    assert.ok(token, "capture the original token before queue execution rejects");
    const result = await assertReleased(h, execution, token, true);
    assert.equal(result.status, "failed");
    assert.match(result.error, /injected execute rejection/);
  });

  test(`${mode}: a rejected queued status cannot leave an executable orphan or mute the parent`, { timeout: 10_000 }, async (t) => {
    const h = await fixture(t);
    const target = await h.bootstrap(mode);
    const previousIds = new Set(h.sessions.keys());
    await assert.rejects(h.launch(mode, { background: true, target, fault: "queued" }), /injected queued status failure/);
    assert.equal(globalThis.__piSubagentRuns.size, 0);
    assert.equal(globalThis.__piSubagentFamilyTracking.active.size, 0);
    assert.equal(h.rechecks.at(-1).options, undefined, "the parent tool receives the dispatch error");
    const failed = h.sessions.get(target ?? [...h.sessions.keys()].find((id) => !previousIds.has(id)));
    let orphanPrompts = 0;
    failed.inner.prompt = async () => { orphanPrompts++; };
    const held = h.holdModel();
    const next = await h.launch("start");
    await held.entered.promise;
    held.release.resolve();
    await next.completion;
    assert.equal(orphanPrompts, 0, "a later dispatch must never start the rejected work");
    assert.equal(hasUnsettledSubagentRun(h.root.inner.sessionId), false);
  });

  test(`${mode}: failed dispatch without a completion handoff abandons its token`, { timeout: 10_000 }, async (t) => {
    const h = await fixture(t);
    const target = await h.bootstrap(mode);
    await assert.rejects(h.launch(mode, { background: true, target, fault: "dispatch" }), /injected dispatch failure/);
    assert.equal(globalThis.__piSubagentRuns.size, 0);
    assert.equal(globalThis.__piSubagentFamilyTracking.active.size, 0);
    assert.equal(hasUnsettledSubagentRun(h.root.inner.sessionId), false);
    assert.equal(h.rechecks.at(-1).options, undefined, "dispatch error returned to the parent tool is not a lost background report");
  });
}
