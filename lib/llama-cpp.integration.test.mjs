import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

test("Settings lists llama.cpp, connects a router and makes its model available to a fresh session", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-web-llama-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.LLAMA_BASE_URL;
  delete process.env.LLAMA_API_KEY;
  delete process.env.PI_OFFLINE;
  const router = "http://router.invalid:8080";
  let expectedKey = "";
  let models = [{ id: "local-chat", status: { value: "loaded" }, meta: { n_ctx: 8192 } }];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, router);
    if (expectedKey) assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${expectedKey}`);
    if (url.pathname === "/models") return Response.json({ data: models });
    assert.equal(url.pathname, "/props");
    return Response.json({});
  });

  const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
  const listing = await jiti.import("../app/api/auth/providers/route.ts");
  const auth = await jiti.import("../app/api/auth/api-key/[provider]/route.ts");
  const picker = await jiti.import("../app/api/models/route.ts");
  const defaults = await jiti.import("../app/api/models/default/route.ts");
  const { startRpcSession } = await jiti.import("./rpc-manager.ts");
  const { allowFileRoot } = await jiti.import("./file-access.ts");
  const { invalidateModelRuntimeWithExtensions } = await jiti.import("./model-runtime.ts");
  const { refreshModelCatalogs } = await jiti.import("./model-catalog-refresh.ts");
  const row = async () => (await (await listing.GET()).json()).apiKeyProviders.find((p) => p.id === "llama.cpp");
  allowFileRoot(agentDir);
  async function pickedModels() {
    const response = await picker.GET(new Request("http://localhost/?cwd=" + encodeURIComponent(agentDir)));
    const { modelList } = await response.json();
    return modelList.filter((model) => model.provider === "llama.cpp").map((model) => model.id);
  }
  const params = { params: Promise.resolve({ provider: "llama.cpp" }) };
  const save = (body) => auth.POST(new Request("http://localhost/", { method: "POST", body: JSON.stringify(body) }), params);

  assert.equal((await row()).configured, false);
  assert.equal((await save({ serverUrl: "invalid" })).status, 400);
  for (const apiKey of ["", "test-llama-key"]) {
    expectedKey = apiKey;
    const response = await save({ serverUrl: router + "/v1", apiKey });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.catalog.completed, true, JSON.stringify(result));
    assert.equal((await row()).configured, true);
    const stored = JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8"))["llama.cpp"];
    assert.equal(stored.env.LLAMA_BASE_URL, router);
    assert.equal(stored.key, apiKey || undefined);
    assert.deepEqual(await pickedModels(), ["local-chat"]);
    const saved = await defaults.PUT(new Request("http://localhost/", {
      method: "PUT", body: JSON.stringify({ cwd: agentDir, provider: "llama.cpp", modelId: "local-chat" }),
    }));
    assert.equal(saved.status, 200, await saved.text());
    const { session } = await startRpcSession(`__new__${randomUUID()}`, "", agentDir);
    try {
      const { model, modelRuntime } = session.inner;
      assert.equal(model.provider, "llama.cpp");
      assert.equal(model.id, "local-chat");
      assert.equal(model.contextWindow, 8192);
      const request = await modelRuntime.prepareRequest(model);
      assert.equal(request.model.baseUrl, router + "/v1");
      assert.equal(request.options.apiKey, apiKey || "local");
    } finally {
      await session.shutdown();
    }
  }
  // An empty catalog must also reach the picker after the previous one was remembered.
  models = [];
  await refreshModelCatalogs({ providers: ["llama.cpp"] });
  assert.deepEqual(await pickedModels(), []);
  assert.equal((await auth.DELETE(null, params)).status, 200);
  assert.equal((await row()).configured, false);

  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ extensions: ["-builtin:llama.cpp"] }));
  invalidateModelRuntimeWithExtensions();
  assert.equal(await row(), undefined);
});
