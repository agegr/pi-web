import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  ProjectTrustStore,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// mcp.json, the MCP log, and the OAuth store all live in the agent directory.
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-mcp-host-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(() => rm(agentDir, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper, MCP_WAIT_STOPPED_MESSAGE } = await jiti.import("./rpc-manager.ts");
const { createPiWebBuiltinExtensions } = await jiti.import("./builtin-extensions.ts");
const { mcpConfigKey } = await jiti.import("./mcp-config-key.ts");
const { readMcpOverview } = await jiti.import("./mcp-config-read.ts");
const { clearMcpStatuses, readMcpStatus } = await jiti.import("./mcp-status.ts");

const FIXTURE = fileURLToPath(new URL("./__fixtures__/mcp-env-server.mjs", import.meta.url));

function writeMcpConfig(servers) {
  return writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: servers }));
}

function fixtureServer() {
  return { command: process.execPath, args: [FIXTURE], exposure: "direct" };
}

async function waitFor(condition, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await delay(20);
  }
}

async function startSession(t, hostOptions, extraExtensions = []) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-mcp-host-cwd-"));
  const faux = fauxProvider({ models: [{ id: "faux-mcp-host" }] });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({});
  const { extensions, mcpHost } = await createPiWebBuiltinExtensions({ agentDir, mcpHost: hostOptions });
  assert.ok(mcpHost, "MCP is available");
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    extensionFactories: [...extraExtensions, ...extensions],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model: faux.getModel("faux-mcp-host"),
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    resourceLoader,
  });
  const wrapper = new AgentSessionWrapper(session, { mcpHost });
  t.after(async () => {
    wrapper.destroy();
    await rm(cwd, { recursive: true, force: true });
  });
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  return { cwd, session, wrapper, faux, mcpHost };
}

/** The tools a request declares: system messages add and remove them in order. */
function declaredTools(context) {
  const tools = new Set();
  for (const message of context.messages) {
    if (message.role !== "system") continue;
    for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
    for (const tool of message.toolsAdded ?? []) tools.add(tool.name);
  }
  return [...tools];
}

/** Prompt through the wrapper, as the browser does, and report the tools the model was offered. */
async function promptAndSeeTools(wrapper, faux) {
  let offered;
  faux.setResponses([(context) => {
    offered = declaredTools(context);
    return fauxAssistantMessage([fauxText("ok")]);
  }]);
  await wrapper.send({ type: "prompt", message: "hello" });
  await waitFor(() => !wrapper.isRunning());
  return offered;
}

test("a prompt connects the configured servers before the model sees its request", async (t) => {
  await writeMcpConfig({ fixture: fixtureServer() });
  t.after(() => rm(join(agentDir, "mcp.json"), { force: true }));
  const { session, wrapper, faux, mcpHost } = await startSession(t);

  await delay(100);
  assert.ok(!session.getAllTools().some((tool) => tool.name.startsWith("mcp__")), "nothing connects before a prompt");
  assert.deepEqual(mcpHost.serverStates(), []);

  const offered = await promptAndSeeTools(wrapper, faux);
  assert.ok(offered.includes("mcp__fixture__env_has"), `offered: ${offered}`);
  assert.deepEqual(mcpHost.serverStates(), [{ name: "fixture", scope: "global", state: "ready" }]);

  // A change to mcp.json, made anywhere, reaches the session on its next prompt.
  await writeMcpConfig({ renamed: fixtureServer() });
  const afterRename = await promptAndSeeTools(wrapper, faux);
  assert.ok(afterRename.includes("mcp__renamed__env_has"), `offered: ${afterRename}`);
  assert.ok(!afterRename.includes("mcp__fixture__env_has"), `offered: ${afterRename}`);
});

test("Stop while servers connect withdraws the message unsent", async (t) => {
  // Starts, then never answers `initialize`; the client gives up after `timeout` seconds.
  await writeMcpConfig({
    silent: { command: process.execPath, args: ["-e", "process.stdin.resume()"], exposure: "direct", timeout: 2 },
  });
  t.after(() => rm(join(agentDir, "mcp.json"), { force: true }));
  const { session, wrapper, faux, mcpHost } = await startSession(t, { idleMs: 200 });
  faux.setResponses([() => fauxAssistantMessage([fauxText("should not run")])]);

  const started = Date.now();
  const prompting = wrapper.send({ type: "prompt", message: "hello" });
  await delay(300);
  assert.equal(wrapper.isRunning(), true, "the prompt is admitted while it waits");
  await wrapper.send({ type: "abort" });
  await assert.rejects(prompting, { message: MCP_WAIT_STOPPED_MESSAGE });
  assert.ok(Date.now() - started < 2_000, "Stop did not wait out the connection");
  assert.equal(wrapper.isRunning(), false);
  assert.equal(faux.state.callCount, 0);
  assert.deepEqual(session.messages.filter((message) => message.role === "user"), []);

  // No run started, so no agent_end will either; the server still idles out.
  assert.deepEqual(mcpHost.serverStates().map((server) => server.name), ["silent"]);
  await waitFor(() => mcpHost.serverStates().length === 0, 5_000);
});

