import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const { GET, PUT } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { getAvatarConfigPath, readAvatarConfig } = await jiti.import(
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

function makePutRequest(cwd, body) {
  return new Request("http://localhost/api/avatars", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, ...body }),
  });
}

const SAMPLE_USER = "data:image/png;base64,dXNlcg==";
const SAMPLE_ASSISTANT = "data:image/jpeg;base64,YXNz";
const SAMPLE_TOOL = "data:image/webp;base64,dG9vbA==";

// GET tests ---

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
    JSON.stringify({ user: SAMPLE_USER }),
    "utf8",
  );

  const response = await GET(
    new Request(`http://localhost/api/avatars?cwd=${encodeURIComponent(cwd)}`),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await getJson(response), {
    user: SAMPLE_USER,
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

// PUT tests ---

test("PUT writes a complete three-role record to the project avatars.json", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);

  const response = await PUT(
    makePutRequest(cwd, {
      user: SAMPLE_USER,
      assistant: SAMPLE_ASSISTANT,
      tool: SAMPLE_TOOL,
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await getJson(response), {
    user: SAMPLE_USER,
    assistant: SAMPLE_ASSISTANT,
    tool: SAMPLE_TOOL,
  });
  assert.deepEqual(readAvatarConfig(cwd), {
    user: SAMPLE_USER,
    assistant: SAMPLE_ASSISTANT,
    tool: SAMPLE_TOOL,
  });
  // Confirm the on-disk JSON is human-readable.
  const onDisk = JSON.parse(readFileSync(getAvatarConfigPath(cwd), "utf8"));
  assert.deepEqual(onDisk, {
    user: SAMPLE_USER,
    assistant: SAMPLE_ASSISTANT,
    tool: SAMPLE_TOOL,
  });
});

test("PUT preserves existing role values for roles not in the body", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    getAvatarConfigPath(cwd),
    JSON.stringify({
      user: SAMPLE_USER,
      assistant: SAMPLE_ASSISTANT,
      tool: SAMPLE_TOOL,
    }),
    "utf8",
  );

  // Update only the assistant slot.
  const response = await PUT(
    makePutRequest(cwd, { assistant: SAMPLE_USER }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await getJson(response), {
    user: SAMPLE_USER,
    assistant: SAMPLE_USER,
    tool: SAMPLE_TOOL,
  });
});

test("PUT allows null to clear a role while preserving the others", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    getAvatarConfigPath(cwd),
    JSON.stringify({
      user: SAMPLE_USER,
      assistant: SAMPLE_ASSISTANT,
      tool: SAMPLE_TOOL,
    }),
    "utf8",
  );

  const response = await PUT(
    makePutRequest(cwd, { assistant: null }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await getJson(response), {
    user: SAMPLE_USER,
    assistant: null,
    tool: SAMPLE_TOOL,
  });
});

test("PUT rejects an unsupported MIME with a 400 mentioning the role", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);

  const response = await PUT(
    makePutRequest(cwd, { user: "data:image/svg+xml;base64,PHN2Zy8+" }),
  );

  assert.equal(response.status, 400);
  const body = await getJson(response);
  assert.match(body.error, /user/);
});

test("PUT rejects a missing cwd", async () => {
  const response = await PUT(
    new Request("http://localhost/api/avatars", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: SAMPLE_USER, assistant: null, tool: null }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await getJson(response), { error: "cwd is required" });
});

test("PUT rejects a cwd outside the allowed roots", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);

  const response = await PUT(
    makePutRequest(cwd, { user: SAMPLE_USER, assistant: null, tool: null }),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await getJson(response), { error: "Access denied" });
});

test("PUT rejects non-JSON and non-object bodies with a 400", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);

  const badJsonResponse = await PUT(
    new Request("http://localhost/api/avatars", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    }),
  );
  assert.equal(badJsonResponse.status, 400);

  const arrayResponse = await PUT(
    new Request("http://localhost/api/avatars", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([SAMPLE_USER]),
    }),
  );
  assert.equal(arrayResponse.status, 400);
});

test("PUT does not write the file when validation fails", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);

  const response = await PUT(
    makePutRequest(cwd, { user: "not-a-data-url", assistant: null, tool: null }),
  );

  assert.equal(response.status, 400);
  // No avatar file should have been created.
  assert.equal(
    (await import("node:fs")).existsSync(getAvatarConfigPath(cwd)),
    false,
  );
});