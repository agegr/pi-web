import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// POST /api/mcp { action: "add" } writes the user's files and trust.json, so
// every case runs against a PI_CODING_AGENT_DIR in a temporary folder, never
// the real ~/.pi/agent.
const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-mcp-add-route-")));
const agentDir = join(root, "agent");
const trusted = join(root, "trusted");
const untrusted = join(root, "untrusted");
const fresh = join(root, "fresh");
const outer = join(root, "outer");
const inner = join(outer, "inner");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousDisable = process.env.PI_WEB_DISABLE_MCP;
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_WEB_DISABLE_MCP;
await mkdir(agentDir, { recursive: true });

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { GET, POST } = await jiti.import("./route.ts");
for (const folder of [trusted, untrusted, fresh, outer, inner, root]) allowFileRoot(folder);

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousDisable === undefined) delete process.env.PI_WEB_DISABLE_MCP;
  else process.env.PI_WEB_DISABLE_MCP = previousDisable;
  await rm(root, { recursive: true, force: true });
});

const globalPath = join(agentDir, "mcp.json");
const trustPath = join(agentDir, "trust.json");
const projectPath = (cwd) => join(cwd, ".pi", "mcp.json");
const store = new ProjectTrustStore(agentDir);
const globalText = `${JSON.stringify({ mcpServers: { docs: { url: "https://docs.example.com/mcp" } } }, null, 2)}\n`;

beforeEach(async () => {
  delete process.env.PI_WEB_DISABLE_MCP;
  await writeFile(globalPath, globalText);
  await rm(trustPath, { force: true });
  for (const folder of [trusted, untrusted, fresh, outer]) await rm(folder, { recursive: true, force: true });
  for (const folder of [trusted, untrusted, fresh, inner]) await mkdir(folder, { recursive: true });
  await mkdir(join(trusted, ".pi"));
  await writeFile(projectPath(trusted), `${JSON.stringify({ mcpServers: { repo: { command: "node" } } }, null, 2)}\n`);
  store.set(trusted, true);
  await mkdir(join(untrusted, ".pi", "extensions"), { recursive: true });
});

