import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// Proves the whole mechanism #914 asks for: a catalog pi-web has never seen
// reaches the model list without a pi CLI run. pi.dev is stubbed, so the test
// is offline; everything between the response and the model list is real.
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-model-catalog-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_OFFLINE;

const PROVIDER = "kimi-coding";
const CATALOG_URL = `https://pi.dev/api/models/providers/${PROVIDER}`;
const NEW_MODEL_ID = "pi-web-test-preview";

// A provider with no credential is skipped before the network is touched.
await writeFile(
  join(agentDir, "auth.json"),
  JSON.stringify({ [PROVIDER]: { type: "api_key", key: "sk-test" } }, null, 2),
);

let catalogRequests = 0;
const upstreamFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url !== CATALOG_URL) return upstreamFetch(input, init);
  catalogRequests += 1;
  return new Response(
    JSON.stringify([
      {
        id: NEW_MODEL_ID,
        name: "Pi Web Test Preview",
        api: "anthropic-messages",
        provider: PROVIDER,
        baseUrl: "https://example.invalid/anthropic",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 65536,
      },
    ]),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        etag: '"pi-web-test"',
        // The overlay is dropped unless the catalog postdates the SDK's own
        // generated model data, so a stale catalog cannot undo a pi upgrade.
        "last-modified": new Date().toUTCString(),
      },
    },
  );
};

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { refreshModelCatalogs, shareModelCatalogRefresh } = await jiti.import("./model-catalog-refresh.ts");
const { createModelRuntimeWithExtensions } = await jiti.import("./model-runtime.ts");

after(async () => {
  globalThis.fetch = upstreamFetch;
  await rm(agentDir, { recursive: true, force: true });
});

async function providerModelIds() {
  const runtime = await createModelRuntimeWithExtensions();
  return runtime.getModels().filter((model) => model.provider === PROVIDER).map((model) => model.id);
}

test("a refreshed catalog reaches the model list the way the pi CLI's did", async () => {
  assert.ok(!(await providerModelIds()).includes(NEW_MODEL_ID));

  const result = await refreshModelCatalogs({ providers: [PROVIDER] });

  assert.equal(catalogRequests, 1);
  assert.deepEqual(result, { completed: true, changed: true });
  // A separate runtime with the network untouched — what GET /api/models builds.
  assert.ok((await providerModelIds()).includes(NEW_MODEL_ID));
});

test("a second press refetches and reports that nothing moved", async () => {
  // `force: true` is always sent, so the SDK's four-hour freshness window does
  // not turn the button into a no-op.
  const result = await refreshModelCatalogs({ providers: [PROVIDER] });

  assert.equal(catalogRequests, 2);
  assert.deepEqual(result, { completed: true, changed: false });
});

test("concurrent presses for the same provider share one pass", async () => {
  const before = catalogRequests;
  const [first, second] = await Promise.all([
    shareModelCatalogRefresh({ providers: [PROVIDER] }),
    shareModelCatalogRefresh({ providers: [PROVIDER] }),
  ]);

  assert.equal(catalogRequests, before + 1);
  assert.deepEqual(first, second);
});
