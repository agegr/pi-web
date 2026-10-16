import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { startRpcSession } = await jiti.import("./rpc-manager.ts");
const { writeModelsConfig } = await jiti.import("./models-config-store.ts");
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-model-reload-"));
  const cwd = join(dir, "project");
  await mkdir(cwd);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  // No real credentials, extensions, catalog fetches or model requests.
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); });
  const config = { providers: { synthetic: {
    baseUrl: "https://synthetic.invalid", api: "anthropic-messages", apiKey: "synthetic-not-a-key",
    models: [
      { id: "primary", reasoning: true, contextWindow: 32000, maxTokens: 1024 },
      { id: "sibling", reasoning: false },
    ],
  } } };
  const modelsPath = join(dir, "models.json");
  const save = () => writeModelsConfig(config, modelsPath);
  save();
  const settingsPath = join(dir, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ defaultThinkingLevel: "low", retry: { enabled: false }, compaction: { enabled: false } }));
  const { session: wrapper } = await startRpcSession(`__new__${dir}`, "", cwd, {
    toolNames: [], initialModel: { provider: "synthetic", modelId: "primary" }, thinkingLevel: "high",
  });
  t.after(() => wrapper.shutdown());
  const settingsBefore = await readFile(settingsPath, "utf8");
  return { wrapper, config, save, modelsPath, settingsPath, settingsBefore };
}

