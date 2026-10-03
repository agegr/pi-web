import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// POST /api/mcp writes the user's files, so every case runs against a
// PI_CODING_AGENT_DIR in a temporary folder, never the real ~/.pi/agent.
const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-mcp-write-route-")));
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
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { POST } = await jiti.import("./route.ts");
allowFileRoot(cwd);

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousDisable === undefined) delete process.env.PI_WEB_DISABLE_MCP;
  else process.env.PI_WEB_DISABLE_MCP = previousDisable;
  await rm(root, { recursive: true, force: true });
});

const globalPath = join(agentDir, "mcp.json");
const projectPath = join(cwd, ".pi", "mcp.json");
const store = new ProjectTrustStore(agentDir);
const SECRET = "literal-header-secret-value";

const globalText = `${JSON.stringify({
  mcpServers: {
    docs: { url: "https://docs.example.com/mcp", headers: { Authorization: `Bearer ${SECRET}` } },
    lint: { command: "npx", args: ["lint-mcp"] },
    pw: { url: "https://pw.example.com/mcp", headers: { Authorization: "Bearer ${PI_WEB_PASSWORD}" }, enabled: false },
  },
  keep: "unknown keys stay",
}, null, 2)}\n`;
const projectText = `${JSON.stringify({ mcpServers: { repo: { command: "node", args: ["server.js"] } } }, null, 2)}\n`;

beforeEach(async () => {
  delete process.env.PI_WEB_DISABLE_MCP;
  await writeFile(globalPath, globalText);
  await rm(projectPath, { force: true, recursive: true });
  await writeFile(projectPath, projectText);
  store.set(cwd, null);
});

