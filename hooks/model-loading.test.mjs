import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const { resolveThinkingPreference } = await createJiti(import.meta.url).import("../lib/thinking-level-preference.ts");

const source = ts.createSourceFile(
  "useAgentSession.ts",
  await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const nodes = [];
function visit(node) {
  nodes.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
const loader = nodes.find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === "loadModels");
const schedule = nodes.find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === "MODELS_RETRY_DELAYS_MS");
const effect = nodes.find((node) => ts.isCallExpression(node)
  && node.expression.getText(source) === "useEffect"
  && node.arguments[1]?.getText(source) === "[loadModels, modelsRefreshKey]");
const retry = effect.arguments[0].body.statements.find(ts.isExpressionStatement).expression;
function script(text) {
  return new Script(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText);
}
const applyThinking = nodes.find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === "applyNewSessionThinking");
const applyScript = script(`(${applyThinking.initializer.arguments[0].getText(source)})`);
const changeThinking = nodes.find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === "handleThinkingLevelChange");
const changeScript = script(`(${changeThinking.initializer.arguments[0].getText(source)})`);
const loadScript = script(`(${loader.initializer.arguments[0].getText(source)})`);
const retryScript = script(retry.getText(source));

function setup(fetchImpl) {
  const writes = [];
  const delays = [];
  const context = {
    Error, DOMException,
    controller: new AbortController(),
    newSessionCwd: "/project", session: null, isNew: true,
    sessionIdRef: { current: null }, thinkingLevelOverrideRef: { current: null },
    modelsRequestIdRef: { current: 0 },
    modelsResponseRef: { current: null }, newSessionModelOverrideRef: { current: null },
    explicitThinkingSelectionRef: { current: null }, ensuringNewSessionRef: { current: null },
    preferred: null, resolveThinkingPreference,
    fetch: fetchImpl,
    MODELS_RETRY_DELAYS_MS: script(schedule.initializer.getText(source)).runInNewContext(),
    delay: async (ms) => { delays.push(ms); },
  };
  for (const name of ["ModelError", "ModelNames", "ModelScopeWarnings", "ModelThinkingLevels", "ModelThinkingLevelMaps", "ModelList", "NewSessionDefaultModel", "ThinkingLevel"]) {
    context[`set${name}`] = (value) => writes.push([name, value]);
  }
  context.getPreferredThinkingLevel = () => context.preferred;
  context.setPreferredThinkingLevel = (value) => { context.preferred = value; };
  context.applyNewSessionThinking = applyScript.runInNewContext(context);
  context.changeThinking = changeScript.runInNewContext(context);
  context.loadModels = loadScript.runInNewContext(context);
  return { context, writes, delays, run: () => retryScript.runInNewContext(context) };
}

test("model-load failures stay visible through bounded retries and clear on recovery", async () => {
  for (const [fetchImpl, expected] of [
    [async () => { throw new TypeError("Failed to fetch"); }, "Failed to fetch"],
    [async () => Response.json({ error: "Access denied" }, { status: 403 }), "Access denied"],
    [async () => new Response("Unavailable", { status: 503 }), "Failed to load models (HTTP 503)"],
    [async () => ({ ok: true, json: async () => { throw new SyntaxError("Invalid JSON"); } }), "Invalid JSON"],
  ]) {
    const state = setup(fetchImpl);
    await state.run();
    assert.deepEqual(state.delays, [2_000, 5_000, 10_000]);
    assert.deepEqual(state.writes, Array.from({ length: 4 }, () => ["ModelError", expected]));
  }

  let attempts = 0;
  const recovered = setup(async () => {
    if (++attempts === 1) throw new TypeError("Failed to fetch");
    return Response.json({
      models: { "custom:test": "Test" },
      modelList: [{ provider: "custom", id: "test", name: "Test" }],
      defaultModel: { provider: "custom", modelId: "test" },
      thinkingLevelPins: { "custom/test": "high" },
    });
  });
  await recovered.run();
  assert.equal(attempts, 2);
  assert.deepEqual(recovered.delays, [2_000]);
  assert.deepEqual(recovered.writes.filter(([name]) => name === "ModelError"), [["ModelError", "Failed to fetch"], ["ModelError", null]]);
  assert.ok(recovered.writes.some(([name, value]) => name === "ModelList" && value[0].id === "test"));
  assert.ok(recovered.writes.some(([name, value]) => name === "NewSessionDefaultModel" && value.modelId === "test"));
  assert.ok(recovered.writes.some(([name, value]) => name === "ThinkingLevel" && value === "high"));
});

test("cancelling model loads prevents state writes and further retries", async () => {
  for (const status of [200, 403]) {
    const reading = Promise.withResolvers();
    const state = setup(async (_url, { signal }) => ({
      ok: status === 200, status,
      json: () => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        reading.resolve();
      }),
    }));
    const completed = state.run();
    await reading.promise;
    state.context.controller.abort();
    await completed;
    assert.deepEqual(state.writes, []);
    assert.deepEqual(state.delays, []);
  }

  const late = setup(async (_url, { signal }) => ({
    ok: true,
    json: async () => {
      late.context.controller.abort();
      assert.equal(signal.aborted, true);
      return { models: {}, modelList: [] };
    },
  }));
  await late.run();
  assert.deepEqual(late.writes, []);

  let attempts = 0;
  const waiting = setup(async () => { attempts++; throw new TypeError("Failed to fetch"); });
  waiting.context.delay = async () => waiting.context.controller.abort();
  await waiting.run();
  assert.equal(attempts, 1);
});

