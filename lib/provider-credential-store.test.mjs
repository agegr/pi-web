import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import lockfile from "proper-lockfile";

const { removeStoredCredentialIfType } = await createJiti(import.meta.url)
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

test("missing credentials are a successful no-op", async () => {
  await withAuthFile({}, async (authPath) => {
    assert.deepEqual(
      await removeStoredCredentialIfType("anthropic", "oauth", authPath),
      { status: "not_found" },
    );
    assert.deepEqual(await readAuthFile(authPath), {});
  });
});
