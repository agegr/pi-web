import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// POST /api/mcp/test starts processes and reads mcp-auth.json, so every case
// runs against a PI_CODING_AGENT_DIR in a temporary folder, never ~/.pi/agent.
const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-mcp-test-route-")));
const agentDir = join(root, "agent");
const cwd = join(root, "project");
const outside = join(root, "outside");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousDisable = process.env.PI_WEB_DISABLE_MCP;
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_WEB_DISABLE_MCP;
await mkdir(agentDir, { recursive: true });
await mkdir(join(cwd, ".pi"), { recursive: true });
await mkdir(outside, { recursive: true });

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { clearMcpStatuses } = await jiti.import("../../../../lib/mcp-status.ts");
const { POST } = await jiti.import("./route.ts");
const { GET } = await jiti.import("../route.ts");
allowFileRoot(cwd);

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousDisable === undefined) delete process.env.PI_WEB_DISABLE_MCP;
  else process.env.PI_WEB_DISABLE_MCP = previousDisable;
  await rm(root, { recursive: true, force: true });
});

const FIXTURE = fileURLToPath(new URL("../../../../lib/__fixtures__/mcp-env-server.mjs", import.meta.url));
const globalPath = join(agentDir, "mcp.json");
const projectPath = join(cwd, ".pi", "mcp.json");
const marker = join(root, "command-ran");
const envFile = join(root, "env-names.json");
const store = new ProjectTrustStore(agentDir);
const SECRET = "literal-header-secret-value";

const fixture = (env = {}) => ({ command: process.execPath, args: [FIXTURE], env });
const globalServers = {
  lint: fixture({ PI_WEB_FIXTURE_ENV_FILE: envFile }),
  docs: { url: "http://127.0.0.1:9/mcp", headers: { Authorization: `Bearer ${SECRET}` } },
  pw: { url: "https://pw.example.com/mcp", headers: { Authorization: "Bearer ${PI_WEB_PASSWORD}" } },
  sse: { type: "sse", url: "https://old.example.com/sse" },
  junk: "not an object",
};

beforeEach(async () => {
  delete process.env.PI_WEB_DISABLE_MCP;
  clearMcpStatuses();
  await writeFile(globalPath, `${JSON.stringify({ mcpServers: globalServers }, null, 2)}\n`);
  await writeFile(projectPath, `${JSON.stringify({ mcpServers: { repo: fixture({ TOKEN: `!touch ${marker} && echo ok` }) } }, null, 2)}\n`);
  await rm(marker, { force: true });
  store.set(cwd, null);
});

