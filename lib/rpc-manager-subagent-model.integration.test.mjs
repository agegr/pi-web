import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(), "pi-subagent-model-restore-"));
const previous = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
process.env.HOME = join(root, "home");
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
await mkdir(process.env.HOME);
await mkdir(process.env.PI_CODING_AGENT_DIR);
const provider = "restore-fixture";
await writeFile(join(process.env.PI_CODING_AGENT_DIR, "models.json"), JSON.stringify({ providers: {
  [provider]: { api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1", apiKey: "fixture-only", models: [{ id: "saved" }, { id: "default" }] },
  "restore-no-auth": { api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1", models: [{ id: "saved" }] },
} }));
await writeFile(join(process.env.PI_CODING_AGENT_DIR, "settings.json"), JSON.stringify({ defaultProvider: provider, defaultModel: "default", cacheWarming: "off" }));
const jiti = createJiti(import.meta.url);
const { startRpcSession, getRpcSession } = await jiti.import("./rpc-manager.ts");
const { SUBAGENT_META_TYPE } = await jiti.import("./subagents.ts");
const keepAlive = setInterval(() => {}, 1000);
after(async () => {
  clearInterval(keepAlive);
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(root, { recursive: true, force: true });
});

async function sessionFixture({ child = true, snapshotVersion = 3, history = "none", modelId = "saved", modelProvider = provider } = {}) {
  const cwd = await mkdtemp(join(root, "cwd-")), id = randomUUID(), file = join(cwd, "fixture.jsonl");
  const timestamp = new Date().toISOString();
  const entries = [{ type: "session", version: 3, id, timestamp, cwd }];
  let parentId = null;
  const append = (entry) => {
    const next = { ...entry, id: randomUUID().slice(0, 8), parentId, timestamp };
    entries.push(next); parentId = next.id;
  };
  if (child) append({ type: "custom", customType: SUBAGENT_META_TYPE, data: {
    version: 1, parentSessionId: "parent-fixture", parentSessionPath: join(cwd, "parent.jsonl"),
    resourceSnapshot: {
      version: snapshotVersion, appendSystemPrompt: [], loadSkills: false, loadExtensions: false,
      ...(snapshotVersion === 1 ? { tools: [] } : { builtinTools: [], toolPolicy: { mode: "none", selectors: [], deny: [] } }),
      ...(snapshotVersion === 3 ? { codeMode: false, loadMcp: false, mcpServers: [] } : {}),
    },
  } });
  append({ type: "model_change", provider: modelProvider, modelId });
  if (history === "system") append({ type: "message", message: { role: "system", content: "", sections: {}, timestamp: Date.now() } });
  if (history === "user") append({ type: "message", message: { role: "user", content: "Fixture history; never sent", timestamp: Date.now() } });
  await writeFile(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return { cwd, id, file };
}

async function open(t, fixture, options = {}) {
  const { session } = await startRpcSession(fixture.id, fixture.file, fixture.cwd, options);
  t.after(() => session.shutdown());
  await session.waitUntilReady();
  return session;
}

for (const snapshotVersion of [1, 2, 3]) {
  test(`restores a v${snapshotVersion} child's recorded model before its first conversation instead of the global default`, async (t) => {
    const f = await sessionFixture({ snapshotVersion });
    const session = await open(t, f, { initialModel: { provider, modelId: "default" }, allowInitialModelFallback: true });
    assert.equal(session.inner.model?.id, "saved");
    assert.equal(session.inner.model?.provider, provider);
  });
}

test("restores the recorded child model with only a system message", async (t) => {
  const f = await sessionFixture({ history: "system" });
  assert.equal((await open(t, f)).inner.model?.id, "saved");
});

test("retains a child's persisted manual model change across shutdown and cold reopen", async (t) => {
  const f = await sessionFixture({ history: "user" });
  const first = await open(t, f);
  assert.equal(first.inner.model?.id, "saved");
  const response = await first.send({ type: "set_model", provider, modelId: "default" });
  assert.deepEqual(response, { id: "default", provider });
  assert.equal(first.inner.model?.id, "default");
  await first.shutdown();
  const second = await open(t, f);
  assert.equal(second.inner.model?.id, "default");
  assert.ok((await readFile(f.file, "utf8")).includes('"modelId":"default"'));
});

for (const history of ["none", "user"]) {
  test(`refuses an unavailable recorded child model (${history}) without substituting a configured default or rewriting its file`, async (t) => {
    const f = await sessionFixture({ history, modelId: "removed-model" });
    t.after(() => getRpcSession(f.id)?.destroy());
    const before = await readFile(f.file, "utf8");
    await assert.rejects(startRpcSession(f.id, f.file, f.cwd), /Cannot restore subagent model.*removed-model/);
    assert.equal(getRpcSession(f.id), undefined);
    assert.equal(await readFile(f.file, "utf8"), before);
  });
}

test("refuses a saved child model lacking configured authentication rather than falling back", async (t) => {
  const f = await sessionFixture({ history: "user", modelProvider: "restore-no-auth" });
  t.after(() => getRpcSession(f.id)?.destroy());
  await assert.rejects(startRpcSession(f.id, f.file, f.cwd), /Cannot restore subagent model.*restore-no-auth/);
  assert.equal(getRpcSession(f.id), undefined);
});

test("normal unsent sessions retain existing default selection behavior", async (t) => {
  const f = await sessionFixture({ child: false });
  assert.equal((await open(t, f, { toolNames: [] })).inner.model?.id, "default");
});

test("normal sessions with history still restore the saved model", async (t) => {
  const f = await sessionFixture({ child: false, history: "user" });
  assert.equal((await open(t, f, { toolNames: [] })).inner.model?.id, "saved");
});
