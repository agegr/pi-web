import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import lockfile from "proper-lockfile";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const { removeStoredCredentialIfType, storeProviderCredential } = await createJiti(import.meta.url)
  .import("./provider-credential-store.ts");

async function withAuthFile(data, run) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-provider-auth-"));
  const authPath = join(dir, "auth.json");
  await writeFile(authPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    await run(authPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readAuthFile(authPath) {
  return JSON.parse(await readFile(authPath, "utf-8"));
}

test("removes only the expected credential type and preserves other providers", async () => {
  await withAuthFile({
    anthropic: { type: "api_key", key: "secret" },
    openai: { type: "api_key", key: "other" },
  }, async (authPath) => {
    assert.deepEqual(
      await removeStoredCredentialIfType("anthropic", "api_key", authPath),
      { status: "removed" },
    );
    assert.deepEqual(await readAuthFile(authPath), {
      openai: { type: "api_key", key: "other" },
    });
  });
});

test("stores a provider credential while preserving other providers", async () => {
  await withAuthFile({
    anthropic: { type: "oauth", access: "old-token" },
    openai: { type: "api_key", key: "other" },
  }, async (authPath) => {
    await storeProviderCredential(
      "anthropic",
      { type: "api_key", key: "replacement" },
      authPath,
    );

    assert.deepEqual(await readAuthFile(authPath), {
      anthropic: { type: "api_key", key: "replacement" },
      openai: { type: "api_key", key: "other" },
    });
  });
});

test("a stale API-key delete cannot remove a newly stored OAuth credential", async () => {
  await withAuthFile({
    anthropic: { type: "api_key", key: "old" },
  }, async (authPath) => {
    const release = await lockfile.lock(authPath, { stale: 30_000 });
    const removal = removeStoredCredentialIfType("anthropic", "api_key", authPath);

    await writeFile(authPath, JSON.stringify({
      anthropic: { type: "oauth", access: "new-token", expires: Date.now() + 60_000 },
    }, null, 2), { mode: 0o600 });
    await release();

    assert.deepEqual(await removal, {
      status: "type_mismatch",
      storedType: "oauth",
    });
    assert.equal((await readAuthFile(authPath)).anthropic.access, "new-token");
  });
});

test("an auth.json pi reads, with a byte-order mark or empty, is read the same way", async () => {
  // Windows PowerShell 5.1's `-Encoding utf8` and Notepad's "UTF-8 with BOM" write the mark.
  for (const [label, content, expectedBefore] of [
    ["BOM", `﻿${JSON.stringify({ openai: { type: "api_key", key: "kept" } })}`, [{ providerId: "openai", type: "api_key" }]],
    ["empty", "", []],
  ]) {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-provider-auth-bom-"));
    const authPath = join(dir, "auth.json");
    try {
      await writeFile(authPath, content, { mode: 0o600 });
      // pi itself reads this file without complaint.
      assert.deepEqual(await (await ModelRuntime.create({ authPath, modelsPath: null })).listCredentials(), expectedBefore, label);

      await storeProviderCredential("anthropic", { type: "api_key", key: "new" }, authPath);
      assert.equal((await readAuthFile(authPath)).anthropic.key, "new", label);
      assert.deepEqual(
        await removeStoredCredentialIfType("anthropic", "api_key", authPath),
        { status: "removed" },
        label,
      );
      const after = await readAuthFile(authPath);
      assert.equal(after.anthropic, undefined, label);
      if (label === "BOM") assert.equal(after.openai.key, "kept");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("missing credentials are a successful no-op", async () => {
  await withAuthFile({}, async (authPath) => {
    assert.deepEqual(
      await removeStoredCredentialIfType("anthropic", "oauth", authPath),
      { status: "not_found" },
    );
    assert.deepEqual(await readAuthFile(authPath), {});
  });
});

test("saving and removing an API key updates the SDK authentication status", async () => {
  await withAuthFile({}, async (authPath) => {
    const providerId = "pi-web-auth-status-test";

    await storeProviderCredential(
      providerId,
      { type: "api_key", key: "test-secret" },
      authPath,
    );
    let runtime = await ModelRuntime.create({ authPath, modelsPath: null });
    assert.deepEqual(runtime.getProviderAuthStatus(providerId), {
      configured: true,
      source: "stored",
    });
    assert.deepEqual(await runtime.listCredentials(), [
      { providerId, type: "api_key" },
    ]);

    await storeProviderCredential(
      providerId,
      { type: "api_key", key: "replacement-secret" },
      authPath,
    );
    runtime = await ModelRuntime.create({ authPath, modelsPath: null });
    assert.equal(runtime.getProviderAuthStatus(providerId).configured, true);
    assert.equal((await readAuthFile(authPath))[providerId].key, "replacement-secret");

    assert.deepEqual(
      await removeStoredCredentialIfType(providerId, "api_key", authPath),
      { status: "removed" },
    );
    runtime = await ModelRuntime.create({ authPath, modelsPath: null });
    assert.deepEqual(runtime.getProviderAuthStatus(providerId), { configured: false });
    assert.deepEqual(await runtime.listCredentials(), []);
  });
});
