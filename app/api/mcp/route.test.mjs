import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(), "pi-web-mcp-route-"));
const agentDir = join(root, "agent");
const trustedCwd = join(root, "trusted-project");
// A project with `.pi/extensions` requires trust, so it stays untrusted until a
// decision is recorded — exactly the case the route must refuse to edit.
const untrustedCwd = join(root, "untrusted-project");

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

await mkdir(agentDir, { recursive: true });
await mkdir(trustedCwd, { recursive: true });
await mkdir(join(untrustedCwd, ".pi", "extensions"), { recursive: true });
await writeFile(join(untrustedCwd, ".pi", "extensions", "keep.ts"), "export default () => {};\n");

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { GET, POST } = await jiti.import("./route.ts");

allowFileRoot(trustedCwd);
allowFileRoot(untrustedCwd);

const globalPath = join(agentDir, "mcp.json");

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

// Node's Request does not derive the Host header from the URL, so routes that
// run isApiRequestAllowed need it set explicitly.
function getRequest(cwd) {
  return new Request(`http://localhost/api/mcp?cwd=${encodeURIComponent(cwd)}`, {
    headers: { host: "localhost" },
  });
}

function postRequest(body, headers = {}) {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { host: "localhost", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("GET requires a cwd", async () => {
  const response = await GET(new Request("http://localhost/api/mcp"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "cwd required");
});

test("GET rejects a cwd outside the allowed roots", async () => {
  const response = await GET(getRequest(join(root, "elsewhere")));
  assert.equal(response.status, 403);
});

test("GET lists configured servers", async () => {
  await writeFile(globalPath, JSON.stringify({
    mcpServers: { filesystem: { command: "npx", args: ["-y", "fs"] } },
  }));

  const response = await GET(getRequest(trustedCwd));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.servers.map((server) => [server.name, server.scope]), [["filesystem", "global"]]);
  assert.deepEqual(body.diagnostics, []);
  assert.equal(body.projectResourcesLoaded, true);
});

test("GET reports an untrusted project", async () => {
  const response = await GET(getRequest(untrustedCwd));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.projectResourcesLoaded, false);
});

test("GET surfaces config diagnostics", async () => {
  await writeFile(globalPath, "{ broken");
  const response = await GET(getRequest(trustedCwd));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.diagnostics.length, 1);
  assert.equal(body.diagnostics[0].path, globalPath);
  await rm(globalPath, { force: true });
});

test("POST rejects a non-JSON content type", async () => {
  const response = await POST(new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { host: "localhost", "Content-Type": "text/plain" },
    body: "{}",
  }));
  assert.equal(response.status, 415);
});

test("POST rejects a cross-site request", async () => {
  const response = await POST(postRequest(
    { action: "save", cwd: trustedCwd, name: "x", config: { command: "x" } },
    { "sec-fetch-site": "cross-site" },
  ));
  assert.equal(response.status, 403);
});

test("POST requires an action", async () => {
  const response = await POST(postRequest({ cwd: trustedCwd }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "action required");
});

test("POST rejects an unknown action", async () => {
  const response = await POST(postRequest({ action: "explode", cwd: trustedCwd, name: "x" }));
  assert.equal(response.status, 400);
});

test("POST rejects an invalid server name", async () => {
  const response = await POST(postRequest({
    action: "save",
    cwd: trustedCwd,
    name: "has space",
    config: { command: "x" },
  }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /letters/);
});

test("POST rejects a config with no transport", async () => {
  const response = await POST(postRequest({
    action: "save",
    cwd: trustedCwd,
    name: "nothing",
    config: {},
  }));
  assert.equal(response.status, 400);
});

test("POST saves a server and returns the refreshed snapshot", async () => {
  await rm(globalPath, { force: true });
  const response = await POST(postRequest({
    action: "save",
    cwd: trustedCwd,
    scope: "global",
    name: "filesystem",
    config: { command: "npx", args: ["-y", "fs"] },
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.servers.map((server) => server.name), ["filesystem"]);

  const written = JSON.parse(await readFile(globalPath, "utf8"));
  assert.deepEqual(written.mcpServers.filesystem, { command: "npx", args: ["-y", "fs"] });
});

test("POST saves into the project file", async () => {
  const response = await POST(postRequest({
    action: "save",
    cwd: trustedCwd,
    scope: "project",
    name: "repo",
    config: { command: "node", args: ["server.mjs"] },
  }));

  assert.equal(response.status, 200);
  const written = JSON.parse(await readFile(join(trustedCwd, ".pi", "mcp.json"), "utf8"));
  assert.deepEqual(written.mcpServers.repo, { command: "node", args: ["server.mjs"] });
  await rm(join(trustedCwd, ".pi"), { recursive: true, force: true });
});

test("POST refuses to edit project servers while the project is untrusted", async () => {
  const response = await POST(postRequest({
    action: "save",
    cwd: untrustedCwd,
    scope: "project",
    name: "evil",
    config: { command: "node", args: ["payload.mjs"] },
  }));

  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /trusted/);
  // Nothing may have been written for that project.
  const snapshot = await GET(getRequest(untrustedCwd));
  const body = await snapshot.json();
  assert.deepEqual(body.servers.filter((server) => server.scope === "project"), []);
  await assert.rejects(readFile(join(untrustedCwd, ".pi", "mcp.json"), "utf8"));
});

test("POST still allows a global save for an untrusted project", async () => {
  await rm(globalPath, { force: true });
  const response = await POST(postRequest({
    action: "save",
    cwd: untrustedCwd,
    scope: "global",
    name: "shared",
    config: { command: "npx" },
  }));

  assert.equal(response.status, 200);
  const written = JSON.parse(await readFile(globalPath, "utf8"));
  assert.deepEqual(Object.keys(written.mcpServers), ["shared"]);
});

test("POST reports a missing server on remove", async () => {
  const response = await POST(postRequest({
    action: "remove",
    cwd: trustedCwd,
    scope: "global",
    name: "absent",
  }));
  assert.equal(response.status, 404);
});

test("POST removes a server", async () => {
  await writeFile(globalPath, JSON.stringify({
    mcpServers: { a: { command: "a" }, b: { command: "b" } },
  }));

  const response = await POST(postRequest({
    action: "remove",
    cwd: trustedCwd,
    scope: "global",
    name: "a",
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.servers.map((server) => server.name), ["b"]);
});
