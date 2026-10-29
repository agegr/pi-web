import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { ProviderEntryError, checkProviderEntries } = await jiti.import("./model-provider-check.ts");

const dir = await mkdtemp(join(tmpdir(), "pi-web-provider-check-"));
after(() => rm(dir, { recursive: true, force: true }));

const URL = "http://127.0.0.1:1/v1";
const CASES = [
  ["Add provider's untouched stub", { "new-provider": { api: "openai-completions" } }, ["new-provider", "empty"]],
  ["an entry with nothing in it", { relay: {} }, ["relay", "empty"]],
  ["an empty models list", { relay: { api: "openai-completions", models: [] } }, ["relay", "empty"]],
  ["an empty modelOverrides", { "openai-codex": { modelOverrides: {} } }, ["openai-codex", "empty"]],
  ["oauth without a Base URL", { relay: { oauth: "radius", models: [] } }, ["relay", "baseUrl"]],
  ["one bad provider among good ones", {
    ok: { baseUrl: URL, api: "openai-completions", apiKey: "TEST_ONLY_KEY", models: [{ id: "AURA-think" }] },
    "new-provider": { api: "openai-completions" },
  }, ["new-provider", "empty"]],
  ["a context-window override Settings writes", { "openai-codex": { modelOverrides: { "gpt-6-astra": { contextWindow: 500000 } } } }, null],
  ["an API key alone", { relay: { apiKey: "TEST_ONLY_KEY" } }, null],
  ["empty headers", { relay: { headers: {} } }, null],
  ["authHeader false", { relay: { authHeader: false } }, null],
  ["a complete custom provider", { relay: { baseUrl: URL, api: "openai-completions", apiKey: "TEST_ONLY_KEY", models: [{ id: "a" }] } }, null],
];

function refusal(providers) {
  try {
    checkProviderEntries({ providers });
    return null;
  } catch (error) {
    assert.ok(error instanceof ProviderEntryError, String(error));
    return [error.provider, error.problem];
  }
}

test("refuses exactly the entries pi fails to load on their own, naming the provider", async () => {
  for (const [name, providers, expected] of CASES) {
    assert.deepEqual(refusal(providers), expected, name);
    const modelsPath = join(dir, "models.json");
    await writeFile(modelsPath, JSON.stringify({ providers }));
    const runtime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"), modelsPath, modelsStorePath: join(dir, "models-store.json"), refreshOnCreate: false,
    });
    const error = runtime.getError();
    if (expected) assert.match(error ?? "", new RegExp(`^Provider "${expected[0]}": `), name);
    else assert.equal(error, undefined, name);
  }
});

test("models the store drops for a blank id do not count", () => {
  assert.deepEqual(refusal({ "new-provider": { api: "openai-completions", models: [{ id: " " }] } }), ["new-provider", "empty"]);
});
