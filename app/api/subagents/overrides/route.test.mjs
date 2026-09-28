import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-subagent-overrides-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { PUT } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");

const settingsPath = join(testAgentDir, "settings.json");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

async function allowedCwd(t) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-overrides-cwd-"));
  allowFileRoot(cwd);
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return cwd;
}

function jsonRequest(body, headers = {}) {
  return new Request("http://localhost/api/subagents/overrides", {
    method: "PUT",
    headers: { host: "localhost", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("overrides PUT disables then re-enables an agent and prunes on enable", async (t) => {
  const cwd = await allowedCwd(t);
  await writeFile(settingsPath, JSON.stringify({ theme: "dark" }, null, 2));

  let response = await PUT(jsonRequest({ cwd, name: "reviewer", disabled: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    theme: "dark",
    subagents: { agentOverrides: { reviewer: { disabled: true } } },
  });

  response = await PUT(jsonRequest({ cwd, name: "reviewer", disabled: false }));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { theme: "dark" });
});

test("overrides PUT rejects missing cwd, bad names, and non-boolean disabled", async (t) => {
  const cwd = await allowedCwd(t);

  let response = await PUT(jsonRequest({ name: "reviewer", disabled: true }));
  assert.equal(response.status, 400);

  response = await PUT(jsonRequest({ cwd, name: "../escape", disabled: true }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Valid agent name required" });

  response = await PUT(jsonRequest({ cwd, name: "reviewer", disabled: "yes" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "disabled must be a boolean" });
});

test("overrides PUT returns 403 for an existing but unallowed cwd", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-overrides-unallowed-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const response = await PUT(jsonRequest({ cwd, name: "reviewer", disabled: true }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Access denied" });
});

test("overrides PUT rejects cross-site and non-JSON requests", async (t) => {
  const cwd = await allowedCwd(t);

  let response = await PUT(jsonRequest(
    { cwd, name: "reviewer", disabled: true },
    { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
  ));
  assert.equal(response.status, 403);

  response = await PUT(new Request("http://localhost/api/subagents/overrides", {
    method: "PUT",
    headers: { host: "localhost", "Content-Type": "text/plain" },
    body: JSON.stringify({ cwd, name: "reviewer", disabled: true }),
  }));
  assert.equal(response.status, 415);
});
