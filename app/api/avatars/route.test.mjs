import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { getAvatarConfigPath } = await jiti.import(
  "../../../lib/avatar-config.server.ts",
);

function createProject(t) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-avatar-route-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

async function getJson(response) {
  return await response.json();
}

function resetAllowedRoots() {
  globalThis.__piAdditionalAllowedRoots = new Set();
  globalThis.__piAllowedRootsCache = {
    roots: new Set(),
    expiresAt: Date.now() + 60_000,
  };
}

test("GET returns a null-backed avatar config for an allowed project with no file", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);

  const response = await GET(
    new Request(`http://localhost/api/avatars?cwd=${encodeURIComponent(cwd)}`),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await getJson(response), {
    user: null,
    assistant: null,
    tool: null,
  });
});

test("GET reads valid keys from an allowed project avatar file", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    getAvatarConfigPath(cwd),
    JSON.stringify({ user: "data:image/png;base64,dXNlcg==" }),
    "utf8",
  );

  const response = await GET(
    new Request(`http://localhost/api/avatars?cwd=${encodeURIComponent(cwd)}`),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await getJson(response), {
    user: "data:image/png;base64,dXNlcg==",
    assistant: null,
    tool: null,
  });
});

test("GET rejects a missing cwd", async () => {
  const response = await GET(new Request("http://localhost/api/avatars"));

  assert.equal(response.status, 400);
  assert.deepEqual(await getJson(response), { error: "cwd is required" });
});

test("GET rejects a relative cwd", async () => {
  const response = await GET(new Request("http://localhost/api/avatars?cwd=relative"));

  assert.equal(response.status, 400);
  assert.deepEqual(await getJson(response), { error: "cwd must be an absolute path" });
});

test("GET rejects an absolute cwd outside allowed roots", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);

  const response = await GET(
    new Request(`http://localhost/api/avatars?cwd=${encodeURIComponent(cwd)}`),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await getJson(response), { error: "Access denied" });
});