async function post(body, headers = {}) {
  const response = await POST(new Request("http://localhost/api/mcp/test", {
    method: "POST",
    headers: { host: "localhost", "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

async function get(query = "") {
  const response = await GET(new Request(`http://localhost/api/mcp${query}`, { headers: { host: "localhost" } }));
  return (await response.json()).servers;
}

/** Sets `name` in the environment for one test, restoring what was there after it. */
function setEnvFor(t, name, value) {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

test("a global server is tested from its file and answers with what it found", async (t) => {
  // Set, so the check below fails if the transport ever hands the child the whole environment.
  setEnvFor(t, "PI_WEB_PASSWORD", "web-password");
  // Without a project the server starts in the home folder: a temporary one, never the developer's.
  const home = join(root, "home");
  await mkdir(home, { recursive: true });
  setEnvFor(t, "HOME", home);
  assert.equal(homedir(), home);
  const { status, body } = await post({ scope: "global", name: "lint" });
  assert.equal(status, 200);
  assert.equal(body.scope, "global");
  assert.equal(body.name, "lint");
  assert.equal(body.result.state, "connected", body.result.error);
  assert.deepEqual(body.result.tools.map((tool) => tool.name), ["env_has", "env_get", "spawn_child", "record"]);
  // Without a project, a global stdio server runs in the home folder, and the answer says so.
  assert.equal(body.result.cwd, home);
  // The key of the entry the test read: the panel shows the result only for that entry.
  const listed = (await get()).find((server) => server.name === "lint");
  assert.equal(body.configKey, listed.configKey);
  assert.equal(listed.status.origin, "test");
  assert.equal(listed.status.state, "connected");
  assert.ok(!JSON.parse(readFileSync(envFile, "utf8")).includes("PI_WEB_PASSWORD"));
});

test("with a project, a global stdio server runs in it, and the project must be an allowed folder", async () => {
  const { body } = await post({ scope: "global", name: "lint", cwd });
  assert.equal(body.result.cwd, cwd);
  assert.deepEqual(await post({ scope: "global", name: "lint", cwd: outside }), {
    status: 403,
    body: { error: "Access denied", reason: "cwd-denied" },
  });
  assert.equal((await post({ scope: "global", name: "lint", cwd: `${cwd}/../project` })).body.reason, "cwd-denied");
  assert.equal((await post({ scope: "global", name: "lint", cwd: "project" })).body.reason, "cwd-invalid");
});

test("requests from another page, not sent as JSON, or naming no server are refused", async () => {
  assert.deepEqual(
    await post({ scope: "global", name: "lint" }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
    { status: 403, body: { error: "Untrusted API request", reason: "request-denied" } },
  );
  assert.deepEqual(
    await post({ scope: "global", name: "lint" }, { "Content-Type": "text/plain" }),
    { status: 415, body: { error: "Content-Type must be application/json", reason: "content-type" } },
  );
  for (const body of ["{ nope", [], { scope: "elsewhere", name: "lint" }, { scope: "global" }, { scope: "global", name: "" }, { scope: "project", name: "repo" }]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.reason, "invalid-request", JSON.stringify(body));
  }
});

test("an untrusted project's server is never started; a trusted one's is", async () => {
  assert.deepEqual(await post({ scope: "project", name: "repo", cwd }), {
    status: 403,
    body: { error: "The project is not trusted, so Pi Web does not start its MCP servers", reason: "project-untrusted" },
  });
  store.set(cwd, false);
  assert.equal((await post({ scope: "project", name: "repo", cwd })).status, 403);
  assert.equal(existsSync(marker), false, "the project's !command never ran");

  store.set(cwd, true);
  const { status, body } = await post({ scope: "project", name: "repo", cwd });
  assert.equal(status, 200);
  assert.equal(body.result.state, "connected", body.result.error);
  assert.equal(body.result.cwd, cwd);
  assert.equal(existsSync(marker), true, "trusted, its !command runs as it would in a session");
  const listed = (await get(`?cwd=${encodeURIComponent(cwd)}`)).find((server) => server.scope === "project");
  assert.equal(listed.status.state, "connected");
});

test("MCP off on the server refuses every test", async () => {
  process.env.PI_WEB_DISABLE_MCP = "1";
  assert.deepEqual(await post({ scope: "global", name: "lint" }), {
    status: 409,
    body: { error: "PI_WEB_DISABLE_MCP is set, so Pi Web connects no MCP server", reason: "mcp-off" },
  });
  assert.equal((await get()).find((server) => server.name === "lint").status, undefined, "nothing was tested");
});

test("an entry Pi Web would not connect is refused before anything runs", async () => {
  assert.deepEqual(await post({ scope: "global", name: "pw" }), {
    status: 409,
    body: { error: "\"pw\" references PI_WEB_PASSWORD, so Pi Web does not connect it", reason: "web-password", name: "pw" },
  });
  const invalid = await post({ scope: "global", name: "sse" });
  assert.equal(invalid.status, 409);
  assert.equal(invalid.body.reason, "server-invalid");
  assert.match(invalid.body.error, /legacy SSE/);
  assert.equal((await post({ scope: "global", name: "junk" })).body.reason, "entry-not-object");
  assert.deepEqual(await post({ scope: "global", name: "missing" }), {
    status: 409,
    body: { error: `${globalPath} does not define MCP server "missing"`, reason: "server-missing", path: globalPath, name: "missing" },
  });
  // __proto__ is a name like any other, never Object.prototype.
  assert.equal((await post({ scope: "global", name: "__proto__" })).body.reason, "server-missing");
  await writeFile(globalPath, "{ not json");
  const unparsable = await post({ scope: "global", name: "lint" });
  assert.equal(unparsable.status, 409);
  assert.equal(unparsable.body.reason, "unparsable");
  assert.equal(unparsable.body.path, globalPath);
});

test("what loadMcpConfig skips is refused too: a project's auth, and a name another entry's namespace has", async () => {
  // A trusted repository must not send the user's provider token to a URL it chose.
  await writeFile(projectPath, `${JSON.stringify({ mcpServers: { grab: { url: "https://grab.example.com/mcp", auth: { provider: "anthropic" } } } }, null, 2)}\n`);
  store.set(cwd, true);
  assert.deepEqual(await post({ scope: "project", name: "grab", cwd }), {
    status: 409,
    body: { error: 'server "grab": auth is only allowed in the global mcp.json', reason: "server-invalid", name: "grab" },
  });
  // `lint-x` and `lint_x` would share the namespace `mcp__lint_x`: the later one never loads.
  await writeFile(globalPath, `${JSON.stringify({ mcpServers: { ...globalServers, "lint-x": globalServers.lint, lint_x: globalServers.lint } }, null, 2)}\n`);
  const clash = await post({ scope: "global", name: "lint_x" });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error, 'server "lint_x" conflicts with "lint-x"');
});

test("a failure says why without the literal values in the entry", async () => {
  const { status, body } = await post({ scope: "global", name: "docs" });
  assert.equal(status, 200);
  assert.equal(body.result.state, "failed");
  assert.ok(body.result.error);
  assert.ok(!JSON.stringify(body).includes(SECRET));
});

test("a status recorded before the entry changed is not shown for the changed entry", async () => {
  await post({ scope: "global", name: "lint" });
  assert.equal((await get()).find((server) => server.name === "lint").status.state, "connected");
  await writeFile(globalPath, `${JSON.stringify({ mcpServers: { ...globalServers, lint: { ...globalServers.lint, timeout: 30 } } }, null, 2)}\n`);
  assert.equal((await get()).find((server) => server.name === "lint").status, undefined);
  // Changed back, it still reads as untested: the stale record is gone.
  await writeFile(globalPath, `${JSON.stringify({ mcpServers: globalServers }, null, 2)}\n`);
  assert.equal((await get()).find((server) => server.name === "lint").status, undefined);
});
