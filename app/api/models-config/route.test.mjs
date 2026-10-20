import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-models-config-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");
const modelsPath = join(testAgentDir, "models.json");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function put(body) {
  return new Request("http://localhost/api/models-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Host: "localhost" },
    body: JSON.stringify(body),
  });
}

test("a models.json with a syntax error is reported instead of read as empty, and a save cannot replace it", async () => {
  const original = '{ "providers": { "acme": { "models": [ } } }';
  await writeFile(modelsPath, original);

  let response = await GET();
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /models\.json/);

  response = await PUT(put({ providers: {} }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /models\.json/);
  assert.equal(await readFile(modelsPath, "utf8"), original);
});

test("a commented models.json loads with its providers", async () => {
  await writeFile(modelsPath, '{\n  // local models\n  "providers": { "acme": { "models": [{ "id": "a" },] } },\n}\n');

  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { providers: { acme: { models: [{ id: "a" }] } } });
});

test("invalid context overrides are rejected without changing the saved configuration", async () => {
  const config = { providers: { "openai-codex": { modelOverrides: { "gpt-6-astra": { contextWindow: 500000 } } } } };
  await writeFile(modelsPath, JSON.stringify(config));
  const invalid = structuredClone(config);
  invalid.providers["openai-codex"].modelOverrides["gpt-6-astra"].contextWindow = 0;
  const response = await PUT(put(invalid));
  assert.equal(response.status, 400);
  assert.deepEqual(await (await GET()).json(), config);
});

test("saved login-model context overrides reach the SDK; resetting restores the catalog without changing credentials", async () => {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const authPath = join(testAgentDir, "auth.json");
  const credentials = JSON.stringify({ "openai-codex": { type: "oauth", access: "test-only", refresh: "test-only", expires: 9999999999999 } });
  await writeFile(authPath, credentials);
  const options = { authPath, modelsPath, modelsStorePath: join(testAgentDir, "models-store.json"), refreshOnCreate: false };
  const config = { providers: { "openai-codex": { modelOverrides: { "gpt-6-astra": { contextWindow: "500000", maxTokens: 128000 } } } } };
  assert.equal((await PUT(put(config))).status, 200);
  const saved = await (await GET()).json();
  assert.equal(saved.providers["openai-codex"].modelOverrides["gpt-6-astra"].contextWindow, 500000);
  const runtime = await ModelRuntime.create(options);
  assert.equal(runtime.getModel("openai-codex", "gpt-6-astra").contextWindow, 500000);
  delete config.providers["openai-codex"].modelOverrides["gpt-6-astra"].contextWindow;
  assert.equal((await PUT(put(config))).status, 200);
  const reset = await ModelRuntime.create(options);
  const baseline = await ModelRuntime.create({ ...options, modelsPath: null });
  assert.equal(reset.getModel("openai-codex", "gpt-6-astra").contextWindow, baseline.getModel("openai-codex", "gpt-6-astra").contextWindow);
  assert.equal(reset.getModel("openai-codex", "gpt-6-astra").maxTokens, 128000);
  assert.equal(await readFile(authPath, "utf8"), credentials);
});

test("a hand-edited override pi accepts does not block saving an unrelated provider", async () => {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const config = { providers: {
    "openai-codex": { modelOverrides: { "gpt-6-astra": { contextWindow: 400000.5 } } },
    relay: { baseUrl: "http://127.0.0.1:1/v1", api: "openai-completions", apiKey: "TEST_ONLY_KEY", models: [{ id: "a" }] },
  } };
  await writeFile(modelsPath, JSON.stringify(config));
  const options = { authPath: join(testAgentDir, "auth.json"), modelsPath, modelsStorePath: join(testAgentDir, "models-store.json"), refreshOnCreate: false };
  const runtime = await ModelRuntime.create(options);
  assert.equal(runtime.getError(), undefined);
  assert.equal(runtime.getModel("openai-codex", "gpt-6-astra").contextWindow, 400000.5);
  const edited = structuredClone(config);
  edited.providers.relay.models.push({ id: "b" });
  const response = await PUT(put(edited));
  assert.equal(response.status, 200);
  assert.deepEqual(await (await GET()).json(), edited);
});

test("model-level endpoints round-trip through Save, override only that model, and can return to inheritance", async () => {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const config = { providers: { relay: {
    baseUrl: "https://synthetic.invalid", api: "anthropic-messages", apiKey: "synthetic-not-a-key",
    models: [
      { id: "one", api: "openai-responses", baseUrl: "https://synthetic.invalid/v1", headers: { "x-example": "keep" } },
      { id: "two" },
    ],
  } } };
  const options = { authPath: join(testAgentDir, "auth.json"), modelsPath, modelsStorePath: join(testAgentDir, "models-store.json"), refreshOnCreate: false };
  assert.equal((await PUT(put(config))).status, 200);
  assert.deepEqual(await (await GET()).json(), config);
  const runtime = await ModelRuntime.create(options);
  assert.equal(runtime.getError(), undefined);
  assert.equal(runtime.getModel("relay", "one").baseUrl, "https://synthetic.invalid/v1");
  assert.equal(runtime.getModel("relay", "two").baseUrl, "https://synthetic.invalid");
  assert.equal(runtime.getModel("relay", "two").api, "anthropic-messages");
  delete config.providers.relay.models[0].baseUrl;
  assert.equal((await PUT(put(config))).status, 200);
  assert.deepEqual(await (await GET()).json(), config);
  const reset = await ModelRuntime.create(options);
  assert.equal(reset.getModel("relay", "one").baseUrl, "https://synthetic.invalid");
  assert.equal(reset.getModel("relay", "one").api, "openai-responses");
});

test("a symlinked models.json keeps its link: Save writes through it to its target", async () => {
  const targetPath = join(testAgentDir, "models-target.json");
  await writeFile(targetPath, JSON.stringify({ providers: { relay: { models: [{ id: "a" }] } } }));
  await rm(modelsPath, { force: true });
  await symlink(targetPath, modelsPath);

  const draft = { providers: { relay: { models: [{ id: "a" }, { id: "b" }] } } };
  assert.equal((await PUT(put(draft))).status, 200);
  assert.deepEqual(await (await GET()).json(), draft);
  assert.equal((await lstat(modelsPath)).isSymbolicLink(), true);
  assert.deepEqual(JSON.parse(await readFile(targetPath, "utf8")), draft);
});

test("a dangling models.json symbolic link is refused instead of replaced", async () => {
  await rm(modelsPath, { force: true });
  await symlink(join(testAgentDir, "models-gone.json"), modelsPath);

  const response = await PUT(put({ providers: {} }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /dangling symbolic link/);
  assert.equal((await lstat(modelsPath)).isSymbolicLink(), true);
});
