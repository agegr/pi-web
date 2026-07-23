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

test("PUT clears one role while preserving the other custom roles", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  await PUT(makePutRequest(cwd, {
    user: SAMPLE_USER,
    assistant: SAMPLE_ASSISTANT,
    tool: SAMPLE_TOOL,
  }));

  const response = await PUT(makePutRequest(cwd, { user: null }));
  assert.equal(response.status, 200);
  assert.deepEqual(await getJson(response), {
    user: null,
    assistant: SAMPLE_ASSISTANT,
    tool: SAMPLE_TOOL,
  });
  assert.deepEqual(readAvatarConfig(cwd), {
    user: null,
    assistant: SAMPLE_ASSISTANT,
    tool: SAMPLE_TOOL,
  });
});

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

// --- ticket #5: oversized payload, project isolation, saved-state untouched ---

test("PUT rejects a role whose data URL exceeds the 2 MB encoded limit", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const huge = "data:image/png;base64," + "A".repeat(3 * 1024 * 1024);

  const response = await PUT(
    makePutRequest(cwd, { user: huge, assistant: null, tool: null }),
  );

  assert.equal(response.status, 400);
  const body = await getJson(response);
  assert.match(body.error, /exceeds|2097152/);
  // The on-disk file must not have been written.
  assert.equal(
    (await import("node:fs")).existsSync(getAvatarConfigPath(cwd)),
    false,
  );
});

test("PUT merges with existing valid roles and still rejects an oversized one", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  // Seed a valid user avatar via the same API.
  await PUT(makePutRequest(cwd, {
    user: SAMPLE_USER,
    assistant: null,
    tool: null,
  }));

  const huge = "data:image/png;base64," + "A".repeat(3 * 1024 * 1024);
  const response = await PUT(
    makePutRequest(cwd, { assistant: huge }),
  );

  assert.equal(response.status, 400);
  assert.match((await getJson(response)).error, /exceeds/);
  // The previously saved user avatar must remain intact on disk.
  assert.deepEqual(readAvatarConfig(cwd), {
    user: SAMPLE_USER,
    assistant: null,
    tool: null,
  });
});

test("Project A and Project B do not share avatar config", async (t) => {
  resetAllowedRoots();
  const projectA = createProject(t);
  const projectB = createProject(t);
  allowFileRoot(projectA);
  allowFileRoot(projectB);

  // Write a complete three-role config into project A.
  const writeA = await PUT(
    makePutRequest(projectA, {
      user: SAMPLE_USER,
      assistant: SAMPLE_ASSISTANT,
      tool: SAMPLE_TOOL,
    }),
  );
  assert.equal(writeA.status, 200);

  // Project B must still read the default all-null record even though both
  // roots are allowed.
  const readB = await GET(
    new Request(`http://localhost/api/avatars?cwd=${encodeURIComponent(projectB)}`),
  );
  assert.equal(readB.status, 200);
  assert.deepEqual(await getJson(readB), {
    user: null,
    assistant: null,
    tool: null,
  });

  // And project A must still see its own saved record.
  const readA = await GET(
    new Request(`http://localhost/api/avatars?cwd=${encodeURIComponent(projectA)}`),
  );
  assert.equal(readA.status, 200);
  assert.deepEqual(await getJson(readA), {
    user: SAMPLE_USER,
    assistant: SAMPLE_ASSISTANT,
    tool: SAMPLE_TOOL,
  });

  // The on-disk files must live under each project's own .pi directory.
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  assert.equal(existsSync(getAvatarConfigPath(projectA)), true);
  assert.equal(existsSync(getAvatarConfigPath(projectB)), false);
  assert.equal(existsSync(join(projectB, ".pi")), false);
});

test("GET returns an explicit project cwd's avatars.json without leaking data from other roots", async (t) => {
  resetAllowedRoots();
  const projectA = createProject(t);
  const projectB = createProject(t);
  allowFileRoot(projectA);
  allowFileRoot(projectB);
  await PUT(makePutRequest(projectA, { user: SAMPLE_USER, assistant: null, tool: null }));

  // Reading without a cwd still fails.
  const noCwd = await GET(new Request("http://localhost/api/avatars"));
  assert.equal(noCwd.status, 400);

  // Reading with a cwd outside the allowed set still fails.
  const outside = createProject(t);
  const denied = await GET(
    new Request(`http://localhost/api/avatars?cwd=${encodeURIComponent(outside)}`),
  );
  assert.equal(denied.status, 403);

  // Reading with project A's cwd returns A's data; project B's cwd is empty.
  const readA = await GET(
    new Request(`http://localhost/api/avatars?cwd=${encodeURIComponent(projectA)}`),
  );
  const readB = await GET(
    new Request(`http://localhost/api/avatars?cwd=${encodeURIComponent(projectB)}`),
  );
  assert.deepEqual(await getJson(readA), {
    user: SAMPLE_USER,
    assistant: null,
    tool: null,
  });
  assert.deepEqual(await getJson(readB), {
    user: null,
    assistant: null,
    tool: null,
  });
});