test("an extension command skips the MCP wait, and the built-in /mcp registers the servers without waiting", async (t) => {
  // Starts, then never answers `initialize`: a prompt would wait for it.
  await writeMcpConfig({
    silent: { command: process.execPath, args: ["-e", "process.stdin.resume()"], exposure: "direct", timeout: 5 },
  });
  t.after(() => rm(join(agentDir, "mcp.json"), { force: true }));
  let pinged = 0;
  const ping = {
    name: "ping-command",
    factory: (pi) => {
      pi.registerCommand("ping", { description: "Ping", handler: async () => { pinged += 1; } });
    },
  };
  const { wrapper, faux, mcpHost } = await startSession(t, undefined, [ping]);
  faux.setResponses([() => fauxAssistantMessage([fauxText("should not run")])]);

  // pi runs an extension command before anything else and starts no run for it.
  let started = Date.now();
  await wrapper.send({ type: "prompt", message: "/ping" });
  await waitFor(() => pinged === 1);
  assert.ok(Date.now() - started < 1_000, "another extension's command did not wait for MCP");
  assert.deepEqual(mcpHost.serverStates(), [], "and registered no MCP server");

  // /mcp acts on the registered servers: they are registered for it, but not waited for.
  started = Date.now();
  await wrapper.send({ type: "prompt", message: "/mcp" });
  assert.ok(Date.now() - started < 2_000, "the built-in /mcp did not wait for silent to connect");
  assert.deepEqual(mcpHost.serverStates().map((server) => server.name), ["silent"]);
  assert.equal(faux.state.callCount, 0);
});

test("a project's mcp.json written after the session started connects only once the project is trusted", async (t) => {
  // The folder needs no trust when the session starts, so pi reports the session trusted for good.
  const { cwd, session, wrapper, faux, mcpHost } = await startSession(t);
  assert.equal(session.settingsManager.isProjectTrusted(), true);
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { repo: fixtureServer() } }));

  const untrusted = await promptAndSeeTools(wrapper, faux);
  assert.ok(!untrusted.some((tool) => tool.startsWith("mcp__")), `offered: ${untrusted}`);
  assert.deepEqual(mcpHost.serverStates(), [{ name: "repo", scope: "project", state: "not-trusted" }]);

  new ProjectTrustStore(agentDir).set(cwd, true);
  const trusted = await promptAndSeeTools(wrapper, faux);
  assert.ok(trusted.includes("mcp__repo__env_has"), `offered: ${trusted}`);
  assert.deepEqual(mcpHost.serverStates(), [{ name: "repo", scope: "project", state: "ready" }]);
});

// ---------------------------------------------------------------------------
// What a session reports to Settings › MCP
// ---------------------------------------------------------------------------

/** The status a session recorded for a global entry, as Settings › MCP reads it. */
function globalStatus(name, config) {
  return readMcpStatus({ scope: "global", sourcePath: join(agentDir, "mcp.json"), name }, mcpConfigKey(config));
}

test("a session reports its servers' state, and the listing shows it for the entry as the file holds it", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  await writeMcpConfig({ fixture: fixtureServer() });
  t.after(() => rm(join(agentDir, "mcp.json"), { force: true }));
  const { cwd, session, wrapper, faux } = await startSession(t);
  await promptAndSeeTools(wrapper, faux);
  const { servers } = await readMcpOverview({ agentDir });
  const status = servers.find((server) => server.name === "fixture")?.status;
  assert.deepEqual(
    { origin: status?.origin, state: status?.state, sessionId: status?.sessionId, cwd: status?.cwd },
    { origin: "session", state: "connected", sessionId: session.sessionId, cwd },
  );
});

test("a stdio server that exits after it was ready reads disconnected", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const scratch = await mkdtemp(join(tmpdir(), "pi-web-mcp-host-drop-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const pidFile = join(scratch, "pid");
  const config = { ...fixtureServer(), env: { PI_WEB_FIXTURE_PID_FILE: pidFile } };
  await writeMcpConfig({ fixture: config });
  t.after(() => rm(join(agentDir, "mcp.json"), { force: true }));
  const { wrapper, faux, mcpHost } = await startSession(t);
  await promptAndSeeTools(wrapper, faux);
  assert.equal(globalStatus("fixture", config).state, "connected");

  process.kill(Number(await readFile(pidFile, "utf8")), "SIGKILL");
  await waitFor(() => mcpHost.serverStates()[0]?.state === "disconnected", 5_000);
  assert.equal(globalStatus("fixture", config).state, "disconnected");
});

test("a stdio server that cannot start is failed with what it wrote to stderr, masked", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const crashing = { command: process.execPath, args: ["-e", "process.stderr.write('cannot start: no config file\\n'); process.exit(1)"] };
  // The fixture writes this env value to stderr: a literal env value is masked wherever it shows.
  const echoing = { ...fixtureServer(), env: { PI_WEB_FIXTURE_FAIL: "sk-live-abcdef0123456789" } };
  await writeMcpConfig({ crashing, echoing });
  t.after(() => rm(join(agentDir, "mcp.json"), { force: true }));
  const { wrapper, faux, mcpHost } = await startSession(t);
  await promptAndSeeTools(wrapper, faux);
  const states = Object.fromEntries(mcpHost.serverStates().map((state) => [state.name, state]));
  assert.equal(states.crashing.state, "failed");
  assert.match(states.crashing.stderr, /cannot start: no config file/);
  const status = globalStatus("crashing", crashing);
  assert.equal(status.state, "failed");
  assert.equal(status.stderr, "cannot start: no config file");
  // Nothing failed on its own: the transport closed, which the error says.
  assert.equal(status.error, "The connection closed before the server was ready");

  const echoed = globalStatus("echoing", echoing);
  assert.equal(echoed.state, "failed");
  assert.equal(echoed.stderr, "•••");
});