async function post(body, headers = {}) {
  const response = await POST(new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { host: "localhost", "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

const add = (body) => post({ action: "add", scope: "global", ...body });
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const trustFile = async () => (existsSync(trustPath) ? readJson(trustPath) : {});

test("a pasted server is added to the global file, and the answer is the overview after it", async () => {
  const { status, body } = await add({ text: "npx -y @scope/lint-mcp" });
  assert.equal(status, 200);
  assert.deepEqual(body.added, { scope: "global", name: "lint", path: globalPath });
  assert.ok(body.servers.some((server) => server.scope === "global" && server.name === "lint"), "the whole overview, as GET answers it");
  assert.equal(body.trust, undefined, "a global server changes no folder's trust");
  assert.deepEqual((await readJson(globalPath)).mcpServers, {
    docs: { url: "https://docs.example.com/mcp" },
    lint: { command: "npx", args: ["-y", "@scope/lint-mcp"] },
  });
});

test("requests that are not an add the route can read are refused before anything is read", async () => {
  for (const body of [
    { text: 1 },
    { text: "x".repeat(300 * 1024) },
    { text: "npx x", scope: "elsewhere" },
    { text: "npx x", server: -1 },
    { text: "npx x", values: { a: 1 } },
    { text: "npx x", confirmHostEnv: "GH_TOKEN" },
    { text: "npx x", trustFolder: "yes" },
    { text: "npx x", scope: "project" },
  ]) {
    const response = await add(body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal(response.body.reason, "invalid-request");
  }
  const unread = await add({ text: "rm -rf / && echo" });
  assert.deepEqual([unread.status, unread.body.reason], [400, "import-failed"]);
  assert.ok(Array.isArray(unread.body.notes) && unread.body.notes.length > 0, "with the importer's notes for the panel to translate");
  assert.equal(await readFile(globalPath, "utf8"), globalText);
});

test("a name the file defines is refused with a free one; an invalid one is refused", async () => {
  const taken = await add({ text: "https://mcp.example.com/mcp", name: "docs" });
  assert.deepEqual(
    { status: taken.status, reason: taken.body.reason, name: taken.body.name, suggestedName: taken.body.suggestedName },
    { status: 409, reason: "name-taken", name: "docs", suggestedName: "docs-2" },
  );
  assert.equal((await add({ text: "https://mcp.example.com/mcp", name: "my docs" })).body.reason, "name-invalid");
  assert.equal(await readFile(globalPath, "utf8"), globalText);
});

test("a literal secret is saved globally only, and PI_WEB_PASSWORD never", async () => {
  const text = JSON.stringify({ mcpServers: { api: { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer sk-live-0123456789abcdef0123" } } } });
  const refused = await add({ text, scope: "project", cwd: trusted });
  assert.deepEqual([refused.status, refused.body.reason, refused.body.fields], [409, "secret-global-only", ["headers.Authorization"]]);
  assert.ok(!JSON.stringify(refused.body).includes("sk-live"), "the secret is never sent back");
  assert.deepEqual(Object.keys((await readJson(projectPath(trusted))).mcpServers), ["repo"]);
  const global = await add({ text, cwd: trusted });
  assert.equal(global.status, 200);
  assert.ok(!JSON.stringify(global.body).includes("sk-live"), "nor in the overview");

  const password = await add({ text: JSON.stringify({ mcpServers: { pw: { url: "https://pw.example.com/mcp", headers: { A: "${PI_WEB_PASSWORD}" } } } }), rawPi: true });
  assert.deepEqual([password.status, password.body.reason], [409, "web-password"]);
});

test("a header that sends a variable set on the host is added only once that variable is confirmed", async (t) => {
  process.env.PI_WEB_ADD_TEST_TOKEN = "secret-value-from-the-host";
  t.after(() => delete process.env.PI_WEB_ADD_TEST_TOKEN);
  const text = JSON.stringify({ mcpServers: { gh: { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${env:PI_WEB_ADD_TEST_TOKEN}" } } } });
  const asked = await add({ text });
  assert.deepEqual([asked.status, asked.body.reason, asked.body.names], [409, "host-env-confirm", ["PI_WEB_ADD_TEST_TOKEN"]]);
  assert.ok(!JSON.stringify(asked.body).includes("secret-value-from-the-host"));
  assert.equal(await readFile(globalPath, "utf8"), globalText);
  // Where it may go is said before anything is asked: an untrusted project refuses it outright.
  const untrustedAsk = await add({ text, scope: "project", cwd: untrusted });
  assert.deepEqual([untrustedAsk.status, untrustedAsk.body.reason], [403, "project-untrusted"]);
  const confirmed = await add({ text, confirmHostEnv: ["PI_WEB_ADD_TEST_TOKEN"] });
  assert.equal(confirmed.status, 200);
  assert.equal((await readJson(globalPath)).mcpServers.gh.headers.Authorization, "Bearer ${PI_WEB_ADD_TEST_TOKEN}");
});

test("a project server goes only to a folder a decision trusts, and the answer carries its trust", async () => {
  const added = await add({ text: "npx -y @scope/lint-mcp", scope: "project", cwd: trusted });
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.added, { scope: "project", name: "lint", path: projectPath(trusted) });
  assert.deepEqual(added.body.trust, { requiresTrust: true, trusted: true, decision: true, decisionPath: trusted, inherited: false });
  assert.equal(added.body.trustedFolder, undefined, "nothing was trusted by this request");
  assert.deepEqual(Object.keys((await readJson(projectPath(trusted))).mcpServers), ["repo", "lint"]);

  const refused = await add({ text: "npx -y @scope/lint-mcp", scope: "project", cwd: untrusted });
  assert.deepEqual([refused.status, refused.body.reason], [403, "project-untrusted"]);
  assert.equal(existsSync(projectPath(untrusted)), false);
  // trustFolder does not get around it: the folder is not fresh.
  const notFresh = await add({ text: "npx -y @scope/lint-mcp", scope: "project", cwd: untrusted, trustFolder: true });
  assert.deepEqual([notFresh.status, notFresh.body.reason], [409, "folder-not-fresh"]);
  assert.deepEqual(notFresh.body.trust, { requiresTrust: true, trusted: false, decision: null, inherited: false });
  assert.equal(existsSync(projectPath(untrusted)), false);
  assert.deepEqual(await trustFile(), { [trusted]: true });
});

test("a fresh folder is trusted and written in one step, only when asked to", async () => {
  const overview = (await GET(new Request(`http://localhost/api/mcp?cwd=${encodeURIComponent(fresh)}`, { headers: { host: "localhost" } })));
  const listed = await overview.json();
  assert.deepEqual(listed.project.trustFolder, { allowed: true }, "GET offers the step for a fresh folder");
  assert.deepEqual(listed.project.trust, { requiresTrust: false, trusted: true, decision: null, inherited: false });

  const plain = await add({ text: "npx -y @scope/lint-mcp", scope: "project", cwd: fresh });
  assert.deepEqual([plain.status, plain.body.reason], [403, "project-untrusted"], "a plain add leaves a fresh folder alone");
  assert.equal(existsSync(join(fresh, ".pi")), false);

  const { status, body } = await add({ text: "npx -y @scope/lint-mcp", scope: "project", cwd: fresh, trustFolder: true });
  assert.equal(status, 200);
  assert.equal(body.trustedFolder, true);
  assert.deepEqual(body.trust, { requiresTrust: true, trusted: true, decision: true, decisionPath: fresh, inherited: false });
  assert.deepEqual(body.project.trust, body.trust, "the overview reads the new trust");
  assert.equal(body.project.trustFolder, undefined, "and offers the step no more");
  assert.deepEqual(await trustFile(), { [trusted]: true, [fresh]: true });
  assert.deepEqual((await readJson(projectPath(fresh))).mcpServers, { lint: { command: "npx", args: ["-y", "@scope/lint-mcp"] } });
});

test("a fresh folder that gained resources since the panel offered the step is not trusted", async () => {
  // A git pull brought .pi/extensions after the button was shown.
  await mkdir(join(fresh, ".pi", "extensions"), { recursive: true });
  const { status, body } = await add({ text: "npx -y @scope/lint-mcp", scope: "project", cwd: fresh, trustFolder: true });
  assert.deepEqual([status, body.reason], [409, "folder-not-fresh"]);
  assert.equal(body.trust.requiresTrust, true);
  assert.equal(body.trust.trusted, false);
  assert.deepEqual(await trustFile(), { [trusted]: true });
  assert.equal(existsSync(projectPath(fresh)), false);
});

test("a fresh folder with a link to nothing under .pi is not offered the step, and the step refuses it", async () => {
  // The SDK's existsSync sees nothing that needs trust yet; the link would need it once its target appears.
  await mkdir(join(fresh, ".pi"));
  await symlink(join(root, "not-there-yet"), join(fresh, ".pi", "extensions"));
  const listed = await (await GET(new Request(`http://localhost/api/mcp?cwd=${encodeURIComponent(fresh)}`, { headers: { host: "localhost" } }))).json();
  assert.deepEqual(listed.project.trust, { requiresTrust: false, trusted: true, decision: null, inherited: false });
  assert.deepEqual(listed.project.trustFolder, { allowed: false, reason: "folder-not-fresh" }, "GET and POST share one freshness rule");
  const { status, body } = await add({ text: "npx -y @scope/lint-mcp", scope: "project", cwd: fresh, trustFolder: true });
  assert.deepEqual([status, body.reason], [409, "folder-not-fresh"]);
  assert.deepEqual(await trustFile(), { [trusted]: true });
  assert.equal(existsSync(projectPath(fresh)), false);
});

test("a fresh folder holding a project Pi Web never opened is not offered the step, and the step refuses it", async () => {
  // A repository cloned into the folder: trusting the folder would load its extensions with no dialog.
  const cloned = join(fresh, "cloned-repo");
  await mkdir(join(cloned, ".pi", "extensions"), { recursive: true });
  const listed = await (await GET(new Request(`http://localhost/api/mcp?cwd=${encodeURIComponent(fresh)}`, { headers: { host: "localhost" } }))).json();
  assert.deepEqual(listed.project.trustFolder, { allowed: false, reason: "trust-too-broad", breadth: { kind: "contains-project", path: cloned } });
  const { status, body } = await add({ text: "npx -y @scope/lint-mcp", scope: "project", cwd: fresh, trustFolder: true });
  assert.deepEqual([status, body.reason], [409, "trust-too-broad"]);
  assert.deepEqual(body.breadth, { kind: "contains-project", path: cloned });
  assert.deepEqual(await trustFile(), { [trusted]: true });
  assert.equal(existsSync(projectPath(fresh)), false);
});

test("a folder whose trust would reach other folders is never trusted by the step", async (t) => {
  // `outer` holds `inner`, a folder Pi Web knows (an allowed root, as a session's folder is).
  let response = await add({ text: "npx -y @scope/lint-mcp", scope: "project", cwd: outer, trustFolder: true });
  assert.deepEqual([response.status, response.body.reason], [409, "trust-too-broad"]);
  assert.deepEqual(response.body.breadth, { kind: "contains-folder", path: inner });
  const listed = await (await GET(new Request(`http://localhost/api/mcp?cwd=${encodeURIComponent(outer)}`, { headers: { host: "localhost" } }))).json();
  assert.deepEqual(
    listed.project.trustFolder,
    { allowed: false, reason: "trust-too-broad", breadth: { kind: "contains-folder", path: inner } },
    "GET says so first",
  );

  // The folder holding Pi's agent folder.
  response = await add({ text: "npx -y @scope/lint-mcp", scope: "project", cwd: root, trustFolder: true });
  assert.deepEqual(response.body.breadth, { kind: "contains-agent-dir", path: agentDir });

  // The home folder itself.
  const home = join(root, "home");
  await mkdir(home, { recursive: true });
  allowFileRoot(home);
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => {
    process.env.HOME = previousHome;
  });
  response = await add({ text: "npx -y @scope/lint-mcp", scope: "project", cwd: home, trustFolder: true });
  assert.deepEqual(response.body.breadth, { kind: "home", path: home });
  process.env.HOME = previousHome;

  assert.deepEqual(await trustFile(), { [trusted]: true }, "nothing was trusted");
  for (const folder of [outer, root, home]) assert.equal(existsSync(projectPath(folder)), false);
});

test("two steps for one fresh folder at once: one trusts and adds, the other is refused and takes nothing back", async () => {
  const [a, b] = await Promise.all([
    add({ text: "npx -y @scope/one-mcp", name: "one", scope: "project", cwd: fresh, trustFolder: true }),
    add({ text: "npx -y @scope/two-mcp", name: "two", scope: "project", cwd: fresh, trustFolder: true }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const refused = a.status === 409 ? a : b;
  assert.equal(refused.body.reason, "folder-not-fresh");
  assert.equal(refused.body.trust.trusted, true, "it says the folder is trusted now, so the panel offers a plain Add");
  assert.equal(Object.keys((await readJson(projectPath(fresh))).mcpServers).length, 1);
  assert.deepEqual(await trustFile(), { [trusted]: true, [fresh]: true }, "the refused one took nothing back");
});

test("a write that fails after trusting a fresh folder takes the trust back", async () => {
  // A regular file where .pi should be: the folder is fresh, but nothing can be written under it.
  await writeFile(join(fresh, ".pi"), "not a folder");
  const { status, body } = await add({ text: "npx -y @scope/lint-mcp", scope: "project", cwd: fresh, trustFolder: true });
  assert.equal(status, 500);
  assert.equal(body.reason, "internal");
  assert.deepEqual(await trustFile(), { [trusted]: true }, "the decision written for the step is gone again");
  assert.equal(await readFile(join(fresh, ".pi"), "utf8"), "not a folder");
});

test("a write that fails after trusting, whose trust cannot be taken back either, says the folder stays trusted", async (t) => {
  await writeFile(join(fresh, ".pi"), "not a folder");
  // The route's store is the test's: the SDK module is shared, so taking the trust back can be made to fail.
  const set = ProjectTrustStore.prototype.set;
  t.mock.method(ProjectTrustStore.prototype, "set", function (path, value) {
    if (value === null) throw new Error("trust.json is locked by another process");
    return set.call(this, path, value);
  });
  t.mock.method(console, "warn", () => {});
  const { status, body } = await add({ text: "npx -y @scope/lint-mcp", scope: "project", cwd: fresh, trustFolder: true });
  assert.deepEqual([status, body.reason], [500, "internal"], "the reason is still the write's");
  assert.equal(body.trustKept, true, "a typed flag says the folder stays trusted, for the pane to say in words");
  assert.deepEqual(body.trust, { requiresTrust: true, trusted: true, decision: true, decisionPath: fresh, inherited: false });
  assert.deepEqual(await trustFile(), { [trusted]: true, [fresh]: true });
});

test("a pasted literal secret read from a host variable instead may go to the project", async (t) => {
  process.env.PI_WEB_ADD_TEST_API_TOKEN = "secret-value-from-the-host";
  t.after(() => delete process.env.PI_WEB_ADD_TEST_API_TOKEN);
  const text = JSON.stringify({ mcpServers: { api: { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer sk-live-0123456789abcdef0123" } } } });
  const invalid = await add({ text, scope: "project", cwd: trusted, secretReferences: { "headers.Authorization": "api-token" } });
  assert.deepEqual([invalid.status, invalid.body.reason], [400, "fields-incomplete"]);
  assert.deepEqual(invalid.body.notes, [{ code: "field-reference-invalid", params: { field: "headers.Authorization", problem: "name" } }]);
  assert.deepEqual((await add({ text, secretReferences: { "headers.Authorization": 1 } })).body.reason, "invalid-request");
  // The variable is the user's own choice, so it is not asked about, though it is set on the host.
  const added = await add({ text, scope: "project", cwd: trusted, secretReferences: { "headers.Authorization": "PI_WEB_ADD_TEST_API_TOKEN" } });
  assert.equal(added.status, 200);
  assert.deepEqual((await readJson(projectPath(trusted))).mcpServers.api, {
    url: "https://api.example.com/mcp",
    headers: { Authorization: "Bearer ${PI_WEB_ADD_TEST_API_TOKEN}" },
  });
  assert.ok(!(await readFile(projectPath(trusted), "utf8")).includes("sk-live"), "the secret never reaches the project file");
});

test("MCP off leaves every file as it is", async () => {
  process.env.PI_WEB_DISABLE_MCP = "1";
  const { status, body } = await add({ text: "npx -y @scope/lint-mcp", scope: "project", cwd: fresh, trustFolder: true });
  assert.deepEqual([status, body.reason], [409, "mcp-off"]);
  assert.equal(await readFile(globalPath, "utf8"), globalText);
  assert.deepEqual(await trustFile(), { [trusted]: true });
});