test("a late model response cannot overwrite a newer model list", async () => {
  const first = Promise.withResolvers();
  let calls = 0;
  const state = setup(async () => ++calls === 1 ? first.promise : Response.json({
    models: {}, modelList: [{ provider: "test", id: "new" }], defaultModel: { provider: "test", modelId: "new" },
  }));
  const oldLoad = state.context.loadModels();
  await state.context.loadModels();
  first.resolve(Response.json({ models: {}, modelList: [{ provider: "test", id: "old" }], defaultModel: { provider: "test", modelId: "old" } }));
  await oldLoad;
  assert.equal(state.context.modelsResponseRef.current.defaultModel.modelId, "new");
  assert.equal(state.writes.some(([name, value]) => name === "NewSessionDefaultModel" && value?.modelId === "old"), false);
});

const modelData = {
  models: { "openai-codex:gpt-6-astra": "Astra" },
  modelList: [{ provider: "openai-codex", id: "gpt-6-astra" }],
  defaultModel: { provider: "openai-codex", modelId: "gpt-6-astra" },
  thinkingLevels: { "openai-codex:gpt-6-astra": ["low", "high", "max"] },
};

test("a remembered selection survives a new composer before sending", async () => {
  const first = setup(async () => Response.json(modelData));
  first.context.preferred = "high";
  await first.run();
  assert.ok(first.writes.some(([key, value]) => key === "ThinkingLevel" && value === "high"));
  assert.equal(first.context.thinkingLevelOverrideRef.current, "high");

  await first.context.changeThinking("high");
  const next = setup(async () => Response.json(modelData));
  next.context.preferred = first.context.preferred;
  await next.run();
  assert.equal(next.context.thinkingLevelOverrideRef.current, "high");

  await next.context.changeThinking("auto");
  await next.run();
  assert.equal(next.writes.filter(([key]) => key === "ThinkingLevel").at(-1)[1], "auto");
  assert.equal(next.context.thinkingLevelOverrideRef.current, null);
});

test("late model data respects a new explicit selection and existing session state", async () => {
  const pending = Promise.withResolvers();
  const current = setup(async () => {
    await pending.promise;
    return Response.json(modelData);
  });
  const loading = current.run();
  await current.context.changeThinking("max");
  pending.resolve();
  await loading;
  assert.equal(current.context.thinkingLevelOverrideRef.current, "max");

  for (const oldLevel of ["low", "off"]) {
    const existing = setup(async () => Response.json(modelData));
    existing.context.isNew = false;
    existing.context.sessionIdRef.current = "existing";
    existing.context.preferred = "high";
    existing.context.setThinkingLevel(oldLevel);
    await existing.run();
    assert.deepEqual(existing.writes.filter(([key]) => key === "ThinkingLevel"), [["ThinkingLevel", oldLevel]]);
  }
});

test("a selected new-session model controls compatibility when model loading finishes late", async () => {
  const state = setup(async () => Response.json({
    ...modelData,
    thinkingLevels: { ...modelData.thinkingLevels, "other:small": ["off"] },
  }));
  state.context.preferred = "high";
  state.context.newSessionModelOverrideRef.current = { provider: "other", modelId: "small" };
  await state.run();
  assert.equal(state.writes.filter(([key]) => key === "ThinkingLevel").at(-1)[1], "auto");
  assert.equal(state.context.thinkingLevelOverrideRef.current, null);
  assert.equal(state.context.preferred, "high");
});

test("quick session creation sends remembered thinking before model capabilities finish loading", async () => {
  const pending = Promise.withResolvers();
  const posted = [];
  const state = setup(async (url, options) => {
    if (url === "/api/agent/new") {
      posted.push(JSON.parse(options.body));
      return Response.json({ sessionId: "new-session", thinkingLevel: "low" });
    }
    await pending.promise;
    return Response.json(modelData);
  });
  state.context.preferred = "low";
  state.context.thinkingLevelOverrideRef.current = "low";
  state.context.toolPreset = "default";
  state.context.getToolNamesForPreset = () => [];
  state.context.setPendingModel = () => {};
  const ensure = nodes.find((node) => ts.isVariableDeclaration(node)
    && node.name.getText(source) === "ensureNewSession");
  const create = script(`(${ensure.initializer.arguments[0].getText(source)})`).runInNewContext(state.context);

  const loading = state.run();
  const creating = create();
  await Promise.resolve();
  assert.equal(await creating, "new-session");
  assert.equal(posted.length, 1);
  assert.equal(posted[0].thinkingLevel, "low");
  pending.resolve();
  await loading;
});

test("a safe model-catalog failure does not erase a remembered selection", async () => {
  const state = setup(async () => Response.json({
    models: {},
    modelList: [],
    defaultModel: null,
    modelError: "Unavailable",
  }));
  state.context.preferred = "high";
  state.context.thinkingLevelOverrideRef.current = "high";
  await state.run();
  assert.equal(state.context.modelsResponseRef.current, null);
  assert.equal(state.context.thinkingLevelOverrideRef.current, "high");
  assert.equal(state.writes.some(([key]) => key === "ThinkingLevel"), false);
});
