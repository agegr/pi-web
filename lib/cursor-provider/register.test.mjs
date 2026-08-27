import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses an explicit ModelRuntime helper instead of a global patch", async () => {
  const source = await readFile(new URL("../app-model-runtime.ts", import.meta.url), "utf8");
  assert.match(source, /export async function createAppModelRuntime/);
  assert.match(source, /registerCursorProvider\(runtime/);
  assert.doesNotMatch(source, /Object\.defineProperty\(ModelRuntime, "create"/);
  assert.doesNotMatch(source, /Symbol\.for/);
});

test("the explicit runtime helper installs Cursor's custom stream", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createJiti } = await import("jiti");
  const directory = await mkdtemp(join(tmpdir(), "pi-cursor-runtime-"));
  try {
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const { createAppModelRuntime } = await jiti.import("../app-model-runtime.ts");
    const runtime = await createAppModelRuntime({
      authPath: join(directory, "auth.json"),
      modelsPath: null,
    });
    assert.equal(runtime.getProvider("cursor")?.id, "cursor");
    assert.equal(
      typeof runtime.getRegisteredProviderConfig("cursor")?.streamSimple,
      "function",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an authenticated cold start hides fallback models until discovery succeeds", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const { createJiti } = await import("jiti");
  const directory = await mkdtemp(join(tmpdir(), "pi-cursor-cold-models-"));
  const authPath = join(directory, "auth.json");
  const access = `hdr.${Buffer.from(JSON.stringify({ sub: randomUUID() })).toString("base64url")}.sig`;
  await writeFile(authPath, JSON.stringify({
    cursor: {
      type: "oauth",
      access,
      refresh: "refresh-token",
      expires: Date.now() + 60 * 60_000,
    },
  }));

  try {
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const { createAppModelRuntime } = await jiti.import("../app-model-runtime.ts");
    const { refreshCursorProviderModels } = await jiti.import("./register.ts");
    const runtime = await createAppModelRuntime({ authPath, modelsPath: null });
    assert.equal(runtime.getModels("cursor").length, 0);

    await assert.rejects(
      () => refreshCursorProviderModels(
        runtime,
        AbortSignal.timeout(1_000),
        async () => { throw new Error("offline"); },
      ),
      /offline/,
    );
    assert.equal(runtime.getModels("cursor").length, 0);

    const refreshed = await refreshCursorProviderModels(
      runtime,
      AbortSignal.timeout(1_000),
      async (token) => {
        assert.equal(token, access);
        return [{
          id: "account-model",
          name: "Account Model",
          reasoning: false,
          contextWindow: 200_000,
          maxTokens: 64_000,
        }];
      },
    );
    assert.equal(refreshed, true);
    assert.deepEqual(runtime.getModels("cursor").map((model) => model.id), ["account-model"]);

    const refreshedAgain = await refreshCursorProviderModels(
      runtime,
      AbortSignal.timeout(1_000),
      async () => [{
        id: "updated-account-model",
        name: "Updated Account Model",
        reasoning: false,
        contextWindow: 200_000,
        maxTokens: 64_000,
      }],
    );
    assert.equal(refreshedAgain, true);
    assert.deepEqual(
      runtime.getModels("cursor").map((model) => model.id),
      ["updated-account-model"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Next.js instrumentation no longer patches ModelRuntime", async () => {
  const source = await readFile(new URL("../../instrumentation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Cursor|ModelRuntime/);
});

test("the models route uses the neutral app model runtime hooks", async () => {
  const source = await readFile(new URL("../../app/api/models/route.ts", import.meta.url), "utf8");
  assert.match(source, /getAppModelExtensions\(\)/);
  assert.match(source, /refreshAppModelCatalogs\(/);
  assert.doesNotMatch(source, /cursor-provider|CURSOR_/);
});

test("the model test route uses the neutral catalog refresh hook", async () => {
  const source = await readFile(new URL("../../app/api/models-config/test/route.ts", import.meta.url), "utf8");
  assert.match(source, /refreshAppModelCatalogs\(modelRuntime, providerName\)/);
  assert.doesNotMatch(source, /cursor-provider|CURSOR_/);
});

test("clears Cursor conversation state when leaving or entering the provider", async () => {
  const source = await readFile(new URL("./register.ts", import.meta.url), "utf8");
  assert.match(source, /pi\.on\("model_select"/);
  assert.match(source, /leftCursor !== enteredCursor/);
  assert.match(source, /event\.source === "restore"/);
});

test("session title requests are stateless", async () => {
  const source = await readFile(new URL("../session-title.ts", import.meta.url), "utf8");
  assert.match(source, /sessionId: undefined/);
  assert.doesNotMatch(source, /pi_session_id|titleSessionId/);
});

test("bootstraps cached Cursor models and streams directly", async () => {
  const source = await readFile(new URL("./register.ts", import.meta.url), "utf8");
  assert.match(source, /accountCacheKey\(/);
  assert.match(source, /loadCachedModels\(accountCacheKey/);
  assert.match(source, /readStoredCursorAccessToken/);
  assert.match(source, /streamSimple: streamCursor/);
  assert.match(source, /return credentials\.access/);
  assert.doesNotMatch(source, /startProxy|CURSOR_PROXY_API_KEY|__piCursorAccessToken/);
});

test("reads a stored Cursor OAuth access token for cold-start cache keys", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const { readStoredCursorAccessToken } = await jiti.import("./register.ts");
  const dir = await mkdtemp(join(tmpdir(), "pi-cursor-auth-"));
  const authPath = join(dir, "auth.json");
  try {
    const access = `hdr.${Buffer.from(JSON.stringify({ sub: "user-cold" })).toString("base64url")}.sig`;
    await writeFile(authPath, JSON.stringify({ cursor: { type: "oauth", access, refresh: "r" } }));
    assert.equal(readStoredCursorAccessToken(authPath), access);
    assert.equal(readStoredCursorAccessToken(join(dir, "missing.json")), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
