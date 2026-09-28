import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-subagent-eject-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

const BUILTIN = [
  "---",
  "name: reviewer",
  "description: Bundled reviewer",
  "thinking: high",
  "---",
  "Review the diff.",
  "",
].join("\n");

const builtinSourcePath = join(testAgentDir, "npm", "node_modules", "pi-subagents", "agents", "reviewer.md");

/**
 * A configured `npm:pi-subagents` install, so the catalog exposes a builtin row
 * for the eject route. `allowFileRoot` makes the cwd a valid request target.
 */
async function builtinFixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-eject-"));
  allowFileRoot(cwd);
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const root = join(testAgentDir, "npm", "node_modules", "pi-subagents");
  await mkdir(join(root, "agents"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "pi-subagents", version: "0.0.0" }, null, 2));
  await writeFile(builtinSourcePath, BUILTIN);
  await writeFile(join(testAgentDir, "settings.json"), JSON.stringify({ packages: ["npm:pi-subagents"] }, null, 2));
  return { cwd, sourcePath: builtinSourcePath };
}

/** A cwd holding a discoverable project agent, for the non-builtin rejection. */
async function projectFixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-eject-"));
  allowFileRoot(cwd);
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
  await writeFile(join(cwd, ".pi", "agents", "reviewer.md"), BUILTIN);
  return { cwd, sourcePath: join(cwd, ".pi", "agents", "reviewer.md") };
}

function jsonRequest(body, headers = {}) {
  return new Request("http://localhost/api/subagents/eject", {
    method: "POST",
    headers: { host: "localhost", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("eject copies a builtin catalog agent verbatim into the global agent dir", async (t) => {
  const { cwd, sourcePath } = await builtinFixture(t);
  const response = await POST(jsonRequest({ cwd, scope: "global", sourcePath }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.profile.scope, "global");
  assert.equal(body.profile.name, "reviewer");
  assert.equal(await readFile(join(testAgentDir, "agents", "reviewer.md"), "utf8"), BUILTIN);
  await rm(join(testAgentDir, "agents"), { recursive: true, force: true });
});

test("eject copies a builtin into the project scope with a custom name", async (t) => {
  const { cwd, sourcePath } = await builtinFixture(t);
  const response = await POST(jsonRequest({ cwd, scope: "project", sourcePath, name: "my-reviewer" }));
  assert.equal(response.status, 200);
  assert.equal(await readFile(join(cwd, ".pi", "agents", "my-reviewer.md"), "utf8"), BUILTIN);
});

test("eject returns 409 when the target file already exists", async (t) => {
  const { cwd, sourcePath } = await builtinFixture(t);
  await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
  await writeFile(join(cwd, ".pi", "agents", "reviewer.md"), "keep me\n");
  const response = await POST(jsonRequest({ cwd, scope: "project", sourcePath }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.match(body.error, /already exists/);
  assert.equal(body.path, join(cwd, ".pi", "agents", "reviewer.md"));
  assert.equal(await readFile(join(cwd, ".pi", "agents", "reviewer.md"), "utf8"), "keep me\n");
});

test("eject rejects a user or project scan-dir source as not a bundled agent", async (t) => {
  const { cwd, sourcePath } = await projectFixture(t);
  const response = await POST(jsonRequest({ cwd, scope: "global", sourcePath }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Only built-in and package agents can be duplicated/);
});

test("eject rejects a source outside the catalog and a missing source", async (t) => {
  const { cwd } = await builtinFixture(t);
  const outside = await mkdtemp(join(tmpdir(), "pi-web-subagent-eject-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "rogue.md"), BUILTIN);

  let response = await POST(jsonRequest({ cwd, scope: "global", sourcePath: join(outside, "rogue.md") }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /not a catalog agent file/);

  response = await POST(jsonRequest({ cwd, scope: "global", sourcePath: join(outside, "missing.md") }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /not found/);
});

test("eject validates required fields and the target name", async (t) => {
  const { cwd, sourcePath } = await builtinFixture(t);

  let response = await POST(jsonRequest({ cwd, scope: "global" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "sourcePath required" });

  response = await POST(jsonRequest({ cwd, scope: "workspace", sourcePath }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /scope must be global or project/);

  response = await POST(jsonRequest({ cwd, scope: "global", sourcePath, name: "../escape" }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Agent name may contain only/);
});

test("eject returns 403 for an unallowed cwd and rejects cross-site or non-JSON requests", async (t) => {
  const { sourcePath } = await builtinFixture(t);
  const unallowed = await mkdtemp(join(tmpdir(), "pi-web-subagent-eject-unallowed-"));
  t.after(() => rm(unallowed, { recursive: true, force: true }));

  let response = await POST(jsonRequest({ cwd: unallowed, scope: "global", sourcePath }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Access denied" });

  const { cwd } = await builtinFixture(t);
  response = await POST(jsonRequest(
    { cwd, scope: "global", sourcePath },
    { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
  ));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Untrusted API request" });

  response = await POST(new Request("http://localhost/api/subagents/eject", {
    method: "POST",
    headers: { host: "localhost", "Content-Type": "text/plain" },
    body: JSON.stringify({ cwd, scope: "global", sourcePath }),
  }));
  assert.equal(response.status, 415);
});
