import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// A stored API key whose `!command` fails: pi 1.6.1 reports the provider as
// `{ configured: false, source: "stored" }` (pi #12164). The Models panel must
// still tell it apart from a provider with no key at all, so it can be removed.
const root = await mkdtemp(join(tmpdir(), "pi-web-provider-listing-"));
const agentDir = join(root, "agent");
await mkdir(agentDir, { recursive: true });
await mkdir(join(root, "home"));
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.HOME = join(root, "home");
process.env.USERPROFILE = join(root, "home");
process.env.PI_OFFLINE = "1";
delete process.env.DEEPSEEK_API_KEY;

after(() => rm(root, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
const { collectProviderListingInputs } = await jiti.import("./provider-listing-runtime.ts");
const { buildApiKeyProviderList } = await jiti.import("./provider-listing.ts");
const { removeStoredCredentialIfType } = await jiti.import("./provider-credential-store.ts");

async function deepseekListing() {
  const runtime = await ModelRuntime.create({ agentDir });
  const listing = buildApiKeyProviderList(await collectProviderListingInputs(runtime));
  return listing.find((provider) => provider.id === "deepseek");
}

test("an unresolved stored key is listed as such until it is removed", async () => {
  await writeFile(join(agentDir, "auth.json"), JSON.stringify({ deepseek: { type: "api_key", key: "!false" } }));

  const unresolved = await deepseekListing();
  assert.equal(unresolved.configured, false);
  assert.equal(unresolved.unresolved, true);
  assert.equal(unresolved.source, undefined);

  assert.equal((await removeStoredCredentialIfType("deepseek", "api_key")).status, "removed");
  assert.deepEqual(JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8")), {});

  const removed = await deepseekListing();
  assert.equal(removed.configured, false);
  assert.equal(removed.unresolved, undefined);
});

test("a stored key that resolves is configured, not unresolved", async () => {
  await writeFile(join(agentDir, "auth.json"), JSON.stringify({ deepseek: { type: "api_key", key: "!echo sk-pi-web-test" } }));

  const configured = await deepseekListing();
  assert.equal(configured.configured, true);
  assert.equal(configured.unresolved, undefined);
});
