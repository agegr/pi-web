import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";

// The provider lists and Models switches share one extension-loaded runtime
// (#1226): extensions run once per build, while credentials and models.json
// are read again on every call, as a fresh runtime would read them. The
// extension below counts its factory runs and registers a provider.
const root = await mkdtemp(join(tmpdir(), "pi-web-model-runtime-"));
const agentDir = join(root, "agent");
await mkdir(join(agentDir, "extensions"), { recursive: true });
await mkdir(join(root, "home"));
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.HOME = join(root, "home");
process.env.USERPROFILE = join(root, "home");
process.env.PI_OFFLINE = "1";
// Keep the developer's own keys out of the auth status compared below.
for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) delete process.env[name];

await writeFile(join(agentDir, "extensions", "counted.ts"), `
const counts = ((globalThis as any).__piWebRuntimeTest ??= { imports: 0, factoryRuns: 0 });
counts.imports += 1;
export default function (pi: any) {
  counts.factoryRuns += 1;
  pi.registerProvider("counted-provider", {
    baseUrl: "https://example.invalid/v1",
    apiKey: "COUNTED_PROVIDER_KEY",
    api: "openai-completions",
    models: [{ id: "counted-model", name: "Counted Model", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100 }],
  });
}
`);

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const {
  createModelRuntimeWithExtensions,
  getModelRuntimeWithExtensions,
  invalidateModelRuntimeWithExtensions,
} = await jiti.import("./model-runtime.ts");
const { collectProviderListingInputs } = await jiti.import("./provider-listing-runtime.ts");
const { buildApiKeyProviderList, buildOAuthProviderList } = await jiti.import("./provider-listing.ts");
const { removeStoredCredentialIfType, storeProviderCredential } = await jiti.import("./provider-credential-store.ts");

const factoryRuns = () => globalThis.__piWebRuntimeTest?.factoryRuns ?? 0;

const pending = Symbol("pending");

// `promise`'s value, or `pending` once `ms` pass first. The timer stays
// referenced and is cleared once the race settles: while a test awaits a
// promise stuck on purpose, nothing else keeps the event loop alive, and with
// an unref'd timer Node 22's test runner found it empty and cancelled the file
// ("Promise resolution is still pending but the event loop has already
// resolved"). Node 24's runner keeps the loop alive itself, which hid it.
async function within(promise, ms) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(resolve, ms, pending); })]);
  } finally {
    clearTimeout(timer);
  }
}

async function providerRow(runtime, id) {
  return (await collectProviderListingInputs(runtime)).find((row) => row.id === id);
}

async function listing(runtime) {
  const inputs = await collectProviderListingInputs(runtime);
  return JSON.stringify({ oauth: buildOAuthProviderList(inputs), apiKey: buildApiKeyProviderList(inputs) });
}

beforeEach(() => invalidateModelRuntimeWithExtensions());

after(async () => {
  invalidateModelRuntimeWithExtensions();
  await rm(root, { recursive: true, force: true });
});

test("concurrent first calls run the extensions once and share the runtime", async () => {
  const before = factoryRuns();
  const [a, b] = await Promise.all([getModelRuntimeWithExtensions(), getModelRuntimeWithExtensions()]);
  assert.equal(factoryRuns() - before, 1);
  assert.equal(a, b);
  assert.ok(a.getProvider("counted-provider"), "the extension's provider is registered");

  assert.equal(await getModelRuntimeWithExtensions(), a);
  assert.equal(factoryRuns() - before, 1, "a later call reuses the build");
});

test("credential and models.json writes show on the next call without running the extensions", async () => {
  const runtime = await getModelRuntimeWithExtensions();
  const before = factoryRuns();
  assert.equal((await providerRow(runtime, "openai")).status.configured, false);

  await storeProviderCredential("openai", { type: "api_key", key: "sk-pi-web-test" });
  let row = await providerRow(await getModelRuntimeWithExtensions(), "openai");
  assert.deepEqual(row.status, { configured: true, source: "stored" });
  assert.equal(row.credentialType, "api_key");

  assert.equal((await removeStoredCredentialIfType("openai", "api_key")).status, "removed");
  row = await providerRow(await getModelRuntimeWithExtensions(), "openai");
  assert.equal(row.status.configured, false);
  assert.equal(row.credentialType, undefined);

  // The pi CLI, or any other process, writing the files directly.
  await writeFile(
    join(agentDir, "auth.json"),
    JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-pi-web-test" } }, null, 2),
  );
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "my-proxy": { baseUrl: "https://example.invalid/v1", api: "openai-completions", apiKey: "x", models: [{ id: "m1" }] },
      },
    }, null, 2),
  );
  const shared = await getModelRuntimeWithExtensions();
  assert.equal(shared, runtime);
  row = await providerRow(shared, "anthropic");
  assert.deepEqual(row.status, { configured: true, source: "stored" });
  assert.equal(row.credentialType, "api_key");
  assert.equal((await providerRow(shared, "my-proxy")).modelCount, 1);
  assert.ok(shared.getProvider("counted-provider"), "the extension's provider survives the refresh");
  assert.equal(factoryRuns() - before, 0);

  // Exactly what a runtime built for this request would list.
  assert.equal(await listing(shared), await listing(await createModelRuntimeWithExtensions()));
});