for (const command of ["set_model", "reload"]) {
  test(`${command} applies same-id protocol, endpoint and context edits without replacing the session or its thinking choice`, async (t) => {
    const f = await fixture(t);
    const { inner } = f.wrapper;
    const id = inner.sessionId;
    const manager = inner.sessionManager;
    const original = inner.model;
    Object.assign(f.config.providers.synthetic.models[0], {
      api: "openai-responses", baseUrl: "https://synthetic.invalid/v1", contextWindow: 64000,
    });
    f.save();
    assert.equal(inner.model.api, "anthropic-messages", "Saving must not mutate a live session");
    await f.wrapper.send({ type: command, provider: "synthetic", modelId: "primary" });
    assert.equal(inner.model.api, "openai-responses");
    assert.equal(inner.model.baseUrl, "https://synthetic.invalid/v1");
    assert.equal(inner.model.contextWindow, 64000);
    assert.equal(inner.thinkingLevel, "high", "An endpoint edit must not restore defaultThinkingLevel=low");
    assert.equal(inner.sessionId, id);
    assert.ok(inner.sessionManager === manager, "No session replacement or history rewrite");
    assert.equal(original.api, "anthropic-messages", "Already captured model definitions stay unchanged");
    assert.equal(inner.modelRuntime.getModel("synthetic", "sibling").baseUrl, "https://synthetic.invalid");
    assert.equal(inner.modelRuntime.getModel("synthetic", "sibling").api, "anthropic-messages");
    assert.equal(await readFile(f.settingsPath, "utf8"), f.settingsBefore);

    const requests = [];
    t.mock.method(globalThis, "fetch", async (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      assert.equal(url.hostname, "synthetic.invalid");
      requests.push(url.pathname);
      return new Response(JSON.stringify({ error: { message: "Offline interception", type: "fixture" } }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    });
    await inner.prompt("Synthetic request, intercepted locally.");
    assert.deepEqual(requests, ["/v1/responses"], "The actual SDK request uses the new route");
    assert.equal(inner.messages.at(-1).api, "openai-responses");
  });
}

test("clearing a model endpoint restores provider inheritance and still clamps unsupported thinking", async (t) => {
  const f = await fixture(t);
  Object.assign(f.config.providers.synthetic.models[0], { api: "openai-responses", baseUrl: "https://synthetic.invalid/v1" });
  f.save();
  await f.wrapper.send({ type: "set_model", provider: "synthetic", modelId: "primary" });
  delete f.config.providers.synthetic.models[0].baseUrl;
  f.config.providers.synthetic.models[0].reasoning = false;
  f.save();
  await f.wrapper.send({ type: "reload" });
  assert.equal(f.wrapper.inner.model.baseUrl, "https://synthetic.invalid");
  assert.equal(f.wrapper.inner.model.api, "openai-responses");
  assert.equal(f.wrapper.inner.thinkingLevel, "off");
});

test("invalid config refuses selection; a removed model warns after reload without claiming the resource reload failed", async (t) => {
  const f = await fixture(t);
  const selected = f.wrapper.inner.model;
  const events = [];
  f.wrapper.onEvent((event) => events.push(event));
  await writeFile(f.modelsPath, '{ "providers": { broken');
  await assert.rejects(f.wrapper.send({ type: "set_model", provider: "synthetic", modelId: "primary" }), /model configuration/i);
  assert.strictEqual(f.wrapper.inner.model, selected);
  // The normal writer correctly refuses malformed input; repair the fixture explicitly.
  await writeFile(f.modelsPath, JSON.stringify(f.config));
  f.config.providers.synthetic.models.shift();
  f.save();
  assert.deepEqual(await f.wrapper.send({ type: "reload" }), { success: true });
  assert.strictEqual(f.wrapper.inner.model, selected);
  const warning = events.find((event) => event.method === "notify" && event.notifyType === "warning");
  assert.match(warning?.message ?? "", /Reloaded, but.*Model not found: synthetic\/primary/);
  await f.wrapper.send({ type: "set_model", provider: "synthetic", modelId: "sibling" });
  assert.equal(f.wrapper.inner.model.id, "sibling");
});

for (const command of ["set_model", "reload"]) {
  test(`${command} with an unchanged model does not append model/thinking entries or emit model_select`, async (t) => {
    const { wrapper } = await fixture(t);
    const selected = wrapper.inner.model;
    const setModel = t.mock.method(wrapper.inner, "setModel");
    const changes = () => wrapper.inner.sessionManager.getEntries().filter((entry) =>
      entry.type === "model_change" || entry.type === "thinking_level_change");
    const before = changes();
    await wrapper.send({ type: command, provider: "synthetic", modelId: "primary" });
    assert.strictEqual(wrapper.inner.model, selected);
    assert.deepEqual(changes(), before);
    assert.equal(setModel.mock.callCount(), 0, "setModel is the SDK's model_select event source");
  });
}

for (const invalid of ['{"providers": { broken', JSON.stringify({ providers: { synthetic: { models: [{ id: "bad", contextWindow: 0 }] } } })]) {
  test(`invalid ${invalid.startsWith('{"providers": { broken') ? "JSON" : "schema"} cannot silently drop a built-in model's endpoint override`, async (t) => {
    const f = await fixture(t);
    const { wrapper } = f;
    const builtin = wrapper.inner.modelRuntime.getModels("anthropic")[0];
    assert.ok(builtin);
    f.config.providers.anthropic = { baseUrl: "https://synthetic.invalid/proxy", apiKey: "synthetic-not-a-key" };
    f.save();
    await wrapper.send({ type: "set_model", provider: builtin.provider, modelId: builtin.id });
    const selected = wrapper.inner.model;
    assert.equal(selected.baseUrl, "https://synthetic.invalid/proxy");
    await writeFile(f.modelsPath, invalid);
    await assert.rejects(wrapper.send({ type: "set_model", provider: builtin.provider, modelId: builtin.id }), /Could not load model configuration/);
    assert.strictEqual(wrapper.inner.model, selected);
    assert.notEqual(wrapper.inner.modelRuntime.getModel(builtin.provider, builtin.id).baseUrl, selected.baseUrl,
      "The SDK reverted the catalog to the built-in endpoint; it must not be bound to the session");
  });
}

test("unexpected refresh errors never echo provider credentials to the client", async (t) => {
  const { wrapper } = await fixture(t);
  const selected = wrapper.inner.model;
  t.mock.method(wrapper.inner.modelRuntime, "refresh", async () => { throw new Error("secret-test-token"); });
  await assert.rejects(wrapper.send({ type: "set_model", provider: "synthetic", modelId: "sibling" }), (error) => {
    assert.match(error.message, /Could not refresh/);
    assert.doesNotMatch(error.message, /secret-test-token/);
    return true;
  });
  assert.strictEqual(wrapper.inner.model, selected);
});

test("model changes refuse a running or preflighting prompt, like the already-disabled browser selector", async (t) => {
  const { wrapper } = await fixture(t);
  let finish;
  t.mock.method(wrapper.inner, "prompt", (_text, options) => new Promise((resolve) => {
    finish = resolve;
    options.preflightResult("started");
  }));
  t.after(() => finish?.());
  await wrapper.send({ type: "prompt", message: "Keep this synthetic prompt open" });
  await assert.rejects(wrapper.send({ type: "set_model", provider: "synthetic", modelId: "sibling" }), /Wait for the current response/);
  await assert.rejects(wrapper.send({ type: "reload" }), /Wait for the current response/);
  finish();
  await nextTurn();
});

test("a model refresh excludes competing mutations, allows status and Stop, and never applies after cancellation", async (t) => {
  const { wrapper } = await fixture(t);
  const runtime = wrapper.inner.modelRuntime;
  const refresh = runtime.refresh.bind(runtime);
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  let receivedSignal;
  t.mock.method(runtime, "refresh", async (options) => {
    assert.equal(options.allowNetwork, false);
    assert.deepEqual(options.providers, ["synthetic"], "Do not refresh unrelated extension providers");
    receivedSignal = options.signal;
    entered();
    await held;
    return refresh(options);
  });
  const selected = wrapper.inner.model;
  const changing = wrapper.send({ type: "set_model", provider: "synthetic", modelId: "sibling" });
  // Attach the rejection handler before Stop can settle the operation.
  const cancelled = assert.rejects(changing, /abort|cancel|stopped/i);
  t.after(async () => { release(); await cancelled; });
  await started;
  assert.equal(wrapper.isRunning(), true, "An applying model definition cannot be idle-reaped");
  assert.equal((await wrapper.send({ type: "get_state" })).model.id, "primary");
  await assert.rejects(wrapper.send({ type: "prompt", message: "Must not start" }), /model configuration/i);
  await assert.rejects(wrapper.send({ type: "set_model", provider: "synthetic", modelId: "primary" }), /model configuration/i);
  await assert.rejects(wrapper.send({ type: "reload" }), /model configuration/i);
  await wrapper.send({ type: "abort" });
  assert.equal(receivedSignal.aborted, true);
  release();
  await cancelled;
  assert.ok(wrapper.inner.model === selected);
  assert.equal(wrapper.isRunning(), false);
});

for (const cancellation of ["Stop", "timeout", "shutdown"]) {
  test(`the SDK cancels an uncooperative provider on ${cancellation}, and ignores its late publication`, async (t) => {
    const { wrapper } = await fixture(t);
    const runtime = wrapper.inner.modelRuntime;
    const selected = wrapper.inner.model;
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    t.after(() => release());
    let publish;
    let armed = false;
    const refresh = runtime.refresh.bind(runtime);
    let registration;
    const registering = t.mock.method(runtime, "refresh", (options) => (registration = refresh(options)));
    runtime.registerNativeProvider({
      ...runtime.getProvider("synthetic"),
      refreshModels: async (options) => {
        if (!armed) return;
        assert.equal(options.allowNetwork, false);
        publish = options.publish;
        entered();
        await held; // Deliberately ignore options.signal.
      },
    });
    await registration; // registerNativeProvider starts its own offline refresh.
    registering.mock.restore();
    armed = true;
    const timeout = new AbortController();
    if (cancellation === "timeout") {
      t.mock.method(AbortSignal, "timeout", (ms) => {
        assert.equal(ms, 30_000);
        return timeout.signal;
      });
    }
    const changing = wrapper.send({ type: "set_model", provider: "synthetic", modelId: "sibling" });
    const cancelled = assert.rejects(changing, /abort|cancel|stopped|Timed out|closed/i);
    await started;
    if (cancellation === "Stop") await wrapper.send({ type: "abort" });
    else if (cancellation === "timeout") timeout.abort(new Error("Synthetic timeout"));
    else await wrapper.shutdown();
    // Must settle before the provider callback does, using SDK-owned cancellation.
    await cancelled;
    assert.strictEqual(wrapper.inner.model, selected);
    assert.equal(wrapper.isRunning(), false);
    let updated = false;
    await assert.rejects(publish({ update: () => { updated = true; } }), /abort|Synthetic timeout/i);
    await nextTurn();
    assert.equal(updated, false);
    release();
    await nextTurn();
    assert.strictEqual(wrapper.inner.model, selected);
  });
}