/**
 * A streamable HTTP MCP server that answers 401 with a challenge until a
 * request carries `Authorization: Bearer <token>`, then speaks JSON-RPC.
 */
async function oauthServer(t, token) {
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="http://127.0.0.1:${server.address().port}/.well-known/oauth-protected-resource"`,
      });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(request.method === "GET" ? 405 : 200).end();
      return;
    }
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    const result = message.method === "initialize"
      ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "oauth-fixture", version: "1.0.0" } }
      : message.method === "tools/list"
        ? { tools: [{ name: "whoami", inputSchema: { type: "object" } }] }
        : {};
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/mcp`;
}

test("an OAuth server that answers 401 needs a sign-in, and reads connected once tokens are stored and the session reconnects", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const url = await oauthServer(t, "good-token");
  const config = { url, exposure: "direct" };
  await writeMcpConfig({ oauth: config });
  t.after(() => rm(join(agentDir, "mcp.json"), { force: true }));
  t.after(() => rm(join(agentDir, "mcp-auth.json"), { force: true }));
  const { wrapper, faux, mcpHost } = await startSession(t);
  await promptAndSeeTools(wrapper, faux);
  assert.deepEqual(mcpHost.serverStates(), [{ name: "oauth", scope: "global", state: "needs-auth" }]);
  assert.equal(globalStatus("oauth", config).state, "needs-auth");

  // A sign-in elsewhere (Settings, `pi mcp login`) stores tokens; the extension notices at the next turn
  // and reconnects through the host's factory, which follows that transport too. The entry is unchanged,
  // so nothing is registered again.
  await writeFile(join(agentDir, "mcp-auth.json"), JSON.stringify({ [String(new URL(url))]: { tokens: { access_token: "good-token", token_type: "Bearer" } } }));
  await promptAndSeeTools(wrapper, faux);
  await waitFor(() => mcpHost.serverStates()[0]?.state === "ready", 5_000);
  assert.equal(globalStatus("oauth", config).state, "connected");
});

test("a session that closes marks its connections closed at once, while another extension's session_shutdown never returns", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  await writeMcpConfig({ fixture: fixtureServer() });
  t.after(() => rm(join(agentDir, "mcp.json"), { force: true }));
  // Loaded before the built-ins, so its handler runs before the MCP extension's and the host's.
  let release;
  const hang = new Promise((resolve) => {
    release = resolve;
  });
  t.after(() => release());
  const stuck = { name: "stuck-shutdown", factory: (pi) => pi.on("session_shutdown", () => hang) };
  const { wrapper, faux } = await startSession(t, undefined, [stuck]);
  await promptAndSeeTools(wrapper, faux);
  assert.equal(globalStatus("fixture", fixtureServer()).state, "connected");
  assert.equal(globalStatus("fixture", fixtureServer()).closedAt, undefined);

  t.mock.method(console, "warn", () => {});
  const closing = wrapper.shutdown();
  await waitFor(() => globalStatus("fixture", fixtureServer())?.closedAt !== undefined, 2_000);
  release();
  await closing;
});

test("a server name another extension registered first is reported as a conflict naming that extension", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  await writeMcpConfig({ fixture: fixtureServer() });
  t.after(() => rm(join(agentDir, "mcp.json"), { force: true }));
  const other = {
    name: "other-mcp-servers",
    factory: (pi) => {
      pi.registerMcpServer("fixture", { command: process.execPath, args: [FIXTURE], exposure: "hidden" });
    },
  };
  const { wrapper, faux, mcpHost } = await startSession(t, undefined, [other]);
  await promptAndSeeTools(wrapper, faux);
  const [state] = mcpHost.serverStates();
  assert.equal(state.state, "not-registered");
  assert.equal(state.conflict, "<inline:other-mcp-servers>");
  const status = globalStatus("fixture", fixtureServer());
  assert.deepEqual({ state: status.state, conflict: status.conflict }, { state: "conflict", conflict: "<inline:other-mcp-servers>" });
});