test("concurrent calls each see a credential written before they asked", async () => {
  await getModelRuntimeWithExtensions();
  const before = factoryRuns();
  // Settings › Models asks for the provider list and the switches at once,
  // and does again after a sign-in or a saved key.
  for (let round = 0; round < 6; round++) {
    const stored = round % 2 === 0;
    if (stored) await storeProviderCredential("openai", { type: "api_key", key: "sk-pi-web-test" });
    else await removeStoredCredentialIfType("openai", "api_key");
    const seen = await Promise.all([0, 1, 2].map(() => getModelRuntimeWithExtensions()
      .then((runtime) => runtime.getProviderAuthStatus("openai").configured)));
    assert.deepEqual(seen, [stored, stored, stored], `round ${round}`);
  }
  assert.equal(factoryRuns() - before, 0);
});

test("invalidation and expiry build the runtime again", async () => {
  const first = await getModelRuntimeWithExtensions();
  let before = factoryRuns();
  invalidateModelRuntimeWithExtensions();
  const second = await getModelRuntimeWithExtensions();
  assert.notEqual(second, first);
  assert.equal(factoryRuns() - before, 1);

  // The TTL runs from the end of the build, which can take seconds.
  const entry = globalThis.__piWebSharedModelRuntime;
  const left = entry.expiresAt - Date.now();
  assert.ok(left > 590_000 && left <= 600_000, `expires in ${left} ms`);
  entry.expiresAt = Date.now() - 1;
  before = factoryRuns();
  const third = await getModelRuntimeWithExtensions();
  assert.notEqual(third, second);
  assert.equal(factoryRuns() - before, 1, "an expired entry is rebuilt");
});

test("a build stuck in an extension factory does not hold calls after invalidation", async () => {
  // The SDK awaits each factory with no timeout, e.g. one waiting on a local
  // model server that never answers. This one waits until the test ends, so a
  // regression fails here instead of hanging the tests after it.
  const stuckFile = join(agentDir, "extensions", "stuck.ts");
  await writeFile(stuckFile, `export default function () {
  return new Promise((resolve) => { (globalThis as any).__piWebRuntimeTestRelease = resolve; });
}
`);
  const stuck = getModelRuntimeWithExtensions();
  try {
    assert.equal(await within(stuck, 200), pending);

    // The user removes the plugin: POST /api/plugins drops the shared entry.
    await rm(stuckFile);
    invalidateModelRuntimeWithExtensions();
    const next = await within(getModelRuntimeWithExtensions(), 5_000);
    assert.notEqual(next, pending, "the call after invalidation waited on the stuck build");
    assert.ok(next.getProvider("counted-provider"));
    assert.equal(await within(stuck, 0), pending, "the stuck build is still running");
  } finally {
    await rm(stuckFile, { force: true });
    globalThis.__piWebRuntimeTestRelease?.();
    await stuck;
  }
});

test("a refresh stuck in an extension provider does not hold calls after invalidation", async () => {
  // Every call's offline refresh runs extension providers' refreshModels(),
  // which the SDK awaits with no timeout. This one stalls once the runtime is
  // built, until the test ends.
  const stallFile = join(agentDir, "extensions", "stall.ts");
  await writeFile(stallFile, `export default function (pi: any) {
  pi.registerProvider("stall-provider", {
    baseUrl: "https://example.invalid/v1",
    apiKey: "STALL_PROVIDER_KEY",
    api: "openai-completions",
    models: [],
    refreshModels: () => (globalThis as any).__piWebRuntimeTestStall
      ? new Promise((resolve) => { (globalThis as any).__piWebRuntimeTestUnstall = () => resolve([]); })
      : Promise.resolve([]),
  });
}
`);
  invalidateModelRuntimeWithExtensions();
  await getModelRuntimeWithExtensions();
  globalThis.__piWebRuntimeTestStall = true;
  const stuck = getModelRuntimeWithExtensions();
  try {
    assert.equal(await within(stuck, 200), pending);

    await rm(stallFile);
    invalidateModelRuntimeWithExtensions();
    const next = await within(getModelRuntimeWithExtensions(), 5_000);
    assert.notEqual(next, pending, "the call after invalidation waited on the stuck refresh");
    assert.equal(next.getProvider("stall-provider"), undefined);
  } finally {
    await rm(stallFile, { force: true });
    globalThis.__piWebRuntimeTestStall = false;
    globalThis.__piWebRuntimeTestUnstall?.();
    await stuck;
  }
});

test("a failed build is not kept", async () => {
  const brokenDir = join(root, "not-a-directory");
  await writeFile(brokenDir, "");
  process.env.PI_CODING_AGENT_DIR = brokenDir;
  try {
    await assert.rejects(getModelRuntimeWithExtensions());
    assert.equal(globalThis.__piWebSharedModelRuntime, undefined);
  } finally {
    process.env.PI_CODING_AGENT_DIR = agentDir;
  }
  const before = factoryRuns();
  assert.ok((await getModelRuntimeWithExtensions()).getProvider("counted-provider"));
  assert.equal(factoryRuns() - before, 1);
});