async function post(body, headers = {}) {
  const response = await POST(new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { host: "localhost", "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const server = (body, scope, name) => body.servers.find((entry) => entry.scope === scope && entry.name === name);

test("a server is switched off and on in its file, and the answer is the overview after it", async () => {
  let { status, body } = await post({ action: "disable", scope: "global", name: "lint" });
  assert.equal(status, 200);
  assert.equal(server(body, "global", "lint").enabled, false);
  assert.ok(body.mcp && body.codemode && body.files, "the whole overview, as GET answers it");
  assert.deepEqual((await readJson(globalPath)).mcpServers.lint, { command: "npx", args: ["lint-mcp"], enabled: false });
  assert.equal((await readJson(globalPath)).keep, "unknown keys stay");

  ({ status, body } = await post({ action: "enable", scope: "global", name: "lint" }));
  assert.equal(status, 200);
  assert.equal(server(body, "global", "lint").enabled, true);
  assert.equal(await readFile(globalPath, "utf8"), globalText, "enabled: true removes the key, as the SDK does");
  assert.ok(!JSON.stringify(body).includes(SECRET));
});

test("a server's exposure is set in its file, codemode removing the key, and the answer is the overview after it", async () => {
  let { status, body } = await post({ action: "set-exposure", scope: "global", name: "docs", exposure: "direct" });
  assert.equal(status, 200);
  assert.equal(server(body, "global", "docs").exposure, "direct");
  assert.equal((await readJson(globalPath)).mcpServers.docs.exposure, "direct");
  assert.ok(!JSON.stringify(body).includes(SECRET));

  // The old name pi still reads is not offered, and an entry holding it lists as what it now means.
  ({ status, body } = await post({ action: "set-exposure", scope: "global", name: "docs", exposure: "codemode-deferred" }));
  assert.equal(status, 400);
  const aliased = JSON.parse(globalText);
  aliased.mcpServers.docs.exposure = "codemode-deferred";
  await writeFile(globalPath, JSON.stringify(aliased));
  ({ status, body } = await post({ action: "set-exposure", scope: "global", name: "lint", exposure: "codemode" }));
  assert.equal(status, 200);
  assert.equal(server(body, "global", "docs").exposure, "codemode");

  ({ status, body } = await post({ action: "set-exposure", scope: "global", name: "docs", exposure: "codemode" }));
  assert.equal(status, 200);
  assert.equal(server(body, "global", "docs").exposure, "codemode");
  assert.equal(await readFile(globalPath, "utf8"), globalText, "codemode, the default, removes the key, as the SDK does");

  // Nothing connects because of it, so an entry that references PI_WEB_PASSWORD may change too, and stays off.
  ({ status, body } = await post({ action: "set-exposure", scope: "global", name: "pw", exposure: "hidden" }));
  assert.equal(status, 200);
  assert.deepEqual([server(body, "global", "pw").exposure, server(body, "global", "pw").enabled], ["hidden", false]);

  // toolExposure is kept, and counted.
  const withOverrides = JSON.parse(globalText);
  withOverrides.mcpServers.lint.toolExposure = { lint_file: "direct", "fix_*": "hidden" };
  await writeFile(globalPath, JSON.stringify(withOverrides));
  ({ body } = await post({ action: "set-exposure", scope: "global", name: "lint", exposure: "deferred" }));
  assert.equal(server(body, "global", "lint").toolExposureCount, 2);
  assert.deepEqual((await readJson(globalPath)).mcpServers.lint, { command: "npx", args: ["lint-mcp"], toolExposure: { lint_file: "direct", "fix_*": "hidden" }, exposure: "deferred" });
});

test("an exposure change follows the same guards as a switch", async () => {
  for (const body of [
    { action: "set-exposure", scope: "global", name: "docs" },
    { action: "set-exposure", scope: "global", name: "docs", exposure: "sometimes" },
    { action: "set-exposure", scope: "elsewhere", name: "docs", exposure: "direct" },
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.reason, "invalid-request", JSON.stringify(body));
  }
  const missing = await post({ action: "set-exposure", scope: "global", name: "gone", exposure: "direct" });
  assert.deepEqual([missing.status, missing.body.reason], [409, "server-missing"]);
  const untrusted = await post({ action: "set-exposure", scope: "project", name: "repo", exposure: "direct", cwd });
  assert.deepEqual([untrusted.status, untrusted.body.reason], [403, "project-untrusted"]);
  assert.equal(await readFile(projectPath, "utf8"), projectText);
  process.env.PI_WEB_DISABLE_MCP = "1";
  const off = await post({ action: "set-exposure", scope: "global", name: "docs", exposure: "direct" });
  assert.deepEqual([off.status, off.body.reason], [409, "mcp-off"]);
  delete process.env.PI_WEB_DISABLE_MCP;
  assert.equal(await readFile(globalPath, "utf8"), globalText);

  await writeFile(globalPath, JSON.stringify({ mcpServers: { text: "x" } }));
  const notObject = await post({ action: "set-exposure", scope: "global", name: "text", exposure: "direct" });
  assert.deepEqual([notObject.status, notObject.body.reason], [409, "entry-not-object"]);
});

test("requests from another page, not sent as JSON, or naming nothing to do are refused", async () => {
  assert.deepEqual(
    await post({ action: "disable", scope: "global", name: "lint" }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
    { status: 403, body: { error: "Untrusted API request", reason: "request-denied" } },
  );
  assert.deepEqual(
    await post({ action: "disable", scope: "global", name: "lint" }, { "Content-Type": "text/plain" }),
    { status: 415, body: { error: "Content-Type must be application/json", reason: "content-type" } },
  );
  for (const body of [
    "{ not json",
    [],
    { action: "explode" },
    { action: "disable", scope: "elsewhere", name: "lint" },
    { action: "disable", scope: "global" },
    { action: "set-enabled", enabled: "yes", servers: [{ scope: "global", name: "lint" }] },
    { action: "set-enabled", enabled: true, servers: [] },
    { action: "undo" },
    { action: "disable", scope: "project", name: "repo" },
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.reason, "invalid-request", JSON.stringify(body));
  }
  assert.equal(
    (await post({ action: "disable", scope: "global", name: "lint", cwd: outside })).body.reason,
    "cwd-denied",
  );
  assert.equal((await post({ action: "disable", scope: "global", name: "lint", cwd: "project" })).body.reason, "cwd-invalid");
  assert.equal(await readFile(globalPath, "utf8"), globalText);
});

test("an untrusted project's file is never written; a trusted one's is", async () => {
  const untrusted = await post({ action: "disable", scope: "project", name: "repo", cwd });
  assert.equal(untrusted.status, 403);
  assert.equal(untrusted.body.reason, "project-untrusted");
  assert.equal(await readFile(projectPath, "utf8"), projectText);
  // An explicit false does not count either, nor does trust a parent's false overrides.
  store.set(cwd, false);
  assert.equal((await post({ action: "remove", scope: "project", name: "repo", cwd })).body.reason, "project-untrusted");

  store.set(root, true);
  store.set(cwd, null);
  const inherited = await post({ action: "disable", scope: "project", name: "repo", cwd });
  assert.equal(inherited.status, 200, "trust through a parent counts, as it does for the MCP host");
  assert.equal(server(inherited.body, "project", "repo").enabled, false);
  assert.equal((await readJson(projectPath)).mcpServers.repo.enabled, false);
  store.set(root, null);
});

test("an unreadable trust store keeps the project's file unwritten, and the global one writable", async (t) => {
  const trustPath = join(agentDir, "trust.json");
  t.after(() => rm(trustPath, { force: true }));
  await writeFile(trustPath, "{ not json");
  const refused = await post({ action: "disable", scope: "project", name: "repo", cwd });
  assert.deepEqual([refused.status, refused.body.reason], [409, "trust-unreadable"]);
  assert.equal(await readFile(projectPath, "utf8"), projectText);
  assert.equal((await post({ action: "disable", scope: "global", name: "lint", cwd })).status, 200);
});

test("while MCP is off nothing is written", async () => {
  process.env.PI_WEB_DISABLE_MCP = "1";
  for (const body of [
    { action: "disable", scope: "global", name: "lint" },
    { action: "remove", scope: "global", name: "lint" },
    { action: "set-enabled", enabled: false, servers: [{ scope: "global", name: "lint" }] },
    { action: "undo", token: "x" },
  ]) {
    const response = await post(body);
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.equal(response.body.reason, "mcp-off");
  }
  assert.equal(await readFile(globalPath, "utf8"), globalText);
});

test("an entry that references PI_WEB_PASSWORD is never turned on, but can be turned off and removed", async () => {
  const refused = await post({ action: "enable", scope: "global", name: "pw" });
  assert.deepEqual([refused.status, refused.body.reason, refused.body.name], [409, "web-password", "pw"]);
  assert.equal(await readFile(globalPath, "utf8"), globalText);
  assert.equal((await post({ action: "disable", scope: "global", name: "pw" })).status, 200);
  assert.equal((await post({ action: "remove", scope: "global", name: "pw" })).status, 200);
  assert.equal((await readJson(globalPath)).mcpServers.pw, undefined);
});

test("the group switch answers per server, so a refused one leaves the rest switched", async () => {
  const { status, body } = await post({
    action: "set-enabled",
    enabled: true,
    cwd,
    servers: [
      { scope: "global", name: "lint" },
      { scope: "global", name: "pw" },
      { scope: "global", name: "gone" },
      { scope: "project", name: "repo" },
      { scope: "global", name: "docs" },
    ],
  });
  assert.equal(status, 200);
  assert.deepEqual(body.results.map(({ scope, name, reason }) => [scope, name, reason]), [
    ["global", "lint", undefined],
    ["global", "pw", "web-password"],
    ["global", "gone", "server-missing"],
    ["project", "repo", "project-untrusted"],
    ["global", "docs", undefined],
  ]);
  assert.equal(server(body, "global", "pw").enabled, false);
  assert.equal(await readFile(projectPath, "utf8"), projectText);

  const off = await post({ action: "set-enabled", enabled: false, servers: [{ scope: "global", name: "lint" }, { scope: "global", name: "docs" }] });
  assert.deepEqual(off.body.results, [{ scope: "global", name: "lint" }, { scope: "global", name: "docs" }]);
  const servers = (await readJson(globalPath)).mcpServers;
  assert.deepEqual([servers.lint.enabled, servers.docs.enabled], [false, false]);
});

test("remove answers with an undo token, never the entry, and undo puts it back where it stood", async () => {
  const removed = await post({ action: "remove", scope: "global", name: "docs" });
  assert.equal(removed.status, 200);
  assert.equal(server(removed.body, "global", "docs"), undefined);
  const { undo } = removed.body;
  assert.deepEqual(Object.keys(undo).sort(), ["expiresInMs", "name", "path", "scope", "token"]);
  assert.deepEqual([undo.scope, undo.name, undo.path], ["global", "docs", globalPath]);
  assert.ok(undo.expiresInMs > 59_000 && undo.expiresInMs <= 60_000);
  assert.ok(!JSON.stringify(removed.body).includes(SECRET), "the removed entry stays on the server");
  assert.equal((await readJson(globalPath)).mcpServers.docs, undefined);

  const restored = await post({ action: "undo", token: undo.token });
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.body.restored, { scope: "global", name: "docs" });
  assert.equal(await readFile(globalPath, "utf8"), globalText, "back in its place, byte for byte");
  assert.ok(!JSON.stringify(restored.body).includes(SECRET));

  assert.deepEqual(
    [(await post({ action: "undo", token: undo.token })).status, (await post({ action: "undo", token: undo.token })).body.reason],
    [410, "undo-unavailable"],
  );
});

test("undo never replaces a server of the same name added since, and works again once it is gone", async () => {
  const { undo } = (await post({ action: "remove", scope: "global", name: "lint" })).body;
  const text = await readFile(globalPath, "utf8");
  const readded = JSON.parse(text);
  readded.mcpServers.lint = { command: "a-new-lint" };
  await writeFile(globalPath, JSON.stringify(readded, null, 2));
  const refused = await post({ action: "undo", token: undo.token });
  assert.deepEqual([refused.status, refused.body.reason, refused.body.name], [409, "undo-name-taken", "lint"]);
  assert.equal((await readJson(globalPath)).mcpServers.lint.command, "a-new-lint");
  await writeFile(globalPath, text);
  assert.equal((await post({ action: "undo", token: undo.token })).status, 200);
  assert.deepEqual((await readJson(globalPath)).mcpServers.lint, { command: "npx", args: ["lint-mcp"] });
});

test("a project removal is undone only while the project is still trusted", async () => {
  store.set(cwd, true);
  const { undo } = (await post({ action: "remove", scope: "project", name: "repo", cwd })).body;
  assert.deepEqual([undo.scope, undo.path], ["project", projectPath]);
  store.set(cwd, false);
  assert.equal((await post({ action: "undo", token: undo.token, cwd })).body.reason, "project-untrusted");
  store.set(cwd, true);
  assert.equal((await post({ action: "undo", token: undo.token, cwd })).status, 200);
  assert.equal(await readFile(projectPath, "utf8"), projectText);
});

test("a file that no longer parses, a server removed meanwhile, or a link outside are refused with the file untouched", async () => {
  await writeFile(globalPath, `{ "mcpServers": { "lint": { "env": { "T": '${SECRET}' } } } }`);
  const unparsable = await post({ action: "disable", scope: "global", name: "lint" });
  assert.deepEqual([unparsable.status, unparsable.body.reason, unparsable.body.path], [409, "unparsable", globalPath]);
  assert.ok(!JSON.stringify(unparsable.body).includes(SECRET), "the refusal never quotes the file");
  assert.match(await readFile(globalPath, "utf8"), new RegExp(SECRET));

  await writeFile(globalPath, globalText);
  const missing = await post({ action: "remove", scope: "global", name: "gone" });
  assert.deepEqual([missing.status, missing.body.reason, missing.body.name], [409, "server-missing", "gone"]);
  assert.equal((await post({ action: "disable", scope: "global", name: "gone" })).body.reason, "server-missing");

  if (process.platform !== "win32") {
    store.set(cwd, true);
    const target = join(outside, "mcp.json");
    await writeFile(target, projectText);
    await rm(projectPath);
    await symlink(target, projectPath);
    const linked = await post({ action: "disable", scope: "project", name: "repo", cwd });
    assert.deepEqual([linked.status, linked.body.reason], [409, "link-outside"]);
    assert.equal(await readFile(target, "utf8"), projectText);
  }
  assert.equal(await readFile(globalPath, "utf8"), globalText);
});

test("an entry that is not an object is refused for what it is, not as missing, and can be removed", async () => {
  const text = `${JSON.stringify({ mcpServers: { junk: "oops", lint: { command: "npx" } } }, null, 2)}\n`;
  await writeFile(globalPath, text);
  // The listing says so, so the panel can leave its switch off.
  const { body: overview } = await post({ action: "disable", scope: "global", name: "lint" });
  assert.equal(server(overview, "global", "junk").notAnObject, true);
  assert.equal(server(overview, "global", "lint").notAnObject, undefined);
  await writeFile(globalPath, text);
  for (const action of ["disable", "enable"]) {
    const refused = await post({ action, scope: "global", name: "junk" });
    assert.deepEqual([refused.status, refused.body.reason, refused.body.name, refused.body.path], [409, "entry-not-object", "junk", globalPath], action);
  }
  assert.equal(await readFile(globalPath, "utf8"), text);
  const bulk = await post({ action: "set-enabled", enabled: false, servers: [{ scope: "global", name: "junk" }, { scope: "global", name: "lint" }] });
  assert.equal(bulk.status, 200);
  assert.deepEqual(bulk.body.results.map(({ name, reason }) => [name, reason]), [["junk", "entry-not-object"], ["lint", undefined]]);
  assert.equal((await readJson(globalPath)).mcpServers.junk, "oops");
  const removed = await post({ action: "remove", scope: "global", name: "junk" });
  assert.equal(removed.status, 200);
  assert.equal(server(removed.body, "global", "junk"), undefined);
});
