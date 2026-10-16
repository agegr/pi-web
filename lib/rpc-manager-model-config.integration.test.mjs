import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { startRpcSession } = await jiti.import("./rpc-manager.ts");
const { writeModelsConfig } = await jiti.import("./models-config-store.ts");

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-model-reselect-"));
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
    models: [{ id: "primary", reasoning: true, contextWindow: 32000, maxTokens: 1024 }],
  } } };
  const save = () => writeModelsConfig(config, join(dir, "models.json"));
  save();
  const settingsPath = join(dir, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ defaultThinkingLevel: "low", retry: { enabled: false }, compaction: { enabled: false } }));
  const { session: wrapper } = await startRpcSession(`__new__${dir}`, "", cwd, {
    toolNames: [], initialModel: { provider: "synthetic", modelId: "primary" }, thinkingLevel: "high",
  });
  t.after(() => wrapper.shutdown());
  return { wrapper, config, save, settingsPath, settingsBefore: await readFile(settingsPath, "utf8") };
}

const modelEntries = (inner) => inner.sessionManager.getEntries().filter((entry) =>
  entry.type === "model_change" || entry.type === "thinking_level_change");

test("reselecting a model applies a saved same-id edit and keeps the thinking level", async (t) => {
  const f = await fixture(t);
  const { inner } = f.wrapper;
  Object.assign(f.config.providers.synthetic.models[0], {
    api: "openai-responses", baseUrl: "https://synthetic.invalid/v1", contextWindow: 64000,
  });
  f.save();
  assert.equal(inner.model.api, "anthropic-messages", "Saving must not touch a live session");
  await f.wrapper.send({ type: "set_model", provider: "synthetic", modelId: "primary" });
  assert.equal(inner.model.api, "openai-responses");
  assert.equal(inner.model.baseUrl, "https://synthetic.invalid/v1");
  assert.equal(inner.model.contextWindow, 64000);
  assert.equal(inner.thinkingLevel, "high", "defaultThinkingLevel=low must not replace the session's level");
  assert.equal(await readFile(f.settingsPath, "utf8"), f.settingsBefore);

  const requests = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requests.push(`${url.hostname}${url.pathname}`);
    return new Response(JSON.stringify({ error: { message: "Offline interception", type: "fixture" } }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  });
  await inner.prompt("Synthetic request, intercepted locally.");
  assert.deepEqual(requests, ["synthetic.invalid/v1/responses"], "The SDK request uses the new route");

  // A model that no longer reasons clamps the kept level, as any model switch does.
  f.config.providers.synthetic.models[0].reasoning = false;
  f.save();
  await f.wrapper.send({ type: "set_model", provider: "synthetic", modelId: "primary" });
  assert.equal(inner.thinkingLevel, "off");
});

test("reselecting an unchanged model writes no model or thinking entries", async (t) => {
  const { wrapper } = await fixture(t);
  const selected = wrapper.inner.model;
  const setModel = t.mock.method(wrapper.inner, "setModel");
  const before = modelEntries(wrapper.inner);
  await wrapper.send({ type: "set_model", provider: "synthetic", modelId: "primary" });
  assert.strictEqual(wrapper.inner.model, selected);
  assert.deepEqual(modelEntries(wrapper.inner), before);
  assert.equal(setModel.mock.callCount(), 0);
});
